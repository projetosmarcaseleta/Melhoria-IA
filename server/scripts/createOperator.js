import 'dotenv/config'
import { adminAuth, db } from '../services/firebaseAdmin.js'

async function createOperator(email, password, name, role = 'admin') {
  try {
    let userRecord
    try {
      userRecord = await adminAuth.getUserByEmail(email)
      console.log(`[Firebase] Usuário ${email} já existe no Auth (UID: ${userRecord.uid}).`)
    } catch {
      userRecord = await adminAuth.createUser({
        email,
        password,
        displayName: name,
      })
      console.log(`[Firebase] Usuário ${email} criado no Auth com sucesso! (UID: ${userRecord.uid})`)
    }

    // Criar/atualizar perfil na coleção 'operators'
    await db.collection('operators').doc(userRecord.uid).set(
      {
        name,
        email,
        role,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    )

    console.log(`[Firebase] Perfil do operador "${name}" (${role}) gravado no Firestore!`)
    console.log('\n✅ Login liberado:')
    console.log(`- Email: ${email}`)
    console.log(`- Senha: ${password}`)
  } catch (err) {
    console.error('[Firebase] Erro ao criar operador:', err.message)
  }
}

// Pegar argumentos da linha de comando ou usar padrões
const email = process.argv[2] || 'admin@empresa.com'
const password = process.argv[3] || 'admin123'
const name = process.argv[4] || 'Administrador'

createOperator(email, password, name)
