import { Router } from 'express'
import { db } from '../services/firebaseAdmin.js'
import OpenAI from 'openai'

const router = Router()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Função utilitária para extrair n-gramas / palavras frequentes
 */
function extractWordFrequencies(texts, stopWords = []) {
  const defaultStopWords = new Set([
    'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
    'com', 'por', 'para', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
    'e', 'ou', 'se', 'que', 'mais', 'como', 'sem', 'sua', 'seu', 'suas', 'seus',
    'ao', 'aos', 'à', 'às', 'este', 'esta', 'isto', 'esse', 'essa', 'isso',
    ...stopWords,
  ])

  const freqMap = {}

  for (const text of texts) {
    if (!text || typeof text !== 'string') continue
    const words = text
      .toLowerCase()
      .replace(/[^\w\sà-ú]/g, '')
      .split(/\s+/)

    for (const w of words) {
      if (w.length > 2 && !defaultStopWords.has(w)) {
        freqMap[w] = (freqMap[w] || 0) + 1
      }
    }
  }

  return Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }))
}

import { isTestClient, getMockGenerations, getMockPrompt } from '../services/mockStorage.js'

/**
 * GET /api/insights/:clientId
 * Retorna análise detalhada de métricas e padrões de aprendizado do cliente.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    let allGens = []
    if (isTestClient(clientId)) {
      allGens = getMockGenerations(clientId, 100)
    } else {
      try {
        const snapshot = await db
          .collection('generations')
          .where('clientId', '==', clientId)
          .get()

        allGens = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      } catch (err) {
        console.warn('[Insights] Aviso Firestore:', err.message)
        allGens = getMockGenerations(clientId, 100)
      }
    }

    const titleGens = allGens.filter((g) => g.generationType === 'titulo')
    const descGens = allGens.filter((g) => g.generationType === 'descricao')

    const computeTypeStats = (gens) => {
      const total = gens.length
      const approved = gens.filter((g) => g.feedbackStatus === 'approved')
      const rejected = gens.filter((g) => g.feedbackStatus === 'rejected')
      const edited = gens.filter((g) => g.feedbackStatus === 'edited')
      const evaluated = approved.length + rejected.length + edited.length

      const approvalRate = evaluated > 0 ? (approved.length + edited.length) / evaluated : 0

      // Comprimentos médios
      const approvedTexts = [...approved, ...edited].map((g) => g.editedText || g.generatedText || '')
      const rejectedTexts = rejected.map((g) => g.generatedText || '')

      const avgApprovedLength = approvedTexts.length > 0
        ? Math.round(approvedTexts.reduce((acc, t) => acc + t.length, 0) / approvedTexts.length)
        : 0

      const avgRejectedLength = rejectedTexts.length > 0
        ? Math.round(rejectedTexts.reduce((acc, t) => acc + t.length, 0) / rejectedTexts.length)
        : 0

      // Frequência de palavras
      const topApprovedWords = extractWordFrequencies(approvedTexts)
      const topRejectedWords = extractWordFrequencies(rejectedTexts)

      // Recomendações automáticas
      const recommendations = []
      if (evaluated >= 5) {
        if (approvalRate < 0.6) {
          recommendations.push('A taxa de aprovação está abaixo de 60%. Considere gerar um refinamento de prompt via Meta-Prompt.')
        } else if (approvalRate >= 0.85) {
          recommendations.push('Excelente taxa de aprovação! A IA está bem alinhada com as preferências do cliente.')
        }

        if (avgApprovedLength > 0 && avgRejectedLength > 0) {
          if (avgRejectedLength > avgApprovedLength + 10) {
            recommendations.push(`Textos rejeitados são em média ${avgRejectedLength - avgApprovedLength} caracteres mais longos que os aprovados. Instrua a IA a ser mais concisa.`)
          }
        }

        if (topRejectedWords.length > 0) {
          const frequentRejected = topRejectedWords.filter((w) => w.count >= 2).map((w) => w.word)
          if (frequentRejected.length > 0) {
            recommendations.push(`Termos frequentemente presentes em rejeições: ${frequentRejected.slice(0, 5).join(', ')}.`)
          }
        }
      }

      return {
        total,
        evaluated,
        approved: approved.length,
        rejected: rejected.length,
        edited: edited.length,
        approvalRate: Math.round(approvalRate * 1000) / 10, // ex: 85.5%
        avgApprovedLength,
        avgRejectedLength,
        topApprovedWords,
        topRejectedWords,
        recommendations,
      }
    }

    return res.json({
      titleStats: computeTypeStats(titleGens),
      descStats: computeTypeStats(descGens),
      totalGenerations: allGens.length,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/insights/:clientId/meta-prompt
 * Usa o GPT-4o para analisar o prompt atual + histórico de aprovações/rejeições e sugerir um prompt refinado.
 * Body: { promptType: 'titulo' | 'descricao' }
 */
router.post('/:clientId/meta-prompt', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { promptType } = req.body ?? {}

    if (!['titulo', 'descricao'].includes(promptType)) {
      return res.status(400).json({ error: 'promptType deve ser "titulo" ou "descricao".' })
    }

    // 1. Buscar prompt atual do cliente (ou global)
    let currentPromptDoc = await db
      .collection('clients')
      .doc(clientId)
      .collection('prompts')
      .doc(promptType)
      .get()

    let currentContent = ''
    if (currentPromptDoc.exists && currentPromptDoc.data()?.content) {
      currentContent = currentPromptDoc.data().content
    } else {
      const globalDoc = await db.collection('global_prompts').doc(promptType).get()
      currentContent = globalDoc.data()?.content ?? ''
    }

    // 2. Buscar exemplos aprovados e rejeitados
    const snapshot = await db
      .collection('generations')
      .where('clientId', '==', clientId)
      .where('generationType', '==', promptType)
      .limit(30)
      .get()

    const gens = snapshot.docs.map((d) => d.data())
    const approved = gens.filter((g) => ['approved', 'edited'].includes(g.feedbackStatus)).slice(0, 8)
    const rejected = gens.filter((g) => g.feedbackStatus === 'rejected').slice(0, 8)

    if (approved.length === 0 && rejected.length === 0) {
      return res.status(400).json({
        error: 'É necessário ter ao menos 5 avaliações de feedback gravadas para gerar a otimização de prompt.',
      })
    }

    const approvedFormatted = approved
      .map((g, i) => `[Aprovado ${i + 1}]\nInput: ${g.inputTitle || g.inputDescription}\nResultado: ${g.editedText || g.generatedText}`)
      .join('\n\n')

    const rejectedFormatted = rejected
      .map((g, i) => `[Rejeitado ${i + 1}]\nInput: ${g.inputTitle || g.inputDescription}\nResultado gerado: ${g.generatedText}${g.feedbackReason ? `\nRazão: ${g.feedbackReason}` : ''}`)
      .join('\n\n')

    // 3. Chamada ao Meta-LLM (GPT-4o) para reformulação
    const systemInstruction = `Você é um Meta-Engenheiro de Prompts especialista em e-commerce e SEO.
Sua tarefa é analisar o prompt atual utilizado para um cliente, comparar com os exemplos que foram APROVADOS e REJEITADOS pelo cliente humano, e reescrever o prompt para torná-lo significativamente mais eficaz.

Instruções para o novo prompt:
- Mantenha a estrutura geral e variáveis como {{title}}, {{description}}, {{characteristics}}.
- Adicione regras negativas ou restrições claras para EVITAR o que causou as rejeições.
- Adicione orientações de estilo ou tom que refletem os exemplos aprovados.
- Retorne APENAS um JSON válido com a seguinte estrutura:
{
  "improvedPrompt": "texto completo do novo prompt sugerido",
  "explanation": "explicação concisa de 3 a 5 tópicos mostrando quais melhorias foram feitas e o porquê"
}`

    const userPrompt = `PROMPT ATUAL:
\`\`\`
${currentContent}
\`\`\`

EXEMPLOS APROVADOS PELO CLIENTE:
${approvedFormatted || '(Nenhum ainda)'}

EXEMPLOS REJEITADOS PELO CLIENTE:
${rejectedFormatted || '(Nenhum ainda)'}

Gere o prompt otimizado no formato JSON solicitado.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt },
      ],
    })

    const result = JSON.parse(response.choices[0].message.content)

    return res.json({
      currentPrompt: currentContent,
      improvedPrompt: result.improvedPrompt,
      explanation: result.explanation,
      samplesAnalyzed: { approvedCount: approved.length, rejectedCount: rejected.length },
    })
  } catch (err) {
    next(err)
  }
})

export default router
