import 'dotenv/config'
import axios from 'axios'

async function check() {
  const r = await axios.post(process.env.N8N_CONSULTA_WEBHOOK_URL, { ids: ['7132023337'] })
  const list = r.data.products || r.data
  console.log('Total items for 7132023337:', list.length)
  list.forEach((item, i) => console.log(i, 'ID:', item.ID, 'ID_SKU:', item.ID_SKU, 'SKU:', item.SKU, 'TITULO:', item.TITULO.substring(0, 40)))
}

check().catch(console.error)
