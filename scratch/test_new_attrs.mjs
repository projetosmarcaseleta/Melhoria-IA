import 'dotenv/config'
import axios from 'axios'
import { adminAuth } from '../server/services/firebaseAdmin.js'

async function run() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  const clientId = 'QboRlYTNYuEijAe0EE23'

  const user = await adminAuth.getUserByEmail('admin@empresa.com')
  const customToken = await adminAuth.createCustomToken(user.uid)
  const signRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    token: customToken, returnSecureToken: true
  })
  const headers = { Authorization: `Bearer ${signRes.data.idToken}` }

  console.log('\n=== Atributos da Categoria 4014317 via novo endpoint (panel_direct) ===')
  const t0 = Date.now()
  const res = await axios.get(`http://localhost:3001/api/category-attributes/${clientId}/4014317?marketplace=MERCADO_LIVRE`, { headers })
  const elapsed = Date.now() - t0

  console.log(`Tempo: ${elapsed}ms | source: ${res.data.source} | total atributos: ${res.data.attributes?.length}`)
  console.log('Obrigatórios:', res.data.attributes?.filter(a => a.required).map(a => a.name))
  console.log('Recomendados:', res.data.attributes?.filter(a => a.recommended && !a.required).map(a => a.name).slice(0, 5), '...')
}

run().catch(console.error)
