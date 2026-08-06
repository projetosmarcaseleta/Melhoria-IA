import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Inicializar Firebase Admin SDK usando service account ou credenciais do ambiente
if (!getApps().length) {
  let credential

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      credential = cert(serviceAccount)
    } catch (err) {
      console.error('[Firebase] Erro ao carregar FIREBASE_SERVICE_ACCOUNT_JSON:', err.message)
    }
  }

  initializeApp({
    ...(credential ? { credential } : {}),
    projectId: process.env.FIREBASE_PROJECT_ID,
  })
}

export const adminAuth = getAuth()
export const db = getFirestore()
export { FieldValue }
