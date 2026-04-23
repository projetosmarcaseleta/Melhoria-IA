import { Router } from 'express'
import axios from 'axios'

const router = Router()

const ANYMARKET_BASE = 'https://api.anymarket.com.br/v2/products'

/**
 * POST /api/anymarket/patch
 * Body: { productId, title, description, gumgaToken, webhookUrl? }
 *
 * Sempre envia title + description no PATCH para evitar que a AnyMarket apague
 * campos omitidos. O chamador é responsável por passar o valor correto
 * (novo ou original) para cada campo.
 */
router.post('/patch', async (req, res, next) => {
  try {
    const { productId, title, description, gumgaToken, webhookUrl } = req.body ?? {}

    if (!productId) return res.status(400).json({ error: 'productId é obrigatório.' })
    if (!gumgaToken) return res.status(400).json({ error: 'gumgaToken é obrigatório.' })

    const patchBody = { title, description }

    console.log(`[AnyMarket] Produto ${productId} → PATCH | title: ${title?.slice?.(0,40)} | description: ${description?.slice?.(0,40)}`)

    // ── Modo webhook: delega ao n8n ──────────────────────────────────────
    if (webhookUrl) {
      console.log(`[AnyMarket] Produto ${productId} → via webhook n8n: ${webhookUrl}`)

      const n8nResponse = await axios.post(
        webhookUrl,
        { productId, ...patchBody, gumgaToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 55_000 }
      )

      return res.json({ ok: true, mode: 'webhook', status: n8nResponse.status, data: n8nResponse.data })
    }

    // ── Modo backend: PATCH direto na AnyMarket ──────────────────────────

    const response = await axios.patch(
      `${ANYMARKET_BASE}/${productId}`,
      patchBody,
      {
        headers: { gumgaToken, 'Content-Type': 'application/merge-patch+json' },
        timeout: 30_000,
      }
    )

    return res.json({ ok: true, mode: 'backend', status: response.status })
  } catch (err) {
    if (err.response) {
      const { status, data } = err.response
      console.error(`[AnyMarket] Produto ${req.body?.productId} → HTTP ${status}:`, data)
      return res.status(status).json({ error: `AnyMarket retornou ${status}`, detail: data })
    }
    next(err)
  }
})

export default router
