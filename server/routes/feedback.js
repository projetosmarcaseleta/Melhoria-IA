import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'

const router = Router()

/**
 * PATCH /api/feedback/:generationId
 * Body: { status: 'approved' | 'rejected' | 'edited', editedText?, reason? }
 */
router.patch('/:generationId', async (req, res, next) => {
  try {
    const { generationId } = req.params
    const { status, editedText, reason } = req.body ?? {}

    if (!['approved', 'rejected', 'edited'].includes(status)) {
      return res.status(400).json({
        error: 'status deve ser "approved", "rejected" ou "edited".',
      })
    }

    if (status === 'edited' && !editedText) {
      return res.status(400).json({
        error: 'editedText é obrigatório quando status é "edited".',
      })
    }

    const docRef = db.collection('generations').doc(generationId)
    const doc = await docRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: 'Geração não encontrada.' })
    }

    const updates = {
      feedbackStatus: status,
      feedbackBy: req.user.id,
      feedbackAt: FieldValue.serverTimestamp(),
    }

    if (editedText) updates.editedText = editedText
    if (reason) updates.feedbackReason = reason

    await docRef.update(updates)
    const updatedDoc = await docRef.get()

    return res.json({ id: updatedDoc.id, ...updatedDoc.data() })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/feedback/batch
 * Body: { generationIds: string[], status: 'approved' | 'rejected' }
 * Aplica feedback em lote.
 */
router.post('/batch', async (req, res, next) => {
  try {
    const { generationIds, status } = req.body ?? {}

    if (!Array.isArray(generationIds) || generationIds.length === 0) {
      return res.status(400).json({ error: 'generationIds é obrigatório.' })
    }
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'status deve ser "approved" ou "rejected".',
      })
    }

    const batch = db.batch()

    for (const id of generationIds) {
      const docRef = db.collection('generations').doc(id)
      batch.update(docRef, {
        feedbackStatus: status,
        feedbackBy: req.user.id,
        feedbackAt: FieldValue.serverTimestamp(),
      })
    }

    await batch.commit()
    return res.json({ updated: generationIds.length })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/feedback/stats/:clientId
 * Retorna métricas de feedback de um cliente.
 */
router.get('/stats/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    const snapshot = await db.collection('generations')
      .where('clientId', '==', clientId)
      .get()

    let pending = 0
    let approved = 0
    let rejected = 0
    let edited = 0

    snapshot.docs.forEach((doc) => {
      const st = doc.data().feedbackStatus
      if (st === 'pending') pending++
      else if (st === 'approved') approved++
      else if (st === 'rejected') rejected++
      else if (st === 'edited') edited++
    })

    const total = approved + rejected + edited
    const approvalRate = total > 0 ? (approved + edited) / total : 0

    return res.json({
      pending,
      approved,
      rejected,
      edited,
      totalEvaluated: total,
      approvalRate: Math.round(approvalRate * 1000) / 10, // ex: 85.5%
    })
  } catch (err) {
    next(err)
  }
})

export default router
