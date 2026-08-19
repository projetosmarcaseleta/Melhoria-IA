/**
 * Escrita/exclusão em massa no Firestore via BulkWriter.
 *
 * Por que não `db.batch()`: um commit é limitado por DUAS coisas — 500 operações e
 * ~10 MiB de requisição. Lotear só pela contagem (400 por vez) ainda estoura o
 * limite de tamanho e a API responde
 *   `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.`
 * Foi exatamente o que impedia excluir um documento RAG com muitos chunks.
 *
 * O BulkWriter cuida do agrupamento, do tamanho e da vazão internamente, e ainda
 * paraleliza — é a ferramenta que o próprio SDK oferece para volume.
 *
 * Regra desta camada: erro NUNCA é silencioso. Quem chama recebe exceção com a
 * contagem de falhas, porque o chamador (exclusão de documento) precisa poder dizer
 * ao operador que não deu — em vez de responder sucesso e o dado reaparecer no F5.
 */

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Array<import('firebase-admin/firestore').DocumentReference>} refs
 * @returns {Promise<{deleted: number}>}
 */
export async function bulkDelete(db, refs) {
  if (!refs?.length) return { deleted: 0 }

  const writer = db.bulkWriter()
  const errors = []

  // Até 3 tentativas por documento; depois desiste e reporta.
  writer.onWriteError((error) => {
    if (error.failedAttempts < 3) return true
    errors.push(`${error.documentRef.path}: ${error.message}`)
    return false
  })

  for (const ref of refs) {
    writer.delete(ref).catch(() => {
      /* já contabilizado em onWriteError */
    })
  }

  await writer.close()

  if (errors.length) {
    throw new Error(`${errors.length} de ${refs.length} exclusões falharam. Primeira: ${errors[0]}`)
  }

  return { deleted: refs.length }
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Array<{ref: object, data: object}>} entries
 * @param {{merge?: boolean}} [options]
 */
export async function bulkSet(db, entries, { merge = true } = {}) {
  if (!entries?.length) return { written: 0 }

  const writer = db.bulkWriter()
  const errors = []

  writer.onWriteError((error) => {
    if (error.failedAttempts < 3) return true
    errors.push(`${error.documentRef.path}: ${error.message}`)
    return false
  })

  for (const entry of entries) {
    writer.set(entry.ref, entry.data, { merge }).catch(() => {})
  }

  await writer.close()

  if (errors.length) {
    throw new Error(`${errors.length} de ${entries.length} gravações falharam. Primeira: ${errors[0]}`)
  }

  return { written: entries.length }
}
