import { useState } from 'react'
import useStore from '../store/useStore'
import FileUpload from './FileUpload'
import ProcessingBar from './ProcessingBar'
import StatusDashboard from './StatusDashboard'
import FloatingActionBar from './FloatingActionBar'
import { parseIdsFromExcel } from '../services/excelService'
import { fetchProductsFromWebhook } from '../services/webhookService'
import { processProductsWithAI } from '../services/aiService'
import { parallelProcess } from '../utils/batchUtils'
import { playCompletionSound, showBrowserNotification } from '../utils/notificationUtils'

const CONCURRENCY = 10

const STATUS_LABEL = {
  idle:       { text: 'Aguardando',     style: { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' } },
  processing: { text: 'Processando...', style: { background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' } },
  processed:  { text: 'Processado',     style: { background: 'var(--accent-amber-glow)', color: 'var(--accent-amber)' } },
  applying:   { text: 'Aplicando...',   style: { background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' } },
  applied:    { text: 'Aplicado',       style: { background: 'var(--accent-emerald-glow)', color: 'var(--accent-emerald)' } },
  undone:     { text: 'Desfeito',       style: { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' } },
  error:      { text: 'Erro',           style: { background: 'var(--accent-rose-glow)', color: 'var(--accent-rose)' } },
}

// Badge visual para cada tipo de produto
const TYPE_BADGE = {
  SIMPLE:        { text: 'Simples',        color: '#22d3ee', bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.25)' },
  KIT:           { text: 'Kit',            color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
  VARIATION:     { text: 'Variação',       color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.25)' },
  KIT_VARIATION: { text: 'Kit c/ Var.',    color: '#fb923c', bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.25)' },
}

/**
 * Retorna true se o produto pode receber PATCH.
 * Regra: SIMPLE = sempre pode. KIT = só se priceCalculation === 'NONE'.
 * VARIATION e KIT_VARIATION seguem mesma regra do KIT.
 */
export function canPatchProduct(product) {
  const type = (product.productType ?? 'SIMPLE').toUpperCase()
  if (type === 'SIMPLE') return true
  // KIT, VARIATION, KIT_VARIATION: só pode se cálculo de preço for estritamente NONE
  const calc = (product.priceCalculation ?? '').toString().trim().toUpperCase()
  return calc === 'NONE'
}


export default function ProductTable() {
  const products = useStore((s) => s.products)
  const setProducts = useStore((s) => s.setProducts)
  const updateProductStatus = useStore((s) => s.updateProductStatus)
  const updateProductResult = useStore((s) => s.updateProductResult)
  const addToast = useStore((s) => s.addToast)
  const config = useStore((s) => s.config)
  const ui = useStore((s) => s.ui)
  const setProcessing = useStore((s) => s.setProcessing)
  const setFetchingWebhook = useStore((s) => s.setFetchingWebhook)
  const setProgress = useStore((s) => s.setProgress)
  const setTab = useStore((s) => s.setTab)
  const toggleSelectId = useStore((s) => s.toggleSelectId)
  const selectAllIds = useStore((s) => s.selectAllIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const clearProducts = useStore((s) => s.clearProducts)

  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [inputMode, setInputMode] = useState('manual')
  const [manualText, setManualText] = useState('')
  const [fileRef, setFileRef] = useState(null)

  // ── Upload Excel ────────────────────────────────────────────────────────
  const handleFileLoaded = async (file, err) => {
    if (err) { addToast('error', err); return }
    try {
      const ids = await parseIdsFromExcel(file)
      setFileRef(ids)
      addToast('success', `${ids.length} IDs carregados da planilha.`)
    } catch (e) {
      addToast('error', e.message)
    }
  }

  // ── Consulta direta (R2: merged confirm + fetch) ────────────────────────
  const handleFetchWebhook = async () => {
    // Parse IDs from whichever input mode
    let ids = fileRef ?? []
    if (inputMode === 'manual') {
      ids = manualText.split(/[\n,;|\s]+/).map((s) => s.trim()).filter(Boolean)
      ids = [...new Set(ids)]
    }

    if (!ids.length) { addToast('warning', 'Adicione IDs primeiro.'); return }

    setFetchingWebhook(true)
    try {
      const fetched = await fetchProductsFromWebhook(ids)
      setProducts(fetched)
      clearSelection()
      addToast('success', `${fetched.length} produtos carregados do banco.`)
    } catch (e) {
      addToast('error', 'Erro na consulta: ' + e.message)
    } finally {
      setFetchingWebhook(false)
    }
  }

  // ── Processar com IA ────────────────────────────────────────────────────
  const handleProcessAI = async () => {
    const targets = products.filter((p) =>
      (ui.selectedIds.length ? ui.selectedIds.includes(p.id) : true) && p.status === 'idle'
    )
    if (!targets.length) { addToast('info', 'Nenhum produto elegível (status Aguardando).'); return }
    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)
    await parallelProcess(targets, CONCURRENCY, async (p) => {
      try {
        const results = await processProductsWithAI([p])
        const r = results[0]
        if (r.error) updateProductStatus(r.id, 'error')
        else updateProductResult(r.id, r.newTitle, r.newDescription)
      } catch (e) {
        updateProductStatus(p.id, 'error')
        addToast('error', `Erro produto ${p.id}: ` + e.message)
      }
    }, (done, total) => setProgress(done, total))
    setProcessing(false)
    addToast('success', `IA concluída. ${targets.length} produtos processados.`)
    // Feature D: Notificação
    if (config.soundNotification) {
      playCompletionSound()
      showBrowserNotification('Processamento concluído', `${targets.length} produtos processados pela IA.`)
    }
    setTab('review')
  }

  // ── Renderização ────────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    const matchSearch = !search || p.id.toLowerCase().includes(search.toLowerCase()) || p.title.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const allSelected = filtered.length > 0 && filtered.every((p) => ui.selectedIds.includes(p.id))
  const toggleAll = () => { if (allSelected) clearSelection(); else selectAllIds() }
  const isLoading = ui.isProcessing || ui.isFetchingWebhook || ui.isApplying

  return (
    <div className="space-y-4">
      {/* Feature A: Status Dashboard */}
      <StatusDashboard />

      {/* Entrada de IDs — R2: sem "Confirmar IDs", direto consulta */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-1 px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-sm font-semibold mr-3" style={{ color: 'var(--text-primary)' }}>1. Informe os IDs</span>
          {[
            { key: 'manual', icon: '✏️', label: 'Inserir manualmente' },
            { key: 'file', icon: '📂', label: 'Planilha Excel' },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setInputMode(tab.key)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderBottom: inputMode === tab.key ? '2px solid var(--accent-indigo)' : '2px solid transparent',
                color: inputMode === tab.key ? 'var(--accent-indigo-light)' : 'var(--text-muted)',
                borderRadius: '6px 6px 0 0',
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-3">
          {inputMode === 'file' && <FileUpload onIdsLoaded={handleFileLoaded} disabled={isLoading} />}
          {inputMode === 'manual' && (
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} disabled={isLoading}
              placeholder={'Cole ou digite os IDs aqui, um por linha:\n12345\n67890\n\nTambém aceita vírgula, ponto-e-vírgula ou espaço.'}
              rows={4} className="input-dark font-mono text-xs resize-y" />
          )}
          <button onClick={handleFetchWebhook} disabled={isLoading || (inputMode === 'manual' && !manualText.trim()) || (inputMode === 'file' && !fileRef?.length)}
            className="btn-primary w-full justify-center">
            {ui.isFetchingWebhook ? '⏳ Consultando banco...' : '🔗 2. Consultar banco de dados'}
          </button>
        </div>
      </div>

      {/* Progress — R1: only one, shown above table */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <div className="card p-4">
          <ProcessingBar current={ui.progress?.current ?? 0} total={ui.progress?.total ?? 0}
            label={ui.isProcessing ? 'Processando com IA...' : ui.isApplying ? 'Aplicando na AnyMarket...' : 'Carregando...'} />
        </div>
      )}

      {/* Tabela */}
      {products.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <input type="text" placeholder="Buscar por ID ou título..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="input-dark flex-1 min-w-[180px] text-xs py-2" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="input-dark w-auto text-xs py-2" style={{ minWidth: '140px' }}>
              <option value="all">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (<option key={k} value={k}>{v.text}</option>))}
            </select>
            <div className="ml-auto flex gap-2">
              <button onClick={handleProcessAI} disabled={isLoading} className="btn-primary text-xs py-2">🤖 3. Processar com IA</button>
              <button onClick={() => setTab('review')} disabled={isLoading} className="btn-primary text-xs py-2" style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>👁️ 4. Revisar</button>
              <button onClick={clearProducts} disabled={isLoading} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors" title="Limpar lista"
                style={{ background: 'rgba(251,113,133,0.08)', color: 'var(--accent-rose)' }}>🗑️</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="w-8 px-3 py-2.5"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="checkbox-custom" /></th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>ID</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Título atual</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tipo</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Título novo</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum produto encontrado.</td></tr>
                ) : filtered.map((p) => {
                  const sl = STATUS_LABEL[p.status] ?? STATUS_LABEL.idle
                  const typeBadge = TYPE_BADGE[(p.productType ?? 'SIMPLE').toUpperCase()] ?? TYPE_BADGE.SIMPLE
                  const patchAllowed = canPatchProduct(p)
                  return (
                    <tr key={p.id + '-' + p.idSku} className="transition-colors"
                      style={{ borderBottom: '1px solid var(--border-subtle)', background: ui.selectedIds.includes(p.id) ? 'rgba(99,102,241,0.05)' : 'transparent' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = ui.selectedIds.includes(p.id) ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = ui.selectedIds.includes(p.id) ? 'rgba(99,102,241,0.05)' : 'transparent'}>
                      <td className="px-3 py-2"><input type="checkbox" checked={ui.selectedIds.includes(p.id)} onChange={() => toggleSelectId(p.id)} className="checkbox-custom" /></td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{p.id}</td>
                      <td className="px-3 py-2 max-w-xs truncate" style={{ color: 'var(--text-secondary)' }} title={p.title}>{p.title || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="badge" style={{ background: typeBadge.bg, color: typeBadge.color, border: `1px solid ${typeBadge.border}` }}>
                          {typeBadge.text}
                        </span>
                        {!patchAllowed && (
                          <span title={`PATCH bloqueado: ${p.productType} com cálculo ${p.priceCalculation}`} style={{ marginLeft: 6, cursor: 'help', fontSize: '12px' }}>🔒</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate" title={p.newTitle}>{p.newTitle ? <span className="font-medium" style={{ color: 'var(--accent-emerald)' }}>{p.newTitle}</span> : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="badge" style={sl.style}>{sl.text}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 flex justify-between text-xs" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>{filtered.length} de {products.length} produto(s)</span>
            {ui.selectedIds.length > 0 && <span style={{ color: 'var(--accent-indigo-light)' }}>{ui.selectedIds.length} selecionado(s)</span>}
          </div>
        </div>
      )}

      {/* Feature G: Floating Action Bar */}
      <FloatingActionBar onProcess={handleProcessAI} disabled={isLoading} />
    </div>
  )
}
