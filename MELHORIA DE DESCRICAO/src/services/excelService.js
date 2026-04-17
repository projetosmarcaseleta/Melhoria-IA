import * as XLSX from 'xlsx'

/**
 * Lê um arquivo Excel e retorna a lista de IDs encontrados.
 * Aceita qualquer coluna chamada "ID", "id", "Id", "CODIGO", etc.
 */
export function parseIdsFromExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        if (!rows.length) {
          return reject(new Error('Planilha vazia ou sem linhas de dados.'))
        }

        // Detecta coluna de ID (case-insensitive)
        const firstRow = rows[0]
        const idKey = Object.keys(firstRow).find((k) =>
          k.trim().toLowerCase() === 'id'
        )

        if (!idKey) {
          return reject(
            new Error(
              `Coluna "ID" não encontrada. Colunas encontradas: ${Object.keys(firstRow).join(', ')}`
            )
          )
        }

        const ids = rows
          .map((r) => String(r[idKey]).trim())
          .filter(Boolean)

        if (!ids.length) {
          return reject(new Error('Nenhum ID válido encontrado na planilha.'))
        }

        resolve(ids)
      } catch (err) {
        reject(new Error('Erro ao processar o arquivo Excel: ' + err.message))
      }
    }

    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Exporta o array de logs como arquivo XLSX.
 * Colunas: ID, TITULO_ANTES, TITULO_DEPOIS, DESC_ANTES, DESC_DEPOIS, STATUS, DATA_HORA
 */
export function exportLogsToXlsx(logs) {
  const rows = logs.flatMap((log) => {
    const titulo = log.changes.find((c) => c.field === 'TITULO')
    const descricao = log.changes.find((c) => c.field === 'DESCRIÇÃO')

    return [
      {
        ID: log.productId,
        TITULO_ANTES: titulo?.before ?? '',
        TITULO_DEPOIS: titulo?.after ?? '',
        DESCRICAO_ANTES: descricao?.before ?? '',
        DESCRICAO_DEPOIS: descricao?.after ?? '',
        STATUS: log.status === 'applied' ? 'Aplicado' : log.status === 'undone' ? 'Desfeito' : 'Erro',
        DATA_HORA: new Date(log.timestamp).toLocaleString('pt-BR'),
      },
    ]
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  // Ajusta largura das colunas
  ws['!cols'] = [
    { wch: 15 },  // ID
    { wch: 60 },  // TITULO_ANTES
    { wch: 60 },  // TITULO_DEPOIS
    { wch: 100 }, // DESCRICAO_ANTES
    { wch: 100 }, // DESCRICAO_DEPOIS
    { wch: 12 },  // STATUS
    { wch: 20 },  // DATA_HORA
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Logs')

  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `logs-melhoria-${date}.xlsx`)
}
