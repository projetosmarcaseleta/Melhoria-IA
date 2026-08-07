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
  idle:       { text: 'Aguardando',     style: { background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' } },
  processing: { text: 'Processando...', style: { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' } },
  processed:  { text: 'Processado',     style: { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' } },
  applying:   { text: 'Aplicando...',   style: { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' } },
  applied:    { text: 'Aplicado',       style: { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' } },
  undone:     { text: 'Desfeito',       style: { background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' } },
  error:      { text: 'Erro',           style: { background: 'rgba(244,63,94,0.15)', color: '#f87171', border: '1px solid rgba(244,63,94,0.3)' } },
}

// Badge visual para cada tipo de produto
const TYPE_BADGE = {
  SIMPLE:        { text: 'Simples',        color: '#22d3ee', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.3)' },
  KIT:           { text: 'Kit',            color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)' },
  VARIATION:     { text: 'Variação',       color: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.3)' },
  KIT_VARIATION: { text: 'Kit c/ Var.',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
}

/**
 * Retorna true se o produto pode receber PATCH.
 * Regra: SIMPLE = sempre pode. KIT = só se priceCalculation === 'NONE'.
 * VARIATION e KIT_VARIATION seguem mesma regra do KIT.
 */
export function canPatchProduct(product) {
  const type = (product.productType ?? 'SIMPLE').toUpperCase()
  if (type === 'SIMPLE') return true
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
  const setConfig = useStore((s) => s.setConfig)
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

  // ── Consulta direta ao banco de dados (n8n webhook) ─────────────────────
  const handleFetchWebhook = async () => {
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
      addToast('success', `${fetched.length} produtos carregados do banco de dados.`)
    } catch (e) {
      addToast('error', 'Erro na consulta: ' + e.message)
    } finally {
      setFetchingWebhook(false)
    }
  }

  // ── Processar com IA ────────────────────────────────────────────────────
  const handleProcessAI = async () => {
    const fields = []
    if (config.applyTitles) fields.push('title')
    if (config.applyDescriptions) fields.push('description')

    if (fields.length === 0) {
      addToast('warning', 'Selecione pelo menos um campo (Título ou Descrição) para processar.')
      return
    }

    const targets = products.filter((p) =>
      (ui.selectedIds.length ? ui.selectedIds.includes(p.id) : true) && p.status === 'idle'
    )
    if (!targets.length) { addToast('info', 'Nenhum produto elegível (status Aguardando).'); return }
    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)

    await parallelProcess(targets, CONCURRENCY, async (p) => {
      try {
        const results = await processProductsWithAI([p], fields)
        const r = results[0]
        if (r.error) {
          updateProductStatus(r.id, 'error')
        } else {
          updateProductResult(
            r.id,
            fields.includes('title') ? (r.newTitle ?? p.newTitle ?? '') : (p.newTitle ?? ''),
            fields.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? ''),
            r.titleGenerationId ?? p.titleGenerationId,
            r.descGenerationId ?? p.descGenerationId
          )
        }
      } catch (e) {
        updateProductStatus(p.id, 'error')
        addToast('error', `Erro produto ${p.id}: ` + e.message)
      }
    }, (done, total) => setProgress(done, total))

    setProcessing(false)
    addToast('success', `IA concluída. ${targets.length} produtos processados.`)
    
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
    <div className="space-y-5">
      {/* Dashboard de Estatísticas */}
      <StatusDashboard />

      {/* Entrada de IDs */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 bg-slate-950/60">
          <span className="text-xs font-bold text-white uppercase tracking-wider mr-3">
            1. Informe os IDs dos Produtos
          </span>
          {[
            { key: 'manual', icon: '✏️', label: 'Inserir manualmente' },
            { key: 'file', icon: '📂', label: 'Planilha Excel' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setInputMode(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                inputMode === tab.key
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {inputMode === 'file' && <FileUpload onIdsLoaded={handleFileLoaded} disabled={isLoading} />}
          {inputMode === 'manual' && (
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              disabled={isLoading}
              placeholder={'Cole ou digite os IDs aqui, um por linha:\n18057008\n18060671\n18060816\n\nTambém aceita separação por vírgula, ponto-e-vírgula ou espaço.'}
              rows={4}
              className="w-full p-3.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-y"
            />
          )}
          <button
            onClick={handleFetchWebhook}
            disabled={isLoading || (inputMode === 'manual' && !manualText.trim()) || (inputMode === 'file' && !fileRef?.length)}
            className="w-full py-3 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {ui.isFetchingWebhook ? (
              <>
                <span className="login-spinner" />
                <span>Consultando banco de dados no n8n...</span>
              </>
            ) : (
              <span>🔗 2. Consultar banco de dados</span>
            )}
          </button>
        </div>
      </div>

      {/* Barra de Progresso */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <ProcessingBar
            current={ui.progress?.current ?? 0}
            total={ui.progress?.total ?? 0}
            label={ui.isProcessing ? 'Processando com IA...' : ui.isApplying ? 'Aplicando no AnyMarket...' : 'Carregando...'}
          />
        </div>
      )}

      {/* Tabela de Produtos */}
      {products.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-0">
          
          {/* Action Bar Superior */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-950/70 border-b border-slate-800">
            {/* Filtros de Busca e Status */}
            <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
              <input
                type="text"
                placeholder="Buscar por ID ou título..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3.5 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 min-w-[160px]"
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3.5 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500 shrink-0"
              >
                <option value="all">Todos os status</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v.text}</option>
                ))}
              </select>
            </div>

            {/* Controles de Processamento & Botões de Ação (REDESENHADOS PARA ALTO IMPACTO VISUAL) */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Seleção de Campos (Títulos / Descrições) */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">
                  Campos IA:
                </span>
                
                {/* Toggle Título */}
                <button
                  type="button"
                  onClick={() => setConfig({ applyTitles: !config.applyTitles })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                    config.applyTitles
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                    config.applyTitles ? 'bg-indigo-500 text-white' : 'border border-slate-700'
                  }`}>
                    {config.applyTitles ? '✓' : ''}
                  </span>
                  <span>Título</span>
                </button>

                {/* Toggle Descrição */}
                <button
                  type="button"
                  onClick={() => setConfig({ applyDescriptions: !config.applyDescriptions })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                    config.applyDescriptions
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] ${
                    config.applyDescriptions ? 'bg-emerald-500 text-white' : 'border border-slate-700'
                  }`}>
                    {config.applyDescriptions ? '✓' : ''}
                  </span>
                  <span>Descrição</span>
                </button>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleProcessAI}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
                >
                  <span>🤖 3. Processar com IA</span>
                </button>
                <button
                  onClick={() => setTab('review')}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 transition-all flex items-center gap-1.5"
                >
                  <span>👁️ 4. Revisar</span>
                </button>
                <button
                  onClick={clearProducts}
                  disabled={isLoading}
                  className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all"
                  title="Limpar lista de produtos"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>

          {/* Tabela de Produtos com Estilização Refinada de Checkboxes */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/90 text-slate-300 font-extrabold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 pl-4 pr-2 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer accent-indigo-600 align-middle"
                    />
                  </th>
                  <th className="py-3.5 px-3">ID</th>
                  <th className="py-3.5 px-3">Título Atual</th>
                  <th className="py-3.5 px-3">Tipo</th>
                  <th className="py-3.5 px-3">Título Novo (IA)</th>
                  <th className="py-3.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Nenhum produto encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const sl = STATUS_LABEL[p.status] ?? STATUS_LABEL.idle
                    const typeBadge = TYPE_BADGE[(p.productType ?? 'SIMPLE').toUpperCase()] ?? TYPE_BADGE.SIMPLE
                    const patchAllowed = canPatchProduct(p)
                    const isRowSelected = ui.selectedIds.includes(p.id)

                    return (
                      <tr
                        key={p.id + '-' + p.idSku}
                        className={`transition-colors ${
                          isRowSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-950/40'
                        }`}
                      >
                        <td className="py-3.5 pl-4 pr-2 text-center">
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={() => toggleSelectId(p.id)}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer accent-indigo-600 align-middle"
                          />
                        </td>
                        <td className="py-3.5 px-3 font-mono font-semibold text-slate-300 text-[11px] whitespace-nowrap">
                          {p.id}
                        </td>
                        <td className="py-3.5 px-3 font-medium text-white max-w-xs truncate" title={p.title}>
                          {p.title || <span className="text-slate-500 italic">—</span>}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border"
                            style={{ background: typeBadge.bg, color: typeBadge.color, borderColor: typeBadge.border }}
                          >
                            {typeBadge.text}
                          </span>
                          {!patchAllowed && (
                            <span
                              title={`PATCH bloqueado: ${p.productType} com cálculo ${p.priceCalculation}`}
                              className="ml-1.5 text-xs cursor-help"
                            >
                              🔒
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 max-w-xs truncate" title={p.newTitle}>
                          {p.newTitle ? (
                            <span className="font-bold text-emerald-400">{p.newTitle}</span>
                          ) : (
                            <span className="text-slate-500 italic">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span
                            className="px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase"
                            style={sl.style}
                          >
                            {sl.text}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer da Tabela */}
          <div className="px-5 py-3 bg-slate-950/80 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span>Exibindo {filtered.length} de {products.length} produto(s)</span>
            {ui.selectedIds.length > 0 && (
              <span className="font-bold text-indigo-400">
                {ui.selectedIds.length} produto(s) selecionado(s)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      <FloatingActionBar onProcess={handleProcessAI} disabled={isLoading} />
    </div>
  )
}
