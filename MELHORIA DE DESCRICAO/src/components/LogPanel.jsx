import { useState } from 'react'
import useStore from '../store/useStore'
import LogEntry from './LogEntry'
import { exportLogsToXlsx } from '../services/excelService'
import { patchProduct, sleep } from '../services/anymarketService'

export default function LogPanel() {
  const logs = useStore((s) => s.logs)
  const clearLogs = useStore((s) => s.clearLogs)
  const setLogStatus = useStore((s) => s.setLogStatus)
  const updateProductStatus = useStore((s) => s.updateProductStatus)
  const addToast = useStore((s) => s.addToast)
  const config = useStore((s) => s.config)

  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [undoingAll, setUndoingAll] = useState(false)

  const filtered = logs.filter((l) => {
    const matchStatus = filterStatus === 'all' || l.status === filterStatus
    const matchSearch =
      !search ||
      l.productId.toLowerCase().includes(search.toLowerCase()) ||
      (l.productTitle ?? '').toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const handleExport = () => {
    if (!logs.length) { addToast('info', 'Nenhum log para exportar.'); return }
    exportLogsToXlsx(logs)
    addToast('success', 'Arquivo XLSX exportado com sucesso.')
  }

  const handleUndoAll = async () => {
    const applicable = logs.filter((l) => l.status === 'applied')
    if (!applicable.length) { addToast('info', 'Nenhum item aplicado para desfazer.'); return }
    if (!config.gumgaToken) { addToast('error', 'Configure o token AnyMarket.'); return }

    setUndoingAll(true)
    let ok = 0
    for (const log of applicable) {
      try {
        await patchProduct(
          log.productId,
          log.originalData.title,
          log.originalData.description,
          config.gumgaToken,
          config.anymarketMode === 'webhook' ? config.anymarketWebhookUrl : ''
        )
        setLogStatus(log.logId, 'undone')
        updateProductStatus(log.productId, 'undone')
        ok++
      } catch (e) {
        addToast('error', `Erro ao desfazer ${log.productId}: ` + e.message)
      }
      await sleep(1500)
    }
    setUndoingAll(false)
    addToast('success', `${ok} produto(s) revertidos com sucesso.`)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Buscar por ID ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[160px] border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          >
            <option value="all">Todos</option>
            <option value="applied">Aplicados</option>
            <option value="undone">Desfeitos</option>
            <option value="error">Com erro</option>
          </select>

          <div className="ml-auto flex gap-2">
            <button
              onClick={handleUndoAll}
              disabled={undoingAll || !logs.some((l) => l.status === 'applied')}
              className="flex items-center gap-1 bg-orange-100 text-orange-700 text-sm px-3 py-1.5 rounded-md hover:bg-orange-200 disabled:opacity-50 transition-colors font-medium"
            >
              {undoingAll ? '⏳ Desfazendo...' : '↩️ Desfazer todos'}
            </button>
            <button
              onClick={handleExport}
              disabled={!logs.length}
              className="flex items-center gap-1 bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              📥 Exportar XLSX
            </button>
            <button
              onClick={clearLogs}
              disabled={!logs.length}
              className="text-red-500 text-sm px-2 py-1.5 rounded-md hover:bg-red-50 disabled:opacity-50"
              title="Limpar logs"
            >
              🗑️
            </button>
          </div>
        </div>

        {/* Contador */}
        <div className="mt-2 flex gap-4 text-xs text-gray-500">
          <span>Total: <strong>{logs.length}</strong></span>
          <span>Aplicados: <strong className="text-emerald-600">{logs.filter((l) => l.status === 'applied').length}</strong></span>
          <span>Desfeitos: <strong className="text-gray-500">{logs.filter((l) => l.status === 'undone').length}</strong></span>
          {filtered.length !== logs.length && (
            <span>Exibindo: <strong>{filtered.length}</strong></span>
          )}
        </div>
      </div>

      {/* Lista de logs */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-gray-500 text-sm">
            {logs.length === 0
              ? 'Nenhuma alteração registrada ainda. Processe e aplique produtos para ver os logs aqui.'
              : 'Nenhum log corresponde ao filtro aplicado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((log) => (
            <LogEntry key={log.logId} log={log} />
          ))}
        </div>
      )}
    </div>
  )
}
