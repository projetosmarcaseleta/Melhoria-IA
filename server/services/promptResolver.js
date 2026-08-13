import { db } from './firebaseAdmin.js'

/**
 * Resolve o prompt final para um cliente + tipo de geração no Firestore.
 *
 * Lógica:
 * 1. Busca prompt ativo do cliente (doc path: clients/{clientId}/prompts/{type})
 * 2. Se não encontrar → usa prompt global default
 * 3. Enriquece com RAG (base de conhecimento .md do cliente via embedding similarity)
 * 4. Enriquece com few-shot examples de gerações aprovadas
 * 5. Enriquece com instruções de skills ativas
 */
export async function resolvePrompt(clientId, promptType, productData = null) {
  // 1. Buscar prompt customizado do cliente
  let promptData = null
  let isCustomClientPrompt = false

  const clientPromptDoc = await db
    .collection('clients')
    .doc(clientId)
    .collection('prompts')
    .doc(promptType)
    .get()

  if (clientPromptDoc.exists && clientPromptDoc.data()?.isActive) {
    promptData = clientPromptDoc.data()
    isCustomClientPrompt = true
  } else {
    // Fallback para prompt global salvo no Firestore
    const globalPromptDoc = await db
      .collection('global_prompts')
      .doc(promptType)
      .get()

    if (globalPromptDoc.exists) {
      promptData = globalPromptDoc.data()
    }
  }

  // 2. Regras Estruturadas Aprovadas do Cliente (knowledge_rules)
  const approvedRules = []
  let structuredRulesText = ''

  try {
    const rulesSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_rules')
      .where('status', '==', 'approved')
      .get()

    if (!rulesSnapshot.empty) {
      rulesSnapshot.docs.forEach((doc) => {
        const r = { id: doc.id, ...doc.data() }
        // Filtrar por escopo (titulo, descricao ou ambos)
        const matchesScope = !r.scopes || r.scopes.includes(promptType) || r.scopes.includes('ambos')
        if (matchesScope) {
          approvedRules.push(r)
        }
      })

      if (approvedRules.length > 0) {
        const rulesFormatted = approvedRules
          .map((r, i) => `[Regra ${i + 1} - ${r.type.toUpperCase()}] (${r.name}): ${r.content || r.description}`)
          .join('\n')
        structuredRulesText = `REGRAS E POLÍTICAS ESTRUTURADAS APROVADAS DO CLIENTE (SEGUIR RIGOROSAMENTE):\n---\n${rulesFormatted}\n---`
      }
    }
  } catch (err) {
    console.warn('[PromptResolver] Aviso ao carregar regras estruturadas:', err.message)
  }

  // 3. Contexto da base de conhecimento do cliente (.md) — TODOS os chunks, em ordem.
  let ragChunksUsed = []
  let ragContextText = ''

  try {
    const chunksSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_chunks')
      .orderBy('chunkIndex')
      .get()

    if (!chunksSnapshot.empty) {
      const allChunks = chunksSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      ragChunksUsed = allChunks.map((c) => c.id)
      const chunksContent = allChunks.map((c) => c.content).join('\n---\n')
      ragContextText = `BASE DE CONHECIMENTO E REGRAS DO CLIENTE:\n---\n${chunksContent}\n---`
    }
  } catch (err) {
    console.warn('[PromptResolver] Aviso ao recuperar contexto RAG:', err.message)
  }

  // Verificar se o cliente possui conhecimento cadastrado (.md ou regras)
  const hasKnowledge = ragChunksUsed.length > 0 || approvedRules.length > 0

  // Se não houver prompt customizado explícito do cliente, definir o envelope adequado:
  // Se houver .md/regras → envelope especializado que dá precedência total ao manual da marca
  // Se NÃO houver .md → fallback padrão clássico
  if (!isCustomClientPrompt) {
    if (hasKnowledge) {
      promptData = getKnowledgeAlignedPrompt(promptType)
    } else if (!promptData) {
      promptData = getHardcodedDefaultPrompt(promptType)
    }
  }

  // 4. Buscar few-shot examples — as 5 gerações aprovadas/editadas MAIS RECENTES.
  let fewShotExamples = []
  try {
    const baseQuery = db
      .collection('generations')
      .where('clientId', '==', clientId)
      .where('generationType', '==', promptType)
      .where('feedbackStatus', 'in', ['approved', 'edited'])

    let fewShotSnapshot
    try {
      fewShotSnapshot = await baseQuery.orderBy('createdAt', 'desc').limit(5).get()
    } catch (indexErr) {
      console.warn(
        '[PromptResolver] Índice composto para orderBy(createdAt) ausente — usando fallback sem ordenação. ' +
          'Crie o índice para que o few-shot use os exemplos mais recentes. Detalhe:',
        indexErr.message
      )
      fewShotSnapshot = await baseQuery.limit(5).get()
    }

    fewShotExamples = fewShotSnapshot.docs.map((doc) => doc.data())
  } catch (err) {
    console.warn('[PromptResolver] Aviso ao buscar few-shots:', err.message)
  }

  // 5. Buscar skills ativas do cliente
  const skillsApplied = []
  let activeSkillsInstructions = []

  try {
    const skillsSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('skills')
      .where('isActive', '==', true)
      .get()

    for (const doc of skillsSnapshot.docs) {
      const skill = doc.data()
      if (skill.promptInjection) {
        let injection = skill.promptInjection
        if (skill.config) {
          for (const [key, value] of Object.entries(skill.config)) {
            injection = injection.replace(
              new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
              String(value)
            )
          }
        }
        activeSkillsInstructions.push(injection)
        skillsApplied.push(doc.id)
      }
    }
  } catch (err) {
    console.warn('[PromptResolver] Aviso ao buscar skills:', err.message)
  }

  // 6. Compilar prompt final — RAG + Regras Estruturadas
  let fullPrompt = ''

  if (structuredRulesText) {
    fullPrompt += `${structuredRulesText}\n\n`
  }

  if (ragContextText) {
    fullPrompt += `${ragContextText}\n\n`
  }

  fullPrompt += `INSTRUÇÕES DE GERAÇÃO E FORMATAÇÃO:\n${promptData.content}`

  // Nota importante: Se houver blocos fixos determinísticos (prepend_exactly), instruir o LLM a focar no bloco técnico
  const hasPrependRules = approvedRules.some((r) => r.application === 'prepend_exactly')
  if (hasPrependRules) {
    fullPrompt += `\n\nATENÇÃO: O texto institucional fixo inicial será inserido automaticamente pelo sistema. Gere APENAS o conteúdo técnico do produto solicitado (frase introdutória + blocos/seções de especificações e recursos). NÃO repita o bloco institucional.`
  }

  // Injetar few-shot
  if (fewShotExamples.length > 0) {
    const examplesBlock = fewShotExamples
      .map((ex, i) => {
        const input = ex.inputTitle || ex.inputDescription || '(sem input)'
        const output = ex.editedText || ex.generatedText
        return `Exemplo ${i + 1}:\nInput: "${input}"\nResultado aprovado: "${output}"`
      })
      .join('\n---\n')

    fullPrompt += `\n\nEXEMPLOS DE RESULTADOS APROVADOS ANTERIORMENTE PARA ESTE CLIENTE:\n---\n${examplesBlock}\n---`
  }

  // Injetar skills
  if (activeSkillsInstructions.length > 0) {
    fullPrompt += `\n\n${activeSkillsInstructions.join('\n\n')}`
  }

  return {
    systemPrompt: fullPrompt,
    version: promptData.version ?? 1,
    fewShotExamples,
    skillsApplied,
    ragChunksUsed,
    approvedRules,
  }
}

/**
 * Prompt alinhado com a Base de Conhecimento (.md) do cliente.
 * Usado quando o cliente possui .md/regras cadastradas, garantindo que
 * o modelo siga a estrutura por categoria, seções em HTML e tom de voz da marca.
 */
function getKnowledgeAlignedPrompt(type) {
  if (type === 'titulo') {
    return {
      version: 1,
      content: `Você é um especialista em SEO e títulos de marketplaces para este cliente.

MISSÃO E DIRETRIZES FUNDAMENTAIS:
1. DIRETRIZES DA MARCA: Siga rigorosamente todas as regras de estrutura, hierarquia, limites de caracteres e formatação estabelecidas na Base de Conhecimento e Regras do cliente acima.
2. LIMPEZA E PADRONIZAÇÃO: Remova códigos, termos proibidos, SKUs e pontuações indevidas conforme orientado nas diretrizes da marca.

PROTOCOLO DE RESPOSTA:
- Retorne EXCLUSIVAMENTE o texto do título otimizado em uma única linha.
- Sem aspas, sem ponto final e sem comentários.`,
    }
  }

  return {
    version: 1,
    content: `Você é o redator técnico e especialista em e-commerce e marketplaces oficial deste cliente.

MISSÃO E DIRETRIZES FUNDAMENTAIS:
1. DIRETRIZES DO CLIENTE: Siga rigorosamente a Base de Conhecimento e as Regras Estruturadas acima, que são a autoridade máxima de estilo, estrutura e regras deste cliente.
2. ESTRUTURA E TEMPLATES: Identifique a categoria do produto e aplique exatamente a estrutura de seções, blocos e listas especificada nas diretrizes da marca para essa categoria (ou o padrão geral/default do manual caso não haja template específico).
3. INTRODUÇÃO E TOM DE VOZ: Siga com fidelidade as regras de frase introdutória, formatação e tom de voz estabelecidas no documento da marca.
4. DADOS TÉCNICOS E ATRIBUTOS: Preencha com precisão os atributos de cada seção correspondentes ao produto anunciado, aplicando as regras de precedência, variantes e especificações do manual.
5. PALAVRAS E PADRÕES PROIBIDOS: Obedeça estritamente à lista de palavras, termos e práticas proibidas pelo cliente.
6. FORMATAÇÃO HTML LIMPA: Utilize apenas HTML válido utilizando as tags permitidas (<p>, <strong>, <ul>, <li>). Não use tags de cabeçalho (<h1>/<h2>/<h3>), emojis, links ou tabelas.

PROTOCOLO DE RESPOSTA:
- Retorne EXCLUSIVAMENTE o código HTML da descrição gerada.
- Não inclua marcadores de código Markdown (\`\`\`html), saudações, notas ou explicações.`,
  }
}

/** Prompts globais de fallback para clientes sem base de conhecimento (.md) */
function getHardcodedDefaultPrompt(type) {
  if (type === 'titulo') {
    return {
      version: 1,
      content: `Você é um especialista sênior em SEO para marketplaces, focado em algoritmos de busca e conversão.

Sua missão é criar o título perfeito para um produto a partir dos dados fornecidos pelo usuário. Siga estas diretrizes com precisão absoluta.

DIRETRIZES DE CONSTRUÇÃO

1. Hierarquia SEO: O título deve seguir obrigatoriamente a estrutura: [Objeto Principal] + [Marca] + [Modelo] + [Atributo Principal].
2. Limite Crítico de 60 Caracteres: O título final deve ter no máximo 60 caracteres, incluindo espaços. Se exceder, corte os atributos da direita para a esquerda, preservando sempre o Tipo de Produto e a Marca.
3. Fidelidade aos Dados: Utilize apenas informações contidas nos dados fornecidos. É estritamente proibido inventar adjetivos, benefícios, tecnologias ou características não mencionadas.
4. Limpeza e Padronização: Use apenas letras e números separados por espaços simples. Remova qualquer caractere especial (*, -, /, !, ?, #), símbolos ou emojis.

RESTRIÇÕES NEGATIVAS (O QUE REMOVER)

- Sem Variações: Proibido incluir cor, tamanho, numeração, voltagem, medidas ou gênero (masculino/feminino).
- Sem Termos Comerciais: Remova palavras como promoção, oferta, grátis, barato, desconto, envio imediato, melhor, original ou equivalentes.
- Sem Redundância: Elimine redundâncias e palavras desnecessárias que não contribuam para a identificação técnica do produto.

PROTOCOLO DE RESPOSTA

- Retorne exclusivamente o texto do título otimizado.
- Uma única linha, sem aspas e sem ponto final.
- Proibido incluir explicações, notas de rodapé ou comentários.
- Formatação OBRIGATÓRIA do Título (Title Case): A primeira letra de cada palavra DEVE ser MAIÚSCULA.`,
    }
  }

  return {
    version: 1,
    content: `Você é um redator profissional especializado em e-commerce e SEO para marketplaces, com foco em conversão e ranqueamento.

Sua tarefa é reescrever e otimizar a descrição do produto com base nos dados fornecidos pelo usuário, seguindo rigorosamente as diretrizes abaixo.

REGRAS OBRIGATÓRIAS

Corrigir erros ortográficos e gramaticais.
Tornar o texto mais claro, objetivo e persuasivo.
Melhorar o SEO utilizando apenas palavras presentes nos dados fornecidos.
Manter exatamente o significado e a proposta original do produto.
Não inventar informações: proibido adicionar especificações técnicas, benefícios, materiais, medidas, compatibilidades ou funcionalidades não informadas.
Não incluir garantias, promessas comerciais, prazos, políticas ou informações legais não fornecidas.
Texto final com no máximo 2000 caracteres (incluindo espaços).

FORMATAÇÃO OBRIGATÓRIA

Utilizar apenas HTML simples com as seguintes tags: <p> para parágrafos, <ul> e <li> para listas.

RESTRIÇÕES

Não usar <h1>, <h2> ou qualquer outro tipo de título HTML.
Não usar emojis, links, tabelas, imagens ou caracteres especiais desnecessários.
Não inserir as palavras: multicolorido ou multicolorida.

PROTOCOLO DE RESPOSTA

Retornar apenas a descrição final.
Somente HTML válido utilizando <p>, <ul> e <li>.
Não incluir comentários, explicações ou qualquer texto fora do HTML.`,
  }
}
