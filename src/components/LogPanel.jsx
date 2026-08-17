import { useState, useMemo } from 'react'
import useStore from '../store/useStore'
import LogEntry from './LogEntry'
import { exportLogsToXlsx } from '../services/excelService'
import { patchProduct, sleep } from '../services/anymarketService'

/** Feature H: Agrupa logs por data/sessão */
function groupBySession(logs) {
  const groups = {}
  for (const log of logs) {
    const d = new Date(log.timestamp)
    const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(log)
  }
  return Object.entries(groups)
}

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
  const [collapsed, setCollapsed] = useState({})

  const filtered = logs.filter((l) => {
    const matchStatus = filterStatus === 'all' || l.status === filterStatus
    const matchSearch = !search || l.productId.toLowerCase().includes(search.toLowerCase()) || (l.productTitle ?? '').toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const sessions = useMemo(() => groupBySession(filtered), [filtered])

  const toggleCollapse = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  const handleExport = () => {
    if (!logs.length) { addToast('info', 'Ainda não há nada para exportar.'); return }
    exportLogsToXlsx(logs)
    addToast('success', 'Pronto! Planilha exportada.')
  }

  const handleUndoAll = async () => {
    const applicable = logs.filter((l) => l.status === 'applied')
    if (!applicable.length) { addToast('info', 'Nenhum item aplicado para desfazer.'); return }
    if (!config.gumgaToken) { addToast('error', 'Configure o token AnyMarket.'); return }
    setUndoingAll(true)
    let ok = 0
    for (const log of applicable) {
      try {
        await patchProduct(log.productId, log.originalData.title, log.originalData.description, config.gumgaToken)
        setLogStatus(log.logId, 'undone')
        updateProductStatus(log.productId, 'undone')
        ok++
      } catch (e) {
        addToast('error', `Erro ao desfazer ${log.productId}: ` + e.message)
      }
      await sleep(1500)
    }
    setUndoingAll(false)
    addToast('success', `Pronto! ${ok} anúncio(s) revertido(s).`)
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="Buscar por ID ou título..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="input-dark flex-1 min-w-[160px] text-xs py-2" />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-dark w-auto text-xs py-2">
            <option value="all">Todos</option>
            <option value="applied">Aplicados</option>
            <option value="undone">Desfeitos</option>
            <option value="error">Com erro</option>
          </select>
          <div className="ml-auto flex gap-2">
            <button onClick={handleUndoAll} disabled={undoingAll || !logs.some((l) => l.status === 'applied')}
              className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg font-medium transition-all disabled:opacity-40"
              style={{ background: 'var(--accent-amber-glow)', color: 'var(--accent-amber)', border: '1px solid rgba(251,191,36,0.2)' }}>
              {undoingAll ? '⏳ Desfazendo...' : '↩️ Desfazer todos'}
            </button>
            <button onClick={handleExport} disabled={!logs.length} className="btn-primary text-xs py-2" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
              📥 Exportar XLSX
            </button>
            <button onClick={clearLogs} disabled={!logs.length} title="Limpar logs"
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(251,113,133,0.08)', color: 'var(--accent-rose)' }}>🗑️</button>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Total: <strong style={{ color: 'var(--text-secondary)' }}>{logs.length}</strong></span>
          <span>Aplicados: <strong style={{ color: 'var(--accent-emerald)' }}>{logs.filter((l) => l.status === 'applied').length}</strong></span>
          <span>Desfeitos: <strong style={{ color: 'var(--text-muted)' }}>{logs.filter((l) => l.status === 'undone').length}</strong></span>
          {filtered.length !== logs.length && <span>Exibindo: <strong style={{ color: 'var(--accent-indigo-light)' }}>{filtered.length}</strong></span>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {logs.length === 0 ? 'Nenhuma alteração registrada ainda.' : 'Nenhum log corresponde ao filtro.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {sessions.map(([date, items]) => (
            <div key={date}>
              {/* Feature H: Session header */}
              <button onClick={() => toggleCollapse(date)}
                className="w-full flex items-center gap-3 mb-3 group cursor-pointer">
                <div className="h-px flex-1" style={{ background: 'var(--border-default)' }} />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {collapsed[date] ? '▶' : '▼'}
                  </span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>📅 {date}</span>
                  <span className="badge text-[10px]" style={{ background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' }}>
                    {items.length}
                  </span>
                </div>
                <div className="h-px flex-1" style={{ background: 'var(--border-default)' }} />
              </button>

              {!collapsed[date] && (
                <div className="space-y-3">
                  {items.map((log) => (<LogEntry key={log.logId} log={log} />))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
