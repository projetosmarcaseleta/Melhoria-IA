import 'dotenv/config'
import axios from 'axios'

const id = '7132023337'

async function run() {
  console.log('=== Testando Produto ID:', id, '===')
  
  // 1. Buscar produto via Webhook n8n
  const webhookUrl = process.env.N8N_CONSULTA_WEBHOOK_URL
  console.log('Webhook URL:', webhookUrl ? 'Configurada' : 'NÃO configurada')

  let productData = null
  try {
    const res = await axios.post(webhookUrl, { ids: [id] }, { timeout: 60000 })
    console.log('1. Retorno do Webhook:', JSON.stringify(res.data, null, 2))
    
    const raw = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.products)
      ? res.data.products
      : Array.isArray(res.data?.data)
      ? res.data.data
      : null
    
    if (raw && raw.length > 0) {
      productData = raw[0]
      console.log('Dados do Produto:', productData)
    } else {
      console.log('Nenhum produto retornado no array.')
    }
  } catch (err) {
    console.error('Erro ao consultar webhook:', err.response?.data || err.message)
  }

  // 2. Se temos os dados do produto, testar geração de título e descrição
  if (productData) {
    console.log('\n--- 2. Testando Geração de IA ---')
    try {
      const titleRes = await axios.post('http://localhost:3001/api/generate', {
        clientId: 'db1-group',
        productData: {
          title: productData.TITULO ?? productData.title,
          description: productData.DESCRICAO ?? productData['DESCRIÇÃO'] ?? productData.description,
          characteristics: productData.CARACTERISTICAS ?? productData.characteristics,
        },
        type: 'titulo'
      })
      console.log('Título gerado:', titleRes.data)
    } catch (err) {
      console.error('Erro ao gerar título:', err.response?.status, err.response?.data || err.message)
    }

    try {
      const descRes = await axios.post('http://localhost:3001/api/generate', {
        clientId: 'db1-group',
        productData: {
          title: productData.TITULO ?? productData.title,
          description: productData.DESCRICAO ?? productData['DESCRIÇÃO'] ?? productData.description,
          characteristics: productData.CARACTERISTICAS ?? productData.characteristics,
        },
        type: 'descricao'
      })
      console.log('Descrição gerada:', descRes.data)
    } catch (err) {
      console.error('Erro ao gerar descrição:', err.response?.status, err.response?.data || err.message)
    }

    // 3. Testar Categoria / Sugestão de Categoria
    console.log('\n--- 3. Testando Sugestão de Categoria ---')
    try {
      const catRes = await axios.post('http://localhost:3001/api/categories/suggest', {
        clientId: 'db1-group',
        products: [{
          id: id,
          title: productData.TITULO ?? productData.title,
          description: productData.DESCRICAO ?? productData['DESCRIÇÃO'] ?? productData.description,
          characteristics: productData.CARACTERISTICAS ?? productData.characteristics,
        }]
      })
      console.log('Sugestão de categoria:', JSON.stringify(catRes.data, null, 2))
    } catch (err) {
      console.error('Erro ao sugerir categoria:', err.response?.status, err.response?.data || err.message)
    }
  }
}

run()
