import 'dotenv/config'
import axios from 'axios'
import { adminAuth } from '../server/services/firebaseAdmin.js'

async function runTestAttributes() {
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

  console.log('\n--- Atributos da Categoria 4014317 (Mouse Pad Gamer) no Mercado Livre ---')
  const attrRes = await axios.get(`http://localhost:3001/api/category-attributes/${clientId}/4014317?marketplace=MERCADO_LIVRE&withValues=true&refresh=true`, { headers })
  console.log(JSON.stringify(attrRes.data, null, 2))
}

runTestAttributes().catch(console.error)
