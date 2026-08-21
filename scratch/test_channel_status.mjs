import 'dotenv/config'
import axios from 'axios'
import { adminAuth } from '../server/services/firebaseAdmin.js'

async function runTest() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  const clientId = 'QboRlYTNYuEijAe0EE23'

  let user = await adminAuth.getUserByEmail('admin@empresa.com').catch(() => null)
  const customToken = await adminAuth.createCustomToken(user.uid)
  const signRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    token: customToken,
    returnSecureToken: true
  })
  const idToken = signRes.data.idToken
  const headers = { Authorization: `Bearer ${idToken}` }

  console.log('\n--- 1. Status de Vínculos de Canais para Categoria Atual (3589618) ---')
  const statusAtual = await axios.get(`http://localhost:3001/api/channel-bindings/status/${clientId}/3589618`, { headers })
  console.log(JSON.stringify(statusAtual.data, null, 2))

  console.log('\n--- 2. Status de Vínculos de Canais para Categoria Sugerida (4014317) ---')
  const statusSugerida = await axios.get(`http://localhost:3001/api/channel-bindings/status/${clientId}/4014317`, { headers })
  console.log(JSON.stringify(statusSugerida.data, null, 2))
}

runTest().catch(console.error)
