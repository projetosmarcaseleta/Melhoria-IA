import { adminAuth, db } from '../services/firebaseAdmin.js'

/**
 * Middleware de autenticação.
 * Valida o Firebase ID Token enviado no header Authorization (Bearer <token>).
 * Injeta req.user com os dados do operador.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação ausente.' })
    }

    const idToken = authHeader.slice(7)

    // Valida o Firebase ID Token
    const decodedToken = await adminAuth.verifyIdToken(idToken)

    // Buscar perfil do operador no Firestore (coleção 'operators')
    const operatorDoc = await db.collection('operators').doc(decodedToken.uid).get()
    const operatorData = operatorDoc.data()

    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email,
      name: operatorData?.name ?? decodedToken.name ?? decodedToken.email,
      role: operatorData?.role ?? 'editor',
    }

    req.idToken = idToken
    next()
  } catch (err) {
    console.error('[Auth] Erro ao validar token Firebase:', err.message)
    return res.status(401).json({ error: 'Falha na autenticação (token inválido ou expirado).' })
  }
}

/**
 * Middleware que exige role de admin.
 * Deve ser usado APÓS requireAuth.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' })
  }
  next()
}
