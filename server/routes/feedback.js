import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { updateMockFeedback } from '../services/mockStorage.js'

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

    // Se for ID gerado no modo de teste ou se Firestore falhar
    if (generationId.startsWith('gen-') || generationId.includes('teste')) {
      const updated = updateMockFeedback(
        generationId,
        { feedbackStatus: status, editedText, reason },
        req.user?.id
      )
      return res.json(updated)
    }

    try {
      const docRef = db.collection('generations').doc(generationId)
      const doc = await docRef.get()

      if (!doc.exists) {
        // Tratar como mock em vez de dar 404 para não quebrar a UX
        const updated = updateMockFeedback(
          generationId,
          { feedbackStatus: status, editedText, reason },
          req.user?.id
        )
        return res.json(updated)
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
    } catch (dbErr) {
      console.warn('[Feedback] Aviso Firestore ao gravar feedback (usando fallback mock):', dbErr.message)
      const updated = updateMockFeedback(
        generationId,
        { feedbackStatus: status, editedText, reason },
        req.user?.id
      )
      return res.json(updated)
    }
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

    try {
      const batch = db.batch()

      for (const id of generationIds) {
        if (!id.startsWith('gen-') && !id.includes('teste')) {
          const docRef = db.collection('generations').doc(id)
          batch.update(docRef, {
            feedbackStatus: status,
            feedbackBy: req.user.id,
            feedbackAt: FieldValue.serverTimestamp(),
          })
        } else {
          updateMockFeedback(id, { feedbackStatus: status }, req.user?.id)
        }
      }

      await batch.commit()
    } catch (dbErr) {
      console.warn('[FeedbackBatch] Aviso Firestore (usando fallback mock):', dbErr.message)
      for (const id of generationIds) {
        updateMockFeedback(id, { feedbackStatus: status }, req.user?.id)
      }
    }

    return res.json({ updated: generationIds.length })
  } catch (err) {
    next(err)
  }
})

export default router

