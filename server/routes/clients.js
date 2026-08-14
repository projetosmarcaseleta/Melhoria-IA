import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { requireAdmin } from '../middleware/auth.js'
import { isTestClient, getMockClients, getMockClient, TEST_CLIENT } from '../services/mockStorage.js'

const router = Router()

/**
 * GET /api/clients
 * Lista todos os clientes ativos (incluindo o cliente de teste).
 */
router.get('/', async (_req, res, next) => {
  try {
    let clients = []
    try {
      const snapshot = await db.collection('clients')
        .where('isActive', '==', true)
        .get()

      clients = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
    } catch (dbErr) {
      console.warn('[ClientsRoute] Aviso ao consultar Firestore (usando fallback mock):', dbErr.message)
      return res.json(getMockClients())
    }

    // Garantir que a conta Teste - Marca Seleta sempre está presente na lista
    if (!clients.some((c) => isTestClient(c.id) || isTestClient(c.slug))) {
      clients.unshift({ ...TEST_CLIENT })
    }

    // Ordenar por nome no servidor JS
    clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

    return res.json(clients)
  } catch (err) {
    // Em caso de erro grave, nunca deixar a lista vazia
    return res.json(getMockClients())
  }
})

/**
 * GET /api/clients/:id
 * Busca um cliente por ID.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    if (isTestClient(id)) {
      return res.json(getMockClient(id))
    }

    try {
      const doc = await db.collection('clients').doc(id).get()
      if (!doc.exists) {
        return res.status(404).json({ error: 'Cliente não encontrado.' })
      }
      return res.json({ id: doc.id, ...doc.data() })
    } catch (dbErr) {
      console.warn('[ClientsRoute] Erro Firestore ao buscar cliente:', dbErr.message)
      return res.json(getMockClient(id))
    }
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/clients
 * Cria um novo cliente. Requer role admin.
 */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, anymarket_token, settings } = req.body ?? {}

    if (!name || !slug) {
      return res.status(400).json({ error: 'name e slug são obrigatórios.' })
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')

    // Verificar se slug já existe
    const existing = await db.collection('clients')
      .where('slug', '==', cleanSlug)
      .limit(1)
      .get()

    if (!existing.empty) {
      return res.status(409).json({ error: 'Slug já existe.' })
    }

    const defaultSettings = {
      ai_provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 1.0,
      max_description_length: 2000,
      max_title_length: 60,
      ...settings,
    }

    const clientData = {
      name,
      slug: cleanSlug,
      anymarket_token: anymarket_token || null,
      settings: defaultSettings,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const docRef = await db.collection('clients').add(clientData)

    return res.status(201).json({ id: docRef.id, ...clientData })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/clients/:id
 * Atualiza um cliente existente. Requer role admin.
 */
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const updates = {}
    const allowed = ['name', 'slug', 'anymarket_token', 'settings', 'isActive']

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key]
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' })
    }

    updates.updatedAt = FieldValue.serverTimestamp()

    const docRef = db.collection('clients').doc(req.params.id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: 'Cliente não encontrado.' })
    }

    await docRef.update(updates)
    const updatedDoc = await docRef.get()

    return res.json({ id: updatedDoc.id, ...updatedDoc.data() })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/clients/:id
 * Desativa um cliente (soft delete). Requer role admin.
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const docRef = db.collection('clients').doc(req.params.id)
    await docRef.update({
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
