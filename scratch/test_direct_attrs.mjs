import 'dotenv/config'
import axios from 'axios'

async function testDirectAttributes() {
  const token = 'N0M0QUFENjI4OUQ0QkZEQzQ2Q0E0REUyRjhEN0U0QzI=.sWPzIe9/Q1GcJhtdDJJMT1OdpCpewqwe6gSd/c/gMlOjPyw3x1SRvJi3M8z5Zw7UW2ldcCfsY/AbgaB8+Pa5rQ=='
  const url = 'https://api.anymarket.com.br/v2/categories/characteristics/groups?limit=10'

  try {
    const res = await axios.get(url, {
      headers: {
        gumgaToken: token,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    })
    console.log('AnyMarket Characteristics Groups HTTP Status:', res.status)
    console.log('Total de itens retornados:', res.data?.content?.length ?? res.data?.length)
    if (res.data?.content?.[0] || res.data?.[0]) {
      console.log('Exemplo de grupo:', JSON.stringify(res.data?.content?.[0] || res.data?.[0], null, 2))
    }
  } catch (err) {
    console.error('Erro direto AnyMarket:', err.response?.status, err.response?.data || err.message)
  }
}

testDirectAttributes().catch(console.error)
