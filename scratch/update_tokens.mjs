import 'dotenv/config'
import { db } from '../server/services/firebaseAdmin.js'

async function updateClientTokens() {
  const clientId = 'QboRlYTNYuEijAe0EE23' // MAGAZINE LUIZA - MERCADO LIVRE
  const anymarket_token = 'N0M0QUFENjI4OUQ0QkZEQzQ2Q0E0REUyRjhEN0U0QzI=.sWPzIe9/Q1GcJhtdDJJMT1OdpCpewqwe6gSd/c/gMlOjPyw3x1SRvJi3M8z5Zw7UW2ldcCfsY/AbgaB8+Pa5rQ=='
  const anymarket_panel_token = '259083396L259075992E1879420502579C178610850257900O1.I'

  await db.collection('clients').doc(clientId).update({
    anymarket_token,
    anymarket_panel_token,
    updatedAt: new Date()
  })

  console.log('✅ Tokens atualizados no Firestore para o cliente:', clientId)
}

updateClientTokens().catch(console.error)
