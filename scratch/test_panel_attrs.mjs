import axios from 'axios'

const panelToken = '259083396L259075992E1879420502579C178610850257900O1.I'
const categoryId = '4014317' // Mouse Pad Gamer (categoria sugerida do produto 346214692)
const marketplace = 'MERCADO_LIVRE'

async function test() {
  const url = `https://app.anymarket.com.br/rest/api/marketplace_category_attributes/categories/${categoryId}/marketplaces/${marketplace}/attributes/`
  
  console.log(`\nTestando: GET ${url}\n`)
  
  try {
    const res = await axios.get(url, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'gumgaToken': panelToken,
      },
      timeout: 15000
    })
    
    console.log(`HTTP Status: ${res.status}`)
    console.log(`Total atributos: ${Array.isArray(res.data) ? res.data.length : JSON.stringify(res.data).length}`)
    console.log('\nResposta completa:')
    console.log(JSON.stringify(res.data, null, 2))
  } catch (err) {
    console.error('Erro:', err.response?.status, JSON.stringify(err.response?.data ?? err.message, null, 2))
  }
}

test()
