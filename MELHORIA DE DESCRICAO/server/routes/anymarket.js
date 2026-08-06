import { Router } from 'express'
import axios from 'axios'
import { db, FieldValue } from '../services/firebaseAdmin.js'

const router = Router()

const ANYMARKET_WEBHOOK_URL = process.env.ANYMARKET_WEBHOOK_URL || ''

/**
 * POST /api/anymarket/patch
 * Body: { productId, title, description, clientId, generationIds }
 */
router.post('/patch', async (req, res, next) => {
  try {
    const { productId, title, description, clientId, gumgaToken: manualToken } = req.body ?? {}

    if (!productId) return res.status(400).json({ error: 'productId é obrigatório.' })

    // Buscar token do cliente no Firestore
    let gumgaToken = manualToken
    if (clientId && !gumgaToken) {
      const clientDoc = await db.collection('clients').doc(clientId).get()
      if (clientDoc.exists) {
        gumgaToken = clientDoc.data().anymarket_token
      }
    }

    if (!gumgaToken) {
      return res.status(400).json({
        error: 'Token Anymarket não configurado para este cliente.',
      })
    }

    const patchBody = { title, description }

    console.log(
      `[AnyMarket] Produto ${productId} → PATCH | title: ${title?.slice?.(0, 40)} | description: ${description?.slice?.(0, 40)}`
    )

    if (!ANYMARKET_WEBHOOK_URL) {
      return res.status(500).json({
        error: 'ANYMARKET_WEBHOOK_URL não configurada no .env do servidor.',
      })
    }

    const n8nResponse = await axios.post(
      ANYMARKET_WEBHOOK_URL,
      { productId, ...patchBody, gumgaToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 55_000 }
    )

    // Marcar gerações como aplicadas no Firestore
    const { generationIds } = req.body ?? {}
    if (Array.isArray(generationIds) && generationIds.length > 0) {
      const batch = db.batch()
      for (const id of generationIds) {
        const docRef = db.collection('generations').doc(id)
        batch.update(docRef, { appliedAt: FieldValue.serverTimestamp() })
      }
      await batch.commit()
    }

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
