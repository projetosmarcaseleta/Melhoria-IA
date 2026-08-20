import 'dotenv/config'
import axios from 'axios'
import { adminAuth, db } from '../server/services/firebaseAdmin.js'

async function run() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  let user = await adminAuth.getUserByEmail('admin@empresa.com').catch(() => null)
  if (!user) {
    user = await adminAuth.createUser({ email: 'admin@empresa.com', password: 'adminpassword123', displayName: 'Admin' })
  }
  const customToken = await adminAuth.createCustomToken(user.uid)
  const signRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    token: customToken,
    returnSecureToken: true
  })
  const idToken = signRes.data.idToken
  const headers = { Authorization: `Bearer ${idToken}` }

  // 2. Buscar dados de 7132023337 no webhook
  const webhookUrl = process.env.N8N_CONSULTA_WEBHOOK_URL
  const webRes = await axios.post(webhookUrl, { ids: ['7132023337'] }, { timeout: 60000 })
  const products = (webRes.data.products || webRes.data)
  console.log('Quantidade de produtos no webhook:', products.length)
  console.log('Primeiro produto:', products[0])

  console.log('\n--- 1. Testando /api/generate ---')
  const genRes = await axios.post('http://localhost:3001/api/generate', {
    clientId: 'db1-group',
    products: products.map(p => ({
      id: p.ID,
      title: p.TITULO,
      description: p.DESCRICAO,
      characteristics: p.CARACTERISTICAS
    })),
    fields: ['title', 'description']
  }, { headers })
  console.log('Gen Result:', JSON.stringify(genRes.data, null, 2))

  console.log('\n--- 2. Testando /api/categories/suggest ---')
  try {
    const catSuggest = await axios.post('http://localhost:3001/api/categories/suggest', {
      clientId: 'db1-group',
      products: [{
        id: '7132023337',
        title: products[0].TITULO,
        description: products[0].DESCRICAO,
        characteristics: products[0].CARACTERISTICAS
      }]
    }, { headers })
    console.log('Cat Suggest Result:', JSON.stringify(catSuggest.data, null, 2))
  } catch (err) {
    console.error('Cat Suggest Erro:', err.response?.status, err.response?.data || err.message)
  }
}

run().catch(console.error)
