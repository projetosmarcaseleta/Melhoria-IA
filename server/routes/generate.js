import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { resolvePrompt } from '../services/promptResolver.js'
import { generateWithLLM } from '../services/llmService.js'
import { sanitizeLLMOutput, applyDeterministicRules, validateOutput } from '../services/outputValidator.js'
import { isTestClient, getMockClient, saveMockGeneration, getMockGenerations } from '../services/mockStorage.js'

const router = Router()

export function toTitleCase(str) {
  if (!str) return ''
  const lowerWords = new Set(['de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'com', 'para', 'por', 'e', 'ou', 'a', 'o', 'as', 'os'])

  return str
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index > 0 && lowerWords.has(lower)) {
        return lower
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/**
 * POST /api/generate
 * Body: {
 *   clientId: string,
 *   products: [{ id, title, description, characteristics }],
 *   fields?: ['title', 'description']
 * }
 * Response: { results: [{ id, newTitle?, newDescription?, titleGenerationId?, descGenerationId?, error? }] }
 */
router.post('/', async (req, res, next) => {
  try {
    const { clientId, products, fields } = req.body ?? {}

    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório.' })
    }
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products deve ser um array não vazio.' })
    }

    let settings = {}
    if (isTestClient(clientId)) {
      const client = getMockClient(clientId)
      settings = client.settings ?? {}
    } else {
      try {
        const clientDoc = await db.collection('clients').doc(clientId).get()
        if (clientDoc.exists) {
          settings = clientDoc.data()?.settings ?? {}
        } else {
          settings = getMockClient(clientId).settings ?? {}
        }
      } catch (err) {
        console.warn('[Generate] Aviso ao buscar cliente no Firestore:', err.message)
        settings = getMockClient(clientId).settings ?? {}
      }
    }

    const model = settings.model ?? 'gpt-4o-mini'
    const temperature = settings.temperature ?? 1

    const doTitle = !fields || fields.includes('title')
    const doDesc = !fields || fields.includes('description')

    const results = []

    for (const product of products) {
      try {
        // Resolver prompts com busca de contexto RAG e regras estruturadas
        const [titlePrompt, descPrompt] = await Promise.all([
          doTitle ? resolvePrompt(clientId, 'titulo', product) : Promise.resolve(null),
          doDesc ? resolvePrompt(clientId, 'descricao', product) : Promise.resolve(null),
        ])

        const tasks = await Promise.all([
          doTitle && titlePrompt
            ? generateWithLLM({
                systemPrompt: titlePrompt.systemPrompt,
                productData: product,
                model,
                temperature,
              })
            : Promise.resolve(null),
          doDesc && descPrompt
            ? generateWithLLM({
                systemPrompt: descPrompt.systemPrompt,
                productData: product,
                model,
                temperature,
              })
            : Promise.resolve(null),
        ])

        let [rawTitle, rawDesc] = tasks

        if (doTitle && !rawTitle) throw new Error('LLM retornou título vazio.')
        if (doDesc && !rawDesc) throw new Error('LLM retornou descrição vazia.')

        // 1. Sanitizar saídas (remover cercas de código ```html)
        let newTitle = doTitle ? sanitizeLLMOutput(rawTitle) : ''
        let newDescription = doDesc ? sanitizeLLMOutput(rawDesc) : ''

        // 2. Aplicar formatação Title Case no título
        if (newTitle) {
          newTitle = toTitleCase(newTitle)
        }

        // 3. Aplicação Determinística de Regras Finais (Prepend/Append de textos fixos/institucionais)
        let titleDeterministicRules = []
        let descDeterministicRules = []

        if (doTitle && titlePrompt?.approvedRules) {
          const resTitle = applyDeterministicRules(newTitle, titlePrompt.approvedRules, 'titulo')
          newTitle = resTitle.finalOutput
          titleDeterministicRules = resTitle.deterministicRulesApplied
        }

        if (doDesc && descPrompt?.approvedRules) {
          const resDesc = applyDeterministicRules(newDescription, descPrompt.approvedRules, 'descricao')
          newDescription = resDesc.finalOutput
          descDeterministicRules = resDesc.deterministicRulesApplied
        }

        // 4. Validação Pós-Geração contra proibições e regras
        const titleValidation = doTitle ? validateOutput(newTitle, titlePrompt?.approvedRules ?? [], 'titulo') : null
        const descValidation = doDesc ? validateOutput(newDescription, descPrompt?.approvedRules ?? [], 'descricao') : null

        let titleGenId = `gen-title-${Date.now()}-${product.id}`
        let descGenId = `gen-desc-${Date.now()}-${product.id}`

        // Se for cliente teste, grava na memória
        if (isTestClient(clientId)) {
          if (doTitle && newTitle && titlePrompt) {
            const saved = saveMockGeneration({
              id: titleGenId,
              clientId,
              operatorId: req.user?.id ?? 'test-operator-id',
              productId: String(product.id),
              generationType: 'titulo',
              inputTitle: product.title ?? '',
              inputDescription: product.description ?? '',
              inputCharacteristics: product.characteristics ?? '',
              promptVersion: titlePrompt.version,
              modelUsed: model,
              temperatureUsed: temperature,
              skillsApplied: titlePrompt.skillsApplied,
              ragChunksUsed: titlePrompt.ragChunksUsed ?? [],
              deterministicRulesApplied: titleDeterministicRules,
              validationResult: titleValidation,
              generatedText: newTitle.trim(),
              feedbackStatus: 'pending',
            })
            titleGenId = saved.id
          }

          if (doDesc && newDescription && descPrompt) {
            const saved = saveMockGeneration({
              id: descGenId,
              clientId,
              operatorId: req.user?.id ?? 'test-operator-id',
              productId: String(product.id),
              generationType: 'descricao',
              inputTitle: product.title ?? '',
              inputDescription: product.description ?? '',
              inputCharacteristics: product.characteristics ?? '',
              promptVersion: descPrompt.version,
              modelUsed: model,
              temperatureUsed: temperature,
              skillsApplied: descPrompt.skillsApplied,
              ragChunksUsed: descPrompt.ragChunksUsed ?? [],
              deterministicRulesApplied: descDeterministicRules,
              validationResult: descValidation,
              generatedText: newDescription.trim(),
              feedbackStatus: 'pending',
            })
            descGenId = saved.id
          }
        } else {
          // Salvar gerações no Firestore com fallback
          try {
            const batch = db.batch()

            if (doTitle && newTitle && titlePrompt) {
              const titleRef = db.collection('generations').doc()
              titleGenId = titleRef.id

              batch.set(titleRef, {
                clientId,
                operatorId: req.user.id,
                productId: String(product.id),
                generationType: 'titulo',
                inputTitle: product.title ?? '',
                inputDescription: product.description ?? '',
                inputCharacteristics: product.characteristics ?? '',
                promptVersion: titlePrompt.version,
                modelUsed: model,
                temperatureUsed: temperature,
                skillsApplied: titlePrompt.skillsApplied,
                ragChunksUsed: titlePrompt.ragChunksUsed ?? [],
                deterministicRulesApplied: titleDeterministicRules,
                validationResult: titleValidation,
                generatedText: newTitle.trim(),
                feedbackStatus: 'pending',
                createdAt: FieldValue.serverTimestamp(),
              })
            }

            if (doDesc && newDescription && descPrompt) {
              const descRef = db.collection('generations').doc()
              descGenId = descRef.id

              batch.set(descRef, {
                clientId,
                operatorId: req.user.id,
                productId: String(product.id),
                generationType: 'descricao',
                inputTitle: product.title ?? '',
                inputDescription: product.description ?? '',
                inputCharacteristics: product.characteristics ?? '',
                promptVersion: descPrompt.version,
                modelUsed: model,
                temperatureUsed: temperature,
                skillsApplied: descPrompt.skillsApplied,
                ragChunksUsed: descPrompt.ragChunksUsed ?? [],
                deterministicRulesApplied: descDeterministicRules,
                validationResult: descValidation,
                generatedText: newDescription.trim(),
                feedbackStatus: 'pending',
                createdAt: FieldValue.serverTimestamp(),
              })
            }

            await batch.commit()
          } catch (batchErr) {
            console.warn('[Generate] Aviso ao salvar geração no Firestore (salvando em memória temporária):', batchErr.message)
            // Fallback para mockStore para não quebrar a geração
            if (doTitle && newTitle) {
              saveMockGeneration({
                id: titleGenId,
                clientId,
                operatorId: req.user?.id ?? 'test-operator',
                productId: String(product.id),
                generationType: 'titulo',
                generatedText: newTitle.trim(),
                feedbackStatus: 'pending',
              })
            }
            if (doDesc && newDescription) {
              saveMockGeneration({
                id: descGenId,
                clientId,
                operatorId: req.user?.id ?? 'test-operator',
                productId: String(product.id),
                generationType: 'descricao',
                generatedText: newDescription.trim(),
                feedbackStatus: 'pending',
              })
            }
          }
        }

        results.push({
          id: product.id,
          ...(doTitle
            ? {
                newTitle: newTitle.trim(),
                titleGenerationId: titleGenId,
                titleValidation: titleValidation,
                titleRulesApplied: titleDeterministicRules,
              }
            : {}),
          ...(doDesc
            ? {
                newDescription: newDescription.trim(),
                descGenerationId: descGenId,
                descValidation: descValidation,
                descRulesApplied: descDeterministicRules,
              }
            : {}),
        })
      } catch (err) {
        const msg = err?.message ?? String(err)
        console.error(`[Generate] Erro produto ${product.id}:`, msg)
        results.push({ id: product.id, error: msg })
      }
    }

    return res.json({ results })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/generate/history/:clientId
 * Lista histórico de gerações de um cliente.
 */
router.get('/history/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { limit = 50, status, type } = req.query

    if (isTestClient(clientId)) {
      const data = getMockGenerations(clientId, Number(limit))
      return res.json({ data, total: data.length })
    }

    try {
      let query = db.collection('generations')
        .where('clientId', '==', clientId)

      if (status) query = query.where('feedbackStatus', '==', status)
      if (type) query = query.where('generationType', '==', type)

      const snapshot = await query
        .limit(Number(limit))
        .get()

      return res.json({ data, total: data.length })
    } catch (err) {
      console.warn('[GenerateHistory] Aviso Firestore:', err.message)
      const data = getMockGenerations(clientId, Number(limit))
      return res.json({ data, total: data.length })
    }
  } catch (err) {
    next(err)
  }
})

export default router


