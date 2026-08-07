import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn(
    '[Firebase] VITE_FIREBASE_API_KEY ou VITE_FIREBASE_PROJECT_ID não definidos no .env'
  )
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Força persistência via localStorage em vez do IndexedDB padrão do SDK.
// O IndexedDB pode falhar com "Database is closing/hidden" bem no instante
// em que a aba volta do redirect do login (signInWithRedirect), travando o
// login indefinidamente em alguns navegadores/timings.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('[Firebase] Falha ao definir persistência:', err)
})
