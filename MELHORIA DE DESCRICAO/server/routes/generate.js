import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { resolvePrompt } from '../services/promptResolver.js'
import { generateWithLLM } from '../services/llmService.js'

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

    // Buscar config do cliente no Firestore
    const clientDoc = await db.collection('clients').doc(clientId).get()

    if (!clientDoc.exists) {
      return res.status(404).json({ error: 'Cliente não encontrado.' })
    }

    const clientData = clientDoc.data()
    const settings = clientData.settings ?? {}
    const model = settings.model ?? 'gpt-4o-mini'
    const temperature = settings.temperature ?? 1

    const doTitle = !fields || fields.includes('title')
    const doDesc = !fields || fields.includes('description')

    const results = []

    for (const product of products) {
      try {
        // Resolver prompts com busca de contexto RAG específica para o produto
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

        let [newTitle, newDescription] = tasks

        if (doTitle && !newTitle) throw new Error('LLM retornou título vazio.')
        if (doDesc && !newDescription) throw new Error('LLM retornou descrição vazia.')

        // Aplicar formatação Title Case (primeira letra de cada palavra maiúscula) no título
        if (newTitle) {
          newTitle = toTitleCase(newTitle)
        }

        let titleGenId = null
        let descGenId = null

        // Salvar gerações no Firestore
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
            generatedText: newDescription.trim(),
            feedbackStatus: 'pending',
            createdAt: FieldValue.serverTimestamp(),
          })
        }

        await batch.commit()

        results.push({
          id: product.id,
          ...(doTitle ? { newTitle: newTitle.trim(), titleGenerationId: titleGenId } : {}),
          ...(doDesc ? { newDescription: newDescription.trim(), descGenerationId: descGenId } : {}),
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

    let query = db.collection('generations')
      .where('clientId', '==', clientId)

    if (status) query = query.where('feedbackStatus', '==', status)
    if (type) query = query.where('generationType', '==', type)

    const snapshot = await query
      .limit(Number(limit))
      .get()

    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    return res.json({ data, total: data.length })
  } catch (err) {
    next(err)
  }
})

export default router
