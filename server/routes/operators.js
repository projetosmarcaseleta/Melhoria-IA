import { Router } from 'express'
import { adminAuth, db, FieldValue } from '../services/firebaseAdmin.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

/**
 * GET /api/operators
 * Lista todos os operadores cadastrados no sistema. Requer role admin.
 */
router.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const snapshot = await db.collection('operators').get()

    const operators = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    operators.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

    return res.json(operators)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/operators
 * Cadastra um novo operador no Firebase Auth e grava perfil no Firestore. Requer role admin.
 * Body: { name: string, email: string, password: string, role: 'admin' | 'editor' }
 */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body ?? {}

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email e password são obrigatórios.' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' })
    }

    const assignedRole = role === 'admin' ? 'admin' : 'editor'

    // 1. Criar usuário no Firebase Authentication
    let userRecord
    try {
      userRecord = await adminAuth.createUser({
        email: email.trim(),
        password,
        displayName: name.trim(),
      })
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado no sistema.' })
      }
      throw err
    }

    // 2. Gravar perfil do operador no Firestore
    const operatorData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: assignedRole,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    await db.collection('operators').doc(userRecord.uid).set(operatorData)

    return res.status(201).json({
      id: userRecord.uid,
      ...operatorData,
      message: `Operador "${name}" cadastrado com sucesso!`,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/operators/:uid
 * Atualiza role ou nome do operador. Requer role admin.
 */
router.patch('/:uid', requireAdmin, async (req, res, next) => {
  try {
    const { uid } = req.params
    const { name, role } = req.body ?? {}

    const updates = {}
    if (name) updates.name = name.trim()
    if (role && ['admin', 'editor'].includes(role)) updates.role = role

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' })
    }

    updates.updatedAt = FieldValue.serverTimestamp()

    const docRef = db.collection('operators').doc(uid)
    const doc = await docRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: 'Operador não encontrado.' })
    }

    await docRef.update(updates)

    // Atualizar displayName no Firebase Auth se o nome mudou
    if (name) {
      try {
        await adminAuth.updateUser(uid, { displayName: name.trim() })
      } catch (err) {
        console.warn('[OperatorsRoute] Erro ao atualizar displayName Auth:', err.message)
      }
    }

    const updatedDoc = await docRef.get()
    return res.json({ id: updatedDoc.id, ...updatedDoc.data() })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/operators/:uid
 * Remove o operador do Firebase Auth e exclui do Firestore. Requer role admin.
 */
router.delete('/:uid', requireAdmin, async (req, res, next) => {
  try {
    const { uid } = req.params

    // Não permitir deletar a si próprio
    if (req.user.id === uid) {
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta de operador.' })
    }

    // 1. Remover do Firebase Auth
    try {
      await adminAuth.deleteUser(uid)
    } catch (err) {
      console.warn('[OperatorsRoute] Aviso ao excluir do Firebase Auth:', err.message)
    }

    // 2. Remover do Firestore
    await db.collection('operators').doc(uid).delete()

    return res.json({ ok: true, message: 'Operador removido com sucesso.' })
  } catch (err) {
    next(err)
  }
})

export default router
