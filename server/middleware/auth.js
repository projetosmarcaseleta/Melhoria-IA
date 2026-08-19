import { adminAuth, db } from '../services/firebaseAdmin.js'
import { TEST_OPERATOR } from '../services/mockStorage.js'
import { firestoreMeter } from '../services/firestoreMeter.js'

/**
 * Cache do perfil do operador (uid → dados), com TTL.
 *
 * Invalidado explicitamente quando o cargo muda (ver routes/operators.js), para uma
 * promoção a admin não esperar o TTL.
 */
class OperatorCache {
  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs
    this.cache = new Map()
    this.hits = 0
    this.misses = 0
  }

  get(uid) {
    const entry = this.cache.get(uid)
    if (!entry || Date.now() > entry.expiresAt) {
      if (entry) this.cache.delete(uid)
      this.misses++
      return null
    }
    this.hits++
    return entry.data
  }

  set(uid, data) {
    this.cache.set(uid, { data, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(uid) {
    return this.cache.delete(uid)
  }

  clear() {
    const n = this.cache.size
    this.cache.clear()
    return n
  }

  stats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      // Cada hit é uma leitura do Firestore que NÃO aconteceu.
      leiturasEvitadas: this.hits,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0,
    }
  }
}

export const operatorCache = new OperatorCache()

/**
 * Middleware de autenticação.
 * Valida o Firebase ID Token enviado no header Authorization (Bearer <token>).
 * Injeta req.user com os dados do operador.
 * Se for token de teste ou se o Firebase estiver com cota esgotada, usa fallback gracioso.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação ausente.' })
    }

    const idToken = authHeader.slice(7)

    // Suporte direto para modo de teste independente do Firebase
    if (
      idToken === 'mock-test-token' ||
      idToken.startsWith('mock-') ||
      idToken.startsWith('test-')
    ) {
      req.user = { ...TEST_OPERATOR }
      req.idToken = idToken
      return next()
    }

    let decodedToken = null
    try {
      // Valida o Firebase ID Token
      decodedToken = await adminAuth.verifyIdToken(idToken)
    } catch (authErr) {
      console.warn('[Auth] Token inválido ou expirado:', authErr.message)
      return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' })
    }

    // Perfil do operador — com cache em memória.
    //
    // Antes, TODA requisição autenticada lia `operators/{uid}` no Firestore. Publicar 50
    // produtos são 50 requisições, logo 50 leituras para descobrir o mesmo cargo do mesmo
    // operador. Era o único multiplicador de leitura sem limite do projeto, e no plano
    // Spark (50k leituras/dia) isso importa. Cargo de operador muda raramente; TTL de
    // 10 minutos é uma janela aceitável para uma promoção a admin passar a valer.
    let operatorData = operatorCache.get(decodedToken.uid)

    if (!operatorData) {
      if (firestoreMeter.circuitoAberto()) {
        // Firestore fora por cota: seguir com o perfil mínimo em vez de tentar de novo a
        // cada clique. `role` cai para 'editor' — o menos privilegiado.
        console.warn('[Auth] Disjuntor aberto — seguindo sem ler o perfil do operador.')
      } else {
        try {
          const operatorDoc = await db.collection('operators').doc(decodedToken.uid).get()
          firestoreMeter.record('auth:operators', 'reads', 1)

          if (operatorDoc.exists) {
            operatorData = operatorDoc.data()
            operatorCache.set(decodedToken.uid, operatorData)
          }
        } catch (dbErr) {
          const { tipo } = firestoreMeter.classify(dbErr)
          console.warn(`[Auth] Aviso ao buscar operador no Firestore (${tipo}):`, dbErr.message)
        }
      }
    }

    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email,
      name: operatorData?.name ?? decodedToken.name ?? decodedToken.email ?? 'Operador',
      role: operatorData?.role ?? 'editor',
    }

    req.idToken = idToken
    next()
  } catch (err) {
    console.error('[Auth] Erro inesperado na autenticação:', err.message)
    return res.status(401).json({ error: 'Falha na autenticação.' })
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
