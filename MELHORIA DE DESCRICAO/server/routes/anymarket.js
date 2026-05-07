import { Router } from 'express'
import axios from 'axios'

const router = Router()

// Webhook URL lido do .env — não exposto ao frontend
const ANYMARKET_WEBHOOK_URL = process.env.ANYMARKET_WEBHOOK_URL || ''

/**
 * POST /api/anymarket/patch
 * Body: { productId, title, description, gumgaToken }
 *
 * Sempre envia title + description no PATCH para evitar que a AnyMarket apague
 * campos omitidos. O chamador é responsável por passar o valor correto
 * (novo ou original) para cada campo.
 *
 * Rota via webhook n8n — a URL é definida no .env do servidor.
 */
router.post('/patch', async (req, res, next) => {
  try {
    const { productId, title, description, gumgaToken } = req.body ?? {}

    if (!productId) return res.status(400).json({ error: 'productId é obrigatório.' })
    if (!gumgaToken) return res.status(400).json({ error: 'gumgaToken é obrigatório.' })

    const patchBody = { title, description }

    console.log(`[AnyMarket] Produto ${productId} → PATCH | title: ${title?.slice?.(0,40)} | description: ${description?.slice?.(0,40)}`)

    if (!ANYMARKET_WEBHOOK_URL) {
      return res.status(500).json({ error: 'ANYMARKET_WEBHOOK_URL não configurada no .env do servidor.' })
    }

    console.log(`[AnyMarket] Produto ${productId} → via webhook n8n`)

    const n8nResponse = await axios.post(
      ANYMARKET_WEBHOOK_URL,
      { productId, ...patchBody, gumgaToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 55_000 }
    )

    return res.json({ ok: true, status: n8nResponse.status, data: n8nResponse.data })
  } catch (err) {
    if (err.response) {
      const { status, data } = err.response
      console.error(`[AnyMarket] Produto ${req.body?.productId} → HTTP ${status}:`, data)
      return res.status(status).json({ error: `AnyMarket retornou ${status}`, detail: data })
    }
    next(err)
  }
})

/**
 * POST /api/anymarket/fetch-products
 * Body: { ids: ["123","456",...] }
 *
 * Proxy para o webhook n8n de consulta PostgreSQL.
 * A URL é definida no .env do servidor (N8N_CONSULTA_WEBHOOK_URL).
 */
router.post('/fetch-products', async (req, res, next) => {
  try {
    const { ids } = req.body ?? {}
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids deve ser um array não vazio.' })
    }

    const webhookUrl = process.env.N8N_CONSULTA_WEBHOOK_URL
    if (!webhookUrl) {
      return res.status(500).json({ error: 'N8N_CONSULTA_WEBHOOK_URL não configurada no .env do servidor.' })
    }

    console.log(`[Webhook] Consultando ${ids.length} IDs via n8n...`)

    const response = await axios.post(
      webhookUrl,
      { ids },
      { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 }
    )

    return res.json(response.data)
  } catch (err) {
    if (err.response) {
      const { status, data } = err.response
      console.error(`[Webhook] Consulta falhou → HTTP ${status}:`, data)
      return res.status(status).json({ error: `Webhook retornou ${status}`, detail: data })
    }
    next(err)
  }
})

export default router
