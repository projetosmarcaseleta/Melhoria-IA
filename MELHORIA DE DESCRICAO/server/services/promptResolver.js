import { db } from './firebaseAdmin.js'
import { generateEmbedding, findTopKSimilarChunks } from './ragService.js'

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

  const clientPromptDoc = await db
    .collection('clients')
    .doc(clientId)
    .collection('prompts')
    .doc(promptType)
    .get()

  if (clientPromptDoc.exists && clientPromptDoc.data()?.isActive) {
    promptData = clientPromptDoc.data()
  } else {
    // Fallback para prompt global
    const globalPromptDoc = await db
      .collection('global_prompts')
      .doc(promptType)
      .get()

    if (globalPromptDoc.exists) {
      promptData = globalPromptDoc.data()
    }
  }

  if (!promptData) {
    promptData = getHardcodedDefaultPrompt(promptType)
  }

  // 2. RAG — Buscar contexto relevante da base de conhecimento do cliente (.md)
  let ragChunksUsed = []
  let ragContextText = ''

  if (productData && (productData.title || productData.description)) {
    try {
      // Buscar chunks gravados na subcoleção do cliente ou coleção global
      const chunksSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_chunks')
        .get()

      if (!chunksSnapshot.empty) {
        const queryText = `${productData.title ?? ''} ${productData.description ?? ''} ${productData.characteristics ?? ''}`.trim()
        const queryEmbedding = await generateEmbedding(queryText)

        const allChunks = chunksSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))

        const topChunks = findTopKSimilarChunks(queryEmbedding, allChunks, 3, 0.25)

        if (topChunks.length > 0) {
          ragChunksUsed = topChunks.map((c) => c.id)
          const chunksContent = topChunks.map((c) => c.content).join('\n---\n')
          ragContextText = `BASE DE CONHECIMENTO E REGRAS DO CLIENTE:\n---\n${chunksContent}\n---`
        }
      }
    } catch (err) {
      console.warn('[PromptResolver] Aviso ao recuperar contexto RAG:', err.message)
    }
  }

  // 3. Buscar few-shot examples (gerações aprovadas recentes do cliente)
  let fewShotExamples = []
  try {
    const fewShotSnapshot = await db
      .collection('generations')
      .where('clientId', '==', clientId)
      .where('generationType', '==', promptType)
      .where('feedbackStatus', 'in', ['approved', 'edited'])
      .limit(5)
      .get()

    fewShotExamples = fewShotSnapshot.docs.map((doc) => doc.data())
  } catch (err) {
    console.warn('[PromptResolver] Aviso ao buscar few-shots:', err.message)
  }

  // 4. Buscar skills ativas do cliente
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

  // 5. Compilar prompt final
  let fullPrompt = promptData.content

  // Injetar RAG
  if (ragContextText) {
    fullPrompt += `\n\n${ragContextText}`
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
  }
}

/** Prompts globais de fallback */
function getHardcodedDefaultPrompt(type) {
  if (type === 'titulo') {
    return {
      version: 1,
      content: `Você é um especialista sênior em SEO para marketplaces, focado em algoritmos de busca e conversão.

Sua missão é criar o título perfeito para um produto, processando os dados fornecidos e aplicando um filtro rigoroso de otimização. Siga estas diretrizes com precisão absoluta, pois esta é uma tarefa de processamento de dados estruturados.

DIRETRIZES DE CONSTRUÇÃO

1. Hierarquia SEO: O título deve seguir obrigatoriamente a estrutura: [Objeto Principal] + [Marca] + [Modelo] + [Atributo Principal].
2. Limite Crítico de 60 Caracteres: O título final deve ter no máximo 60 caracteres, incluindo espaços. Se exceder, corte os atributos da direita para a esquerda, preservando sempre o Tipo de Produto e a Marca.
3. Fidelidade aos Dados: Utilize apenas informações contidas nos campos abaixo. É estritamente proibido inventar adjetivos, benefícios, tecnologias ou características não mencionadas.
4. Limpeza e Padronização: Use apenas letras e números separados por espaços simples. Remova qualquer caractere especial (*, -, /, !, ?, #), símbolos ou emojis.

RESTRIÇÕES NEGATIVAS (O QUE REMOVER)

- Sem Variações: Proibido incluir cor, tamanho, numeração, voltagem, medidas ou gênero (masculino/feminino).
- Sem Termos Comerciais: Remova palavras como promoção, oferta, grátis, barato, desconto, envio imediato, melhor, original ou equivalentes.
- Sem Redundância: Elimine redundâncias e palavras desnecessárias que não contribuam para a identificação técnica do produto.

DADOS DISPONÍVEIS

Descrição:
{{description}}

Título original:
{{title}}

PROTOCOLO DE RESPOSTA

- Retorne exclusivamente o texto do título otimizado.
- Uma única linha, sem aspas e sem ponto final.
- Proibido incluir explicações, notas de rodapé ou comentários.
- Formatação OBRIGATÓRIA do Título (Title Case): A primeira letra de cada palavra DEVE ser MAIÚSCULA (exemplo: "Açucareiro Esmaltado Porta Açúcar 450ml Suporte Açúcar").`,
    }
  }

  return {
    version: 1,
    content: `Você é um redator profissional especializado em e-commerce e SEO para marketplaces, com foco em conversão e ranqueamento.

Sua tarefa é reescrever e otimizar a descrição do produto com base nos dados fornecidos, seguindo rigorosamente as diretrizes abaixo.

REGRAS OBRIGATÓRIAS

Corrigir erros ortográficos e gramaticais.
Tornar o texto mais claro, objetivo e persuasivo.
Melhorar o SEO utilizando apenas palavras presentes nos dados fornecidos.
Manter exatamente o significado e a proposta original do produto.
Não inventar informações: proibido adicionar especificações técnicas, benefícios, materiais, medidas, compatibilidades ou funcionalidades não informadas.
Não incluir garantias, promessas comerciais, prazos, políticas ou informações legais não fornecidas.
Texto final com no máximo 2000 caracteres (incluindo espaços).

OTIMIZAÇÃO PARA CONVERSÃO

Iniciar com um parágrafo introdutório direto e comercial, destacando o principal benefício percebido.
Priorizar clareza e leitura rápida (escaneável).
Evitar blocos longos de texto.
Utilizar linguagem simples, objetiva e orientada à decisão de compra.
Evitar repetições e termos genéricos.

REGRAS DE SEO

Inserir naturalmente as principais palavras-chave presentes no título e descrição original.
Não repetir excessivamente palavras-chave (evitar keyword stuffing).
Priorizar termos mais relevantes no início do texto.
Não utilizar sinônimos que não estejam nos dados fornecidos.

FORMATAÇÃO OBRIGATÓRIA

Utilizar apenas HTML simples com as seguintes tags:

<p> para parágrafos
<ul> e <li> para listas

Estrutura obrigatória:

Um parágrafo introdutório
Uma lista com características técnicas ou funcionais

RESTRIÇÕES

Não usar <h1>, <h2> ou qualquer outro tipo de título.
Não usar emojis.
Não usar links.
Não usar tabelas.
Não usar imagens.
Não usar caracteres especiais desnecessários.
Não inserir as palavras: multicolorido ou multicolorida.

DADOS DISPONÍVEIS (UTILIZAR APENAS ESTES)

Título do produto:
{{title}}

Descrição original:
{{description}}

PROTOCOLO DE RESPOSTA

Retornar apenas a descrição final.
Somente HTML válido utilizando <p>, <ul> e <li>.
Não incluir comentários, explicações ou qualquer texto fora do HTML.`,
  }
}
