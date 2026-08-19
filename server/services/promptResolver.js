import { db } from './firebaseAdmin.js'
import {
  isTestClient,
  getMockPrompt,
  getMockRules,
  getMockSkills,
  getMockGenerations,
} from './mockStorage.js'
import { DEFAULT_SKILLS } from '../routes/skills.js'
import { promptCache } from './promptCache.js'
import { composePrompt } from './promptCore.js'
import { firestoreMeter } from './firestoreMeter.js'

/**
 * Resolve o prompt final para um cliente + tipo de geração no Firestore.
 *
 * Lógica:
 * 1. Verifica cache em memória (TTL) para evitar leituras repetidas no Firestore
 * 2. Busca prompt ativo do cliente (doc path: clients/{clientId}/prompts/{type})
 * 3. Se não encontrar → usa prompt global default
 * 4. Enriquece com RAG (base de conhecimento .md do cliente)
 * 5. Enriquece com few-shot examples de gerações aprovadas
 * 6. Enriquece com instruções de skills ativas
 */
export async function resolvePrompt(clientId, promptType, productData = null) {
  // Verificar cache em memória
  const cached = promptCache.get(clientId, promptType)
  if (cached) {
    return cached
  }

  const isMock = isTestClient(clientId)

  // 1. Buscar prompt customizado do cliente
  let promptData = null
  let isCustomClientPrompt = false
  // De onde saiu o texto-base. Exposto no retorno porque a tela de edição precisa
  // mostrar ao operador QUAL prompt está valendo — havia divergência silenciosa entre
  // o "padrão" exibido na interface e o que o gerador realmente usava.
  let source = 'none'

  if (isMock) {
    promptData = getMockPrompt(clientId, promptType)
    if (promptData) { isCustomClientPrompt = true; source = 'client' }
  } else {
    try {
      const clientPromptDoc = await db
        .collection('clients')
        .doc(clientId)
        .collection('prompts')
        .doc(promptType)
        .get()

      firestoreMeter.record('promptResolver:prompt', 'reads', 1)
      if (clientPromptDoc.exists && clientPromptDoc.data()?.isActive) {
        promptData = clientPromptDoc.data()
        isCustomClientPrompt = true
        source = 'client'
      }
    } catch (err) {
      console.warn('[PromptResolver] Aviso ao buscar prompt do cliente:', err.message)
    }

    if (!promptData) {
      try {
        // Fallback para prompt global salvo no Firestore
        const globalPromptDoc = await db
          .collection('global_prompts')
          .doc(promptType)
          .get()

        if (globalPromptDoc.exists) {
          promptData = globalPromptDoc.data()
          source = 'global'
        }
      } catch (err) {
        console.warn('[PromptResolver] Aviso ao buscar prompt global:', err.message)
      }
    }
  }

  // 'categoria' é escopo ESTRITO: regra ou skill marcada como 'ambos' foi escrita
  // pensando em texto de anúncio (bloco institucional, tom de voz, HTML) e poluiria
  // o classificador de categoria, cuja saída é JSON consumido por código.
  const strictScope = promptType === 'categoria'
  const scopeMatches = (scopes) => {
    if (strictScope) return Array.isArray(scopes) && scopes.includes('categoria')
    return !scopes || scopes.includes(promptType) || scopes.includes('ambos')
  }

  // 2. Regras Estruturadas Aprovadas do Cliente (knowledge_rules)
  const approvedRules = []
  let structuredRulesText = ''

  if (isMock) {
    const mockRules = getMockRules(clientId, true)
    mockRules.forEach((r) => {
      const matchesScope = scopeMatches(r.scopes)
      if (matchesScope) {
        approvedRules.push(r)
      }
    })
  } else {
    try {
      const rulesSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_rules')
        .where('status', '==', 'approved')
        .get()

      firestoreMeter.record('promptResolver:rules', 'reads', Math.max(1, rulesSnapshot.size))
      if (!rulesSnapshot.empty) {
        rulesSnapshot.docs.forEach((doc) => {
          const r = { id: doc.id, ...doc.data() }
          // Filtrar por escopo (titulo, descricao ou ambos)
          const matchesScope = scopeMatches(r.scopes)
          if (matchesScope) {
            approvedRules.push(r)
          }
        })
      }
    } catch (err) {
      console.warn('[PromptResolver] Aviso ao carregar regras estruturadas (usando fallback mock):', err.message)
      const mockRules = getMockRules(clientId, true)
      mockRules.forEach((r) => {
        const matchesScope = scopeMatches(r.scopes)
        if (matchesScope) approvedRules.push(r)
      })
    }
  }

  if (approvedRules.length > 0) {
    const rulesFormatted = approvedRules
      .map((r, i) => `[Regra ${i + 1} - ${r.type.toUpperCase()}] (${r.name}): ${r.content || r.description}`)
      .join('\n')
    structuredRulesText = `REGRAS E POLÍTICAS ESTRUTURADAS APROVADAS DO CLIENTE (SEGUIR RIGOROSAMENTE):\n---\n${rulesFormatted}\n---`
  }

  // 3. Contexto da base de conhecimento do cliente (.md) — TODOS os chunks, em ordem.
  // Só é injetado para 'descricao': o manual do cliente documenta estrutura/HTML da descrição,
  // e despejar esse conteúdo no prompt de 'titulo' vaza instruções de descrição para o título.
  let ragChunksUsed = []
  let ragContextText = ''

  if (!isMock && promptType === 'descricao') {
    try {
      const chunksSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_chunks')
        .orderBy('chunkIndex')
        .get()

      firestoreMeter.record('promptResolver:chunks', 'reads', Math.max(1, chunksSnapshot.size))
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
  }

  // Se o cliente definiu um prompt customizado explicitamente, respeitamos esse prompt.
  // Caso contrário, se houver Base de Conhecimento (.md/regras), usamos getKnowledgeAlignedPrompt.
  // Se não houver nada, usamos o prompt default global.
  const hasKnowledge = ragChunksUsed.length > 0 || approvedRules.length > 0

  if (!isCustomClientPrompt) {
    if (hasKnowledge) {
      promptData = getKnowledgeAlignedPrompt(promptType)
      source = 'knowledge_aligned'
    } else if (!promptData) {
      promptData = getHardcodedDefaultPrompt(promptType)
      source = 'hardcoded'
    }
  }

  // 4. Buscar few-shot examples — as 5 gerações aprovadas/editadas MAIS RECENTES.
  let fewShotExamples = []
  if (isMock) {
    fewShotExamples = getMockGenerations(clientId, 5).filter(
      (g) => g.generationType === promptType && ['approved', 'edited'].includes(g.feedbackStatus)
    )
  } else {
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
        fewShotSnapshot = await baseQuery.limit(5).get()
      }

      firestoreMeter.record('promptResolver:fewShot', 'reads', Math.max(1, fewShotSnapshot.size))
      fewShotExamples = fewShotSnapshot.docs.map((doc) => doc.data())
    } catch (err) {
      console.warn('[PromptResolver] Aviso ao buscar few-shots:', err.message)
      fewShotExamples = getMockGenerations(clientId, 5)
    }
  }

  // 5. Buscar skills ativas do cliente
  // Cada skill tem um `scope` ('titulo' | 'descricao' | 'ambos') no catálogo DEFAULT_SKILLS.
  // Sem esse filtro, uma skill como 'html_spec_formatter' (que só faz sentido pra descrição)
  // vazava sua instrução de formatação HTML pro prompt do título também.
  const skillScopeById = Object.fromEntries(DEFAULT_SKILLS.map((s) => [s.id, s.scope || 'ambos']))
  const matchesSkillScope = (scope) => (strictScope ? scope === 'categoria' : !scope || scope === 'ambos' || scope === promptType)

  const skillsApplied = []
  const activeSkillsConfig = {}
  let activeSkillsInstructions = []

  if (isMock) {
    const mockSkills = getMockSkills(clientId, DEFAULT_SKILLS)
    mockSkills.filter((s) => s.isActive && matchesSkillScope(s.scope)).forEach((skill) => {
      let injection = skill.promptInjection
      if (skill.config) {
        for (const [key, value] of Object.entries(skill.config)) {
          injection = injection.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
        }
      }
      activeSkillsInstructions.push(injection)
      skillsApplied.push(skill.id)
      activeSkillsConfig[skill.id] = skill.config
    })
  } else {
    try {
      const skillsSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('skills')
        .where('isActive', '==', true)
        .get()

      firestoreMeter.record('promptResolver:skills', 'reads', Math.max(1, skillsSnapshot.size))
      for (const doc of skillsSnapshot.docs) {
        const skill = doc.data()
        if (skill.promptInjection && matchesSkillScope(skillScopeById[doc.id])) {
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
          activeSkillsConfig[doc.id] = skill.config
        }
      }
    } catch (err) {
      console.warn('[PromptResolver] Aviso ao buscar skills (usando fallback mock):', err.message)
      const mockSkills = getMockSkills(clientId, DEFAULT_SKILLS)
      mockSkills.filter((s) => s.isActive && matchesSkillScope(s.scope)).forEach((skill) => {
        let injection = skill.promptInjection
        if (skill.config) {
          for (const [key, value] of Object.entries(skill.config)) {
            injection = injection.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
          }
        }
        activeSkillsInstructions.push(injection)
        skillsApplied.push(skill.id)
        activeSkillsConfig[skill.id] = skill.config
      })
    }
  }

  // 6. Compilar prompt final
  //
  // COMPOSIÇÃO, não substituição (ver promptCore.js): o núcleo do sistema entra sempre,
  // a personalização do cliente soma por cima, e o protocolo de resposta fecha o texto.
  //
  // `promptMode` do documento do cliente decide como tratar o texto salvo:
  //   'append'  → é personalização; soma ao núcleo
  //   'replace' → é o prompt inteiro (comportamento legado)
  // Documento salvo ANTES desta mudança não tem o campo, e é tratado como 'replace' —
  // é o que garante que nenhum cliente em produção mude de comportamento sem escolher.
  const hasPrependRules = approvedRules.some((r) => r.application === 'prepend_exactly')
  const promptMode = isCustomClientPrompt ? promptData.promptMode ?? 'replace' : 'append'

  let clientInstructions = null
  let fullReplacement = null

  if (promptType === 'categoria') {
    // O classificador de categoria tem prompt próprio inteiro (getCategoryPrompt) e não
    // participa da composição de título/descrição.
    fullReplacement = promptData.content
  } else if (source === 'client') {
    if (promptMode === 'append') clientInstructions = promptData.content
    else fullReplacement = promptData.content
  } else if (source === 'global') {
    fullReplacement = promptData.content
  }
  // 'knowledge_aligned' e 'hardcoded' → só o NÚCLEO do sistema, sem texto extra:
  // o núcleo já contém as diretrizes gerais, e o manual da marca entra como camada
  // com aviso de precedência em vez de substituir o prompt inteiro.

  const fewShotText =
    fewShotExamples.length > 0
      ? (() => {
          const examplesBlock = fewShotExamples
            .map((ex, i) => {
              const input = ex.inputTitle || ex.inputDescription || '(sem input)'
              const output = ex.editedText || ex.generatedText
              return `Exemplo ${i + 1}:\nInput: "${input}"\nResultado aprovado: "${output}"`
            })
            .join('\n---\n')

          return hasKnowledge
            ? `EXEMPLOS DE RESULTADOS APROVADOS ANTERIORMENTE (referência de tom; a estrutura de seções da Base de Conhecimento prevalece):\n---\n${examplesBlock}\n---`
            : `EXEMPLOS DE RESULTADOS APROVADOS ANTERIORMENTE PARA ESTE CLIENTE:\n---\n${examplesBlock}\n---`
        })()
      : ''

  const fullPrompt = composePrompt({
    type: promptType,
    clientInstructions,
    fullReplacement,
    structuredRulesText,
    ragContextText,
    fewShotText,
    skillsText: activeSkillsInstructions.join('\n\n'),
    hasKnowledge,
    hasPrependRules,
  })

  const resolvedResult = {
    systemPrompt: fullPrompt,
    source,
    promptMode,
    basePromptContent: promptData.content,
    version: promptData.version ?? 1,
    fewShotExamples,
    skillsApplied,
    activeSkillsConfig,
    ragChunksUsed,
    approvedRules,
  }

  // Armazenar no cache em memória
  promptCache.set(clientId, promptType, resolvedResult)

  return resolvedResult
}

/**
 * Prompt alinhado com a Base de Conhecimento (.md) do cliente.
 * Usado quando o cliente possui .md/regras cadastradas, garantindo que
 * o modelo siga a estrutura por categoria, seções em HTML e tom de voz da marca.
 */
function getKnowledgeAlignedPrompt(type) {
  if (type === 'categoria') return getCategoryPrompt()

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

/**
 * Prompt do classificador de categorias.
 *
 * Não tem variante "alinhada à base de conhecimento": a âncora deste prompt é a
 * ÁRVORE do cliente (decisão D3), injetada em tempo de execução pelo
 * categoryTreeProfiler. Manual de marca fala de texto de anúncio, não de taxonomia.
 */
export function getCategoryPrompt() {
  return {
    version: 1,
    content: `Você é um especialista em taxonomia de catálogo para marketplaces brasileiros.

TAREFA
A partir dos dados de um produto e da árvore de categorias atual do cliente (fornecida no contexto), indique o caminho hierárquico de categoria mais adequado para esse produto.

DIRETRIZES
1. ENCAIXE, NÃO INVENTE: use um departamento (nível 0) já existente na árvore do cliente. Criar departamento novo é último recurso.
2. REUSO MÁXIMO: aproveite o caminho existente mais profundo que servir; proponha nome novo apenas para o nível realmente ausente.
3. VOCABULÁRIO DO CLIENTE: use os termos que já aparecem na árvore, não sinônimos.
4. UM CONCEITO POR NÍVEL: cada item de "path" é o nome de UM nó. Nunca use vírgula, barra, ">" ou "e" ligando dois conceitos distintos dentro de um nome.
5. NOMES DE CATEGORIA: substantivo, preferencialmente plural. Proibido: marca, modelo, medida, voltagem, código/SKU, termo genérico ("Outros", "Diversos", "Geral").
6. FIDELIDADE: classifique pelo que o produto É, não pelo que ele acompanha ou pelo público-alvo.

PROTOCOLO DE RESPOSTA
- Responda EXCLUSIVAMENTE no formato JSON definido pelo schema.
- "path": do departamento à folha, ex: ["Automotivo", "Acessórios", "Tapetes"].
- "matchType": "existing" (caminho inteiro já existe), "extend" (só os últimos níveis são novos) ou "new" (nem o departamento existe).
- "existingCategoryId": id do nó existente mais profundo que você reconheceu no caminho, ou null.
- "confidence": 0 a 1, honesto — abaixo de 0.6 significa que você não teve dados suficientes.
- "reasoning": uma frase curta explicando a escolha.`,
  }
}

/** Prompts globais de fallback para clientes sem base de conhecimento (.md) */
function getHardcodedDefaultPrompt(type) {
  if (type === 'categoria') return getCategoryPrompt()

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
