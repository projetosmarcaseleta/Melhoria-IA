import 'dotenv/config'
import axios from 'axios'
import { adminAuth } from '../server/services/firebaseAdmin.js'

async function testProductFlow() {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  const clientId = 'QboRlYTNYuEijAe0EE23' // MAGAZINE LUIZA - MERCADO LIVRE

  // 1. Auth
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

  console.log('=== 1. Testando Busca no Webhook para ID: 346214692 ===')
  const webhookUrl = process.env.N8N_CONSULTA_WEBHOOK_URL
  let products = []
  try {
    const webRes = await axios.post(webhookUrl, { ids: ['346214692'] }, { timeout: 60000 })
    products = (webRes.data.products || webRes.data)
    console.log('Produtos retornados do webhook:', products.length)
    if (products.length > 0) {
      console.log('Produto:', {
        id: products[0].ID,
        title: products[0].TITULO,
        category: products[0].CATEGORIA,
        categoryId: products[0].ID_CATEGORIA
      })
    }
  } catch (err) {
    console.warn('Webhook erro (usando fallback mock se necessário):', err.message)
    products = [{
      ID: '346214692',
      TITULO: 'Mousepad Gamer Husky Black Frost Speed Extra Grande',
      DESCRICAO: 'Mousepad Gamer Husky Black Frost...',
      CARACTERISTICAS: 'Speed, Extra Grande, Base Emborrachada'
    }]
  }

  const prod = products[0]

  console.log('\n=== 2. Testando /api/categories/suggest ===')
  let suggestion = null
  try {
    const sugRes = await axios.post('http://localhost:3001/api/categories/suggest', {
      clientId,
      products: [{
        id: String(prod.ID),
        title: prod.TITULO,
        description: prod.DESCRICAO,
        characteristics: prod.CARACTERISTICAS
      }]
    }, { headers })
    suggestion = sugRes.data.results?.[0]
    console.log('Sugestão de Categoria:', JSON.stringify(suggestion, null, 2))
  } catch (err) {
    console.error('Erro /api/categories/suggest:', err.response?.status, err.response?.data || err.message)
  }

  console.log('\n=== 3. Testando /api/channel-bindings/status para a categoria atual e sugerida ===')
  const catIdToTest = suggestion?.proposal?.leafCategoryId || '3589618'
  try {
    const bindStatusRes = await axios.get(`http://localhost:3001/api/channel-bindings/category/${clientId}/${catIdToTest}`, { headers })
    console.log('Status de Vínculos por Canal:', JSON.stringify(bindStatusRes.data, null, 2))
  } catch (err) {
    console.error('Erro /api/channel-bindings/category:', err.response?.status, err.response?.data || err.message)
  }

  console.log('\n=== 4. Testando /api/category-attributes para a categoria ===')
  try {
    const attrRes = await axios.get(`http://localhost:3001/api/category-attributes/${clientId}/${catIdToTest}?marketplace=MERCADO_LIVRE&withValues=true`, { headers })
    console.log('Atributos em Mercado Livre:', JSON.stringify(attrRes.data, null, 2))
  } catch (err) {
    console.error('Erro /api/category-attributes:', err.response?.status, err.response?.data || err.message)
  }
}

testProductFlow().catch(console.error)
