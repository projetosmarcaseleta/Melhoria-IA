/**
 * Expurgo da coleção `generations`.
 *
 * Política decidida: **aprovadas e editadas ficam para sempre**; pendentes e rejeitadas
 * com mais de N dias são removidas.
 *
 * O motivo da assimetria: aprovadas/editadas são o combustível do few-shot dinâmico
 * (promptResolver injeta as 5 mais recentes) e a base dos insights de qualidade. Pendente
 * antiga é geração que ninguém avaliou e que já saiu da fila; rejeitada antiga já cumpriu
 * o papel de sinal negativo.
 *
 * Apagar também consome cota do plano Spark (20k exclusões/dia), então:
 *   - dry-run é o padrão. Só apaga com `--apply`.
 *   - existe teto por execução (`--max`), para não gastar a cota do dia inteira num
 *     expurgo histórico. Rodar várias vezes é seguro e idempotente.
 *
 * Uso:
 *   node server/scripts/purgeGenerations.js                    # simula, 90 dias
 *   node server/scripts/purgeGenerations.js --dias=60          # simula com outro corte
 *   node server/scripts/purgeGenerations.js --apply            # executa
 *   node server/scripts/purgeGenerations.js --apply --max=500  # executa com teto menor
 */

import '../env.js'
import { db } from '../services/firebaseAdmin.js'
import { bulkDelete } from '../utils/firestoreBulk.js'

const STATUS_PRESERVADOS = new Set(['approved', 'edited'])
const STATUS_EXPURGAVEIS = new Set(['pending', 'rejected'])

function lerArgumento(nome, padrao) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`))
  if (!arg) return padrao
  const valor = Number(arg.split('=')[1])
  return Number.isFinite(valor) ? valor : padrao
}

async function main() {
  const aplicar = process.argv.includes('--apply')
  const dias = lerArgumento('dias', 90)
  const teto = lerArgumento('max', 2000)
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  console.log(`\n${aplicar ? '⚠  MODO EXECUÇÃO' : '🔍 SIMULAÇÃO (use --apply para executar)'}`)
  console.log(`Política: manter approved/edited · expurgar pending/rejected anteriores a ${corte.toISOString().slice(0, 10)} (${dias} dias)`)
  console.log(`Teto desta execução: ${teto} documentos\n`)

  // Filtro por createdAt usa índice de campo único (existe por padrão). O status é
  // filtrado em memória de propósito: consulta composta exigiria índice manual, e o
  // ganho não compensa o acoplamento a configuração fora do código.
  const snapshot = await db.collection('generations').where('createdAt', '<', corte).limit(teto).get()

  console.log(`Documentos anteriores ao corte lidos: ${snapshot.size}`)

  const contagem = { approved: 0, edited: 0, pending: 0, rejected: 0, semStatus: 0 }
  const paraExpurgar = []

  for (const doc of snapshot.docs) {
    const status = doc.data().feedbackStatus ?? 'semStatus'
    contagem[status] = (contagem[status] ?? 0) + 1

    if (STATUS_EXPURGAVEIS.has(status) || status === 'semStatus') paraExpurgar.push(doc.ref)
  }

  console.log('\nDistribuição por status (dentro do recorte):')
  for (const [status, total] of Object.entries(contagem)) {
    if (!total) continue
    const destino = STATUS_PRESERVADOS.has(status) ? 'PRESERVAR' : 'expurgar'
    console.log(`  ${status.padEnd(11)} ${String(total).padStart(5)}  → ${destino}`)
  }

  console.log(`\nA expurgar nesta execução: ${paraExpurgar.length}`)
  console.log(`A preservar (approved/edited): ${contagem.approved + contagem.edited}`)

  if (!paraExpurgar.length) {
    console.log('\nNada a fazer.\n')
    return
  }

  if (!aplicar) {
    console.log('\nSimulação encerrada — nada foi apagado. Rode com --apply para executar.\n')
    return
  }

  const resultado = await bulkDelete(db, paraExpurgar)
  console.log(`\n✅ ${resultado.deleted} documento(s) removido(s).`)

  if (snapshot.size === teto) {
    console.log(`\n⚠  O teto de ${teto} foi atingido: provavelmente há mais documentos antigos.`)
    console.log('   Rode de novo (idempotente) para continuar o expurgo.\n')
  } else {
    console.log('')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Falha no expurgo:', err.message)
    process.exit(1)
  })
