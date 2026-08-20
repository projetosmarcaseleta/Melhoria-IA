import 'dotenv/config'
import axios from 'axios'
import { adminAuth } from '../server/services/firebaseAdmin.js'

async function run() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  let user = await adminAuth.getUserByEmail('admin@empresa.com').catch(() => null)
  const customToken = await adminAuth.createCustomToken(user.uid)
  const signRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    token: customToken,
    returnSecureToken: true
  })
  const idToken = signRes.data.idToken
  const headers = { Authorization: `Bearer ${idToken}` }

  // 1. Webhook
  const webhookUrl = process.env.N8N_CONSULTA_WEBHOOK_URL
  const webRes = await axios.post(webhookUrl, { ids: ['7132023337'] }, { timeout: 60000 })
  const products = webRes.data.products || webRes.data
  const product = products[0]

  console.log('--- Testando /api/categories/suggest ---')
  const catSuggest = await axios.post('http://localhost:3001/api/categories/suggest', {
    clientId: 'db1-group',
    products: [{
      id: product.ID,
      title: product.TITULO,
      description: product.DESCRICAO,
      characteristics: product.CARACTERISTICAS
    }]
  }, { headers })
  console.log('Cat Suggest:', JSON.stringify(catSuggest.data, null, 2))
}

run().catch(console.error)
