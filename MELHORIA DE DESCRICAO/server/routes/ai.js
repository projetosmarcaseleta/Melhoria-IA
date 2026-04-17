import { Router } from 'express'
import { generateDescricao, generateTitulo } from '../services/openaiService.js'
import { generateDescricaoGemini, generateTituloGemini } from '../services/geminiService.js'

const router = Router()

/**
 * POST /api/process
 * Body: {
 *   products: [{id, title, description, characteristics}],
 *   fields?: ['title','description'],
 *   provider?: 'openai' | 'gemini',   // padrão: 'openai'
 *   geminiApiKey?: string              // necessário se provider === 'gemini'
 * }
 * Response: { results: [{id, newTitle?, newDescription?, error?}] }
 */
router.post('/process', async (req, res, next) => {
  try {
    const { products, fields, provider = 'openai', geminiApiKey } = req.body ?? {}

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products deve ser um array não vazio' })
    }

    const doTitle = !fields || fields.includes('title')
    const doDesc  = !fields || fields.includes('description')
    const useGemini = provider === 'gemini'

    const genTitulo   = (p) => useGemini ? generateTituloGemini(p, geminiApiKey)   : generateTitulo(p)
    const genDescricao = (p) => useGemini ? generateDescricaoGemini(p, geminiApiKey) : generateDescricao(p)

    const results = []

    for (const product of products) {
      try {
        const tasks = await Promise.all([
          doTitle ? genTitulo(product)    : Promise.resolve(null),
          doDesc  ? genDescricao(product) : Promise.resolve(null),
        ])

        const [newTitle, newDescription] = tasks

        if (doTitle && !newTitle) throw new Error(`${useGemini ? 'Gemini' : 'OpenAI'} retornou título vazio.`)
        if (doDesc  && !newDescription) throw new Error(`${useGemini ? 'Gemini' : 'OpenAI'} retornou descrição vazia.`)

        results.push({
          id: product.id,
          ...(doTitle ? { newTitle: newTitle.trim() } : {}),
          ...(doDesc  ? { newDescription: newDescription.trim() } : {}),
        })
      } catch (err) {
        const msg = err?.message ?? String(err)
        console.error(`[AI/${provider}] Erro produto ${product.id}:`, msg)
        results.push({ id: product.id, error: msg })
      }
    }

    return res.json({ results })
  } catch (err) {
    next(err)
  }
})

export default router
