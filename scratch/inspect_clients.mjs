import 'dotenv/config'
import { db } from '../server/services/firebaseAdmin.js'

async function inspectClients() {
  const snapshot = await db.collection('clients').get()
  console.log(`Total de clientes no Firestore: ${snapshot.size}`)
  snapshot.docs.forEach(doc => {
    const data = doc.data()
    console.log({
      id: doc.id,
      name: data.name,
      slug: data.slug,
      anymarket_token: data.anymarket_token ? `${data.anymarket_token.slice(0, 8)}... (${data.anymarket_token.length} chars)` : 'NENHUM / VAZIO',
      anymarket_panel_token: data.anymarket_panel_token ? `${data.anymarket_panel_token.slice(0, 8)}... (${data.anymarket_panel_token.length} chars)` : 'NENHUM / VAZIO',
    })
  })
}

inspectClients().catch(console.error)
