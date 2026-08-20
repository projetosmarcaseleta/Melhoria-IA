import axios from 'axios'

const token = '259079439L259062837E1849733842462C175642184246200O259062837.I'
const categoryId = '3336196'

async function run() {
  console.log('--- Testando AnyMarket Panel API ---')
  console.log('Token:', token)
  console.log('Category ID:', categoryId)

  // 1. Testar /rest/api/marketplaces
  try {
    const resMps = await axios.get('https://app.anymarket.com.br/rest/api/marketplaces', {
      headers: { gumgaToken: token }
    })
    console.log('1. Marketplaces da conta:', resMps.data)
  } catch (err) {
    console.error('1. Erro marketplaces:', err.response?.status, err.response?.data || err.message)
  }

  // 2. Testar /rest/api/categories/:id
  try {
    const resCat = await axios.get(`https://app.anymarket.com.br/rest/api/categories/${categoryId}`, {
      headers: { gumgaToken: token }
    })
    console.log('2. Categoria / Marketplaces vinculados:', JSON.stringify(resCat.data, null, 2))
  } catch (err) {
    console.error('2. Erro categoria:', err.response?.status, err.response?.data || err.message)
  }
}

run()
