import { useState } from 'react'
import useStore from '../store/useStore'
import ProcessingBar from './ProcessingBar'
import FloatingActionBar from './FloatingActionBar'
import { processProductsWithAI, submitFeedback, submitBatchFeedback } from '../services/aiService'
import { patchProduct } from '../services/anymarketService'
import { exportReviewToXlsx, exportBlockedProductsToXlsx } from '../services/excelService'
import { parallelProcess } from '../utils/batchUtils'
import { playCompletionSound, showBrowserNotification } from '../utils/notificationUtils'
import { canPatchProduct } from './ProductTable'
import { v4 as uuidv4 } from 'uuid'

const CONCURRENCY = 10

const STATUS_STYLES = {
  processing: { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' },
  processed:  { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' },
  applying:   { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' },
  applied:    { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' },
  error:      { background: 'rgba(244,63,94,0.15)', color: '#f87171', border: '1px solid rgba(244,63,94,0.3)' },
}
const STATUS_LABEL = {
  processing: 'Processando...', processed: 'Processado', applying: 'Aplicando...',
  applied: 'Aplicado', error: 'Erro',
}

const TYPE_BADGE = {
  SIMPLE:        { text: 'Simples',     color: '#22d3ee', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.3)' },
  KIT:           { text: 'Kit',         color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)' },
  VARIATION:     { text: 'Variação',    color: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.3)' },
  KIT_VARIATION: { text: 'Kit c/ Var.', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
}

function charColor(len, max) {
  if (len <= max * 0.7) return '#34d399'
  if (len <= max) return '#fbbf24'
  return '#f87171'
}
function charBarPct(len, max) { return Math.min((len / max) * 100, 100) }

function getActiveFields(sel) {
  const f = []
  if (sel.titulo)   f.push('title')
  if (sel.descricao) f.push('description')
  return f
}

export default function ReviewPanel() {
  const products             = useStore((s) => s.products)
  const updateProductStatus  = useStore((s) => s.updateProductStatus)
  const updateProductResult  = useStore((s) => s.updateProductResult)
  const updateProductNewData = useStore((s) => s.updateProductNewData)
  const addLog               = useStore((s) => s.addLog)
  const addToast             = useStore((s) => s.addToast)
  const config               = useStore((s) => s.config)
  const activeClient         = useStore((s) => s.activeClient)
  const setConfigOpen        = useStore((s) => s.setConfigOpen)
  const ui                   = useStore((s) => s.ui)
  const setProcessing        = useStore((s) => s.setProcessing)
  const setApplying          = useStore((s) => s.setApplying)
  const setProgress          = useStore((s) => s.setProgress)
  const setTab               = useStore((s) => s.setTab)

  const [selected, setSelected]       = useState([])
  const [fieldSel, setFieldSel]       = useState({})
  const [previewing, setPreviewing]   = useState({})
  const [showBlockedBanner, setShowBlockedBanner] = useState(false)
  const [blockedProducts, setBlockedProducts]     = useState([])
  const [pendingTargets, setPendingTargets]       = useState([])

  // Estado de feedback por generationId: { [genId]: 'approved' | 'rejected' | 'edited' }
  const [feedbackState, setFeedbackState] = useState({})

  const reviewable = products.filter((p) =>
    ['processed', 'error', 'applying', 'processing'].includes(p.status) || (p.newTitle || p.newDescription)
  )

  const isLoading     = ui.isProcessing || ui.isApplying
  const isAllSelected = reviewable.length > 0 && reviewable.every((p) => selected.includes(p.id))

  const toggleSelect = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const selectAll   = () => setSelected(reviewable.map((p) => p.id))
  const deselectAll = () => setSelected([])

  const getFieldSelFor = (id) => {
    if (fieldSel[id]) return fieldSel[id]
    const p = products.find((x) => x.id === id)
    if (!p) return { titulo: config.applyTitles, descricao: config.applyDescriptions }
    const hasNewTitle = p.newTitle !== undefined && p.newTitle !== null && p.newTitle !== ''
    const hasNewDesc = p.newDescription !== undefined && p.newDescription !== null && p.newDescription !== ''
    if (!hasNewTitle && !hasNewDesc) {
      return { titulo: config.applyTitles, descricao: config.applyDescriptions }
    }
    return { titulo: hasNewTitle, descricao: hasNewDesc }
  }

  const toggleFieldSel = (id, field) => {
    setFieldSel((prev) => {
      const cur  = prev[id] ?? getFieldSelFor(id)
      const next = { ...cur, [field]: !cur[field] }
      if (!next.titulo && !next.descricao) return prev
      return { ...prev, [id]: next }
    })
  }

  const allTitulosOn = reviewable.every((p) => getFieldSelFor(p.id).titulo)
  const allDescOn    = reviewable.every((p) => getFieldSelFor(p.id).descricao)

  const toggleAllTitulos = () => {
    const newVal = !allTitulosOn
    setFieldSel((prev) => {
      const next = { ...prev }
      for (const p of reviewable) {
        const cur = next[p.id] ?? getFieldSelFor(p.id)
        if (!newVal && !cur.descricao) continue
        next[p.id] = { ...cur, titulo: newVal }
      }
      return next
    })
  }

  const toggleAllDescricoes = () => {
    const newVal = !allDescOn
    setFieldSel((prev) => {
      const next = { ...prev }
      for (const p of reviewable) {
        const cur = next[p.id] ?? getFieldSelFor(p.id)
        if (!newVal && !cur.titulo) continue
        next[p.id] = { ...cur, descricao: newVal }
      }
      return next
    })
  }

  const togglePreview = (id) => setPreviewing((prev) => ({ ...prev, [id]: !prev[id] }))

  const handleEditTitle = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) {
      updateProductNewData(id, value, p.newDescription ?? '')
      if (p.titleGenerationId) {
        handleSingleFeedback(p.titleGenerationId, 'edited', value)
      }
    }
  }

  const handleEditDescription = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) {
      updateProductNewData(id, p.newTitle ?? '', value)
      if (p.descGenerationId) {
        handleSingleFeedback(p.descGenerationId, 'edited', value)
      }
    }
  }

  // ── Ações de Feedback ──
  const handleSingleFeedback = async (generationId, status, editedText = null) => {
    if (!generationId) return
    try {
      setFeedbackState((prev) => ({ ...prev, [generationId]: status }))
      await submitFeedback(generationId, status, editedText)
    } catch (err) {
      console.error('[Feedback] Erro ao enviar feedback:', err)
    }
  }

  const handleApproveSelected = async () => {
    const targets = reviewable.filter((p) => selected.includes(p.id))
    if (!targets.length) { addToast('warning', 'Selecione ao menos um produto.'); return }

    const genIds = []
    const updatedMap = {}

    targets.forEach((p) => {
      if (p.titleGenerationId) {
        genIds.push(p.titleGenerationId)
        updatedMap[p.titleGenerationId] = 'approved'
      }
      if (p.descGenerationId) {
        genIds.push(p.descGenerationId)
        updatedMap[p.descGenerationId] = 'approved'
      }
    })

    if (genIds.length > 0) {
      try {
        await submitBatchFeedback(genIds, 'approved')
      } catch (err) {
        console.warn('[ReviewPanel] Erro ao enviar feedback em lote:', err)
      }
    }

    setFeedbackState((prev) => ({ ...prev, ...updatedMap }))
    addToast('success', `${targets.length} produto(s) aprovado(s)! A IA usará esses exemplos no aprendizado futuro.`)
  }

  const handleRedoSingle = async (product) => {
    if (isLoading) return
    const fields = getActiveFields(getFieldSelFor(product.id))
    if (!fields.length) return
    updateProductStatus(product.id, 'processing')
    setProcessing(true)
    setProgress(0, 1)
    try {
      const results = await processProductsWithAI([product], fields)
      const r = results[0]
      if (r.error) { updateProductStatus(r.id, 'error'); addToast('error', `Erro: ${r.error}`) }
      else {
        updateProductResult(r.id,
          fields.includes('title') ? (r.newTitle ?? product.newTitle ?? '') : (product.newTitle ?? ''),
          fields.includes('description') ? (r.newDescription ?? product.newDescription ?? '') : (product.newDescription ?? ''),
          r.titleGenerationId ?? product.titleGenerationId,
          r.descGenerationId ?? product.descGenerationId
        )
        addToast('success', `IA refeita para produto ${r.id}.`)
      }
    } catch (e) { updateProductStatus(product.id, 'error'); addToast('error', 'Erro: ' + e.message) }
    finally { setProcessing(false); setProgress(0, 0) }
  }

  const handleRedoSelected = async () => {
    const targets = reviewable.filter((p) => selected.includes(p.id))
    if (!targets.length) { addToast('warning', 'Selecione ao menos um produto.'); return }
    const fieldsMap = Object.fromEntries(targets.map((p) => [p.id, getActiveFields(getFieldSelFor(p.id))]))
    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)
    await parallelProcess(targets, CONCURRENCY, async (p) => {
      const fields = fieldsMap[p.id]
      if (!fields?.length) return
      try {
        const results = await processProductsWithAI([p], fields)
        const r = results[0]
        if (r.error) updateProductStatus(r.id, 'error')
        else updateProductResult(r.id,
          fields.includes('title') ? (r.newTitle ?? p.newTitle ?? '') : (p.newTitle ?? ''),
          fields.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? ''),
          r.titleGenerationId ?? p.titleGenerationId,
          r.descGenerationId ?? p.descGenerationId
        )
      } catch (e) { updateProductStatus(p.id, 'error') }
    }, (done, total) => setProgress(done, total))
    setProcessing(false)
    addToast('success', `IA refeita para ${targets.length} produto(s).`)
    if (config.soundNotification) { playCompletionSound(); showBrowserNotification('IA Concluída', `${targets.length} produtos reprocessados.`) }
  }

  const handleApplySelected = async () => {
    const allTargets = reviewable.filter((p) => selected.includes(p.id) && p.status === 'processed')
    if (!allTargets.length) { addToast('info', 'Nenhum produto "Processado" selecionado.'); return }

    const token = activeClient?.anymarket_token || config.gumgaToken
    if (!token) { setConfigOpen(true); addToast('warning', 'Configure o token AnyMarket para este cliente.'); return }

    const blocked = allTargets.filter((p) => !canPatchProduct(p))
    const targets = allTargets.filter((p) => canPatchProduct(p))

    if (blocked.length > 0) {
      setBlockedProducts(blocked)
      setPendingTargets(targets)
      setShowBlockedBanner(true)
      return
    }

    await executeApply(targets)
  }

  const executeApply = async (targets) => {
    if (!targets.length) return
    const fieldsMap = Object.fromEntries(targets.map((p) => [p.id, getActiveFields(getFieldSelFor(p.id))]))
    targets.forEach((p) => updateProductStatus(p.id, 'applying'))
    setApplying(true)
    setProgress(0, targets.length)
    const token = activeClient?.anymarket_token || config.gumgaToken

    await parallelProcess(targets, CONCURRENCY, async (p) => {
      const fields = fieldsMap[p.id]
      const genIds = []
      if (p.titleGenerationId) genIds.push(p.titleGenerationId)
      if (p.descGenerationId) genIds.push(p.descGenerationId)

      try {
        await patchProduct(
          p.id,
          fields.includes('title') ? p.newTitle : p.title,
          fields.includes('description') ? p.newDescription : p.description,
          token,
          genIds
        )
        updateProductStatus(p.id, 'applied')
        const changes = []
        if (fields.includes('title'))       changes.push({ field: 'TITULO',    before: p.title,       after: p.newTitle })
        if (fields.includes('description')) changes.push({ field: 'DESCRIÇÃO', before: p.description, after: p.newDescription })
        addLog({ logId: uuidv4(), productId: p.id, productTitle: p.newTitle ?? p.title, timestamp: new Date().toISOString(), status: 'applied', changes, originalData: { title: p.title, description: p.description } })
      } catch (e) { updateProductStatus(p.id, 'error'); addToast('error', `Erro ${p.id}: ` + e.message) }
    }, (done, total) => setProgress(done, total))
    setApplying(false)
    addToast('success', `${targets.length} produto(s) enviados para a AnyMarket.`)
    if (config.soundNotification) { playCompletionSound(); showBrowserNotification('Aplicação concluída', `${targets.length} produtos aplicados na AnyMarket.`) }
    setSelected((prev) => prev.filter((id) => { const p = products.find((x) => x.id === id); return p && p.status !== 'applied' }))
    const stillPending = products.filter((p) => ['processed', 'error'].includes(p.status))
    if (!stillPending.length) setTab('logs')
  }

  const handleExportBlocked = () => {
    exportBlockedProductsToXlsx(blockedProducts)
    addToast('success', `Planilha com ${blockedProducts.length} produto(s) bloqueado(s) baixada.`)
  }

  const handleConfirmApplyAllowed = async () => {
    setShowBlockedBanner(false)
    if (pendingTargets.length > 0) {
      await executeApply(pendingTargets)
    }
    setPendingTargets([])
    setBlockedProducts([])
  }

  const handleCancelBlocked = () => {
    setShowBlockedBanner(false)
    setPendingTargets([])
    setBlockedProducts([])
  }

  if (reviewable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-slate-900 border border-slate-800 rounded-3xl text-center p-8 space-y-4 shadow-xl animate-fadeIn">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-3xl text-indigo-400">
          🔍
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">Nenhum produto em revisão</h3>
          <p className="text-xs text-slate-400">
            Volte para a aba de <button onClick={() => setTab('products')} className="text-indigo-400 font-bold hover:underline">Produtos</button> e execute a geração por IA.
          </p>
        </div>
      </div>
    )
  }

  const TITLE_MAX = 60

  return (
    <div className="space-y-5 animate-fadeIn">
      
      {/* Action Toolbar Superior (REDESENHADA PARA ALTO IMPACTO E ALTO CONSTRASTE) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          
          {/* Lado Esquerdo: Título & Seleção Geral */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-lg">👁️</span>
              <h2 className="text-sm font-extrabold text-white uppercase tracking-wider">
                Revisão de Produtos
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                {reviewable.length} produto(s)
              </span>
            </div>

            <div className="h-5 w-px bg-slate-800 hidden sm:block" />

            <button
              onClick={isAllSelected ? deselectAll : selectAll}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-all"
            >
              {isAllSelected ? 'Desselecionar todos' : 'Selecionar todos'}
            </button>
          </div>

          {/* Lado Direito: Toggles Rápidos de Campos */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAllTitulos}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                allTitulosOn
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🏷️</span>
              <span>Todos Títulos</span>
              <span className={`w-2 h-2 rounded-full ${allTitulosOn ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'}`} />
            </button>

            <button
              onClick={toggleAllDescricoes}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                allDescOn
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>📄</span>
              <span>Todas Descrições</span>
              <span className={`w-2 h-2 rounded-full ${allDescOn ? 'bg-emerald-400 animate-pulse' : 'bg-slate-700'}`} />
            </button>
          </div>
        </div>

        {/* Linha Inferior da Toolbar: Botões de Ação em Lote */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-slate-400 font-medium">
            {selected.length > 0 ? (
              <span className="text-indigo-400 font-bold">
                {selected.length} produto(s) selecionado(s) para ação em lote
              </span>
            ) : (
              <span>Selecione itens nos cards abaixo para aprovar ou aplicar em lote</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Aprovar Selecionados */}
            <button
              onClick={handleApproveSelected}
              disabled={!selected.length}
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span>✅ Aprovar Selecionados</span>
              {selected.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
                  {selected.length}
                </span>
              )}
            </button>

            {/* Exportar Planilha */}
            <button
              onClick={() => { exportReviewToXlsx(reviewable); addToast('success', 'Planilha exportada com sucesso.') }}
              disabled={!reviewable.length}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>📥 Exportar Planilha</span>
            </button>

            {/* Refazer IA */}
            <button
              onClick={handleRedoSelected}
              disabled={isLoading || !selected.length}
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>🔄 Refazer IA</span>
              {selected.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
                  {selected.length}
                </span>
              )}
            </button>

            {/* Aplicar AnyMarket */}
            <button
              onClick={handleApplySelected}
              disabled={isLoading || !selected.length}
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-teal-600 hover:bg-teal-500 text-white shadow-md shadow-teal-600/30 transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>🚀 Aplicar AnyMarket</span>
              {selected.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
                  {selected.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Banner de Produtos Bloqueados */}
      {showBlockedBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-overlayFade">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl animate-slideUp space-y-4">
            <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800 bg-rose-500/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h3 className="text-sm font-bold text-rose-300">Produtos com Cálculo de Preço Incompatível</h3>
                  <p className="text-xs text-slate-400">
                    {blockedProducts.length} produto(s) não podem ser alterados via API
                  </p>
                </div>
              </div>
              <button onClick={handleCancelBlocked} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="px-5 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Esses produtos possuem um <strong className="text-amber-400">Cálculo de Preço</strong> não suportado pela API da AnyMarket. Para alterá-los, baixe a planilha e faça as edições manualmente.
              </p>

              <div className="rounded-xl border border-slate-800 overflow-hidden max-h-44 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase text-[10px]">
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Cálculo</th>
                      <th className="px-3 py-2">Título</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {blockedProducts.map((bp) => {
                      const tb = TYPE_BADGE[(bp.productType ?? 'SIMPLE').toUpperCase()] ?? TYPE_BADGE.SIMPLE
                      return (
                        <tr key={bp.id} className="hover:bg-slate-950/40">
                          <td className="px-3 py-2 font-mono text-slate-400">{bp.id}</td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase" style={{ background: tb.bg, color: tb.color, border: `1px solid ${tb.border}` }}>
                              {tb.text}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-rose-400 font-bold">{bp.priceCalculation || '—'}</td>
                          <td className="px-3 py-2 text-slate-300 truncate max-w-[160px]">{bp.newTitle ?? bp.title}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
              <button
                onClick={handleExportBlocked}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all"
              >
                📥 Baixar Planilha ({blockedProducts.length})
              </button>
              <div className="flex items-center gap-2">
                {pendingTargets.length > 0 && (
                  <button
                    onClick={handleConfirmApplyAllowed}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-md"
                  >
                    🚀 Aplicar {pendingTargets.length} Permitido(s)
                  </button>
                )}
                <button
                  onClick={handleCancelBlocked}
                  className="px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <ProcessingBar
            current={ui.progress?.current ?? 0}
            total={ui.progress?.total ?? 0}
            label={ui.isProcessing ? 'Refazendo com IA...' : 'Aplicando no AnyMarket...'}
          />
        </div>
      )}

      {/* Cards de Revisão por Produto */}
      <div className="space-y-4">
        {reviewable.map((p) => {
          const isSelected = selected.includes(p.id)
          const sl = STATUS_LABEL[p.status]
          const ss = STATUS_STYLES[p.status]
          const isPreview  = previewing[p.id]
          const fsel       = getFieldSelFor(p.id)
          const titleLen   = (p.newTitle ?? '').length
          const titleColor = charColor(titleLen, TITLE_MAX)

          const titleGenId = p.titleGenerationId
          const descGenId = p.descGenerationId
          const titleFeedback = titleGenId ? feedbackState[titleGenId] : null
          const descFeedback = descGenId ? feedbackState[descGenId] : null

          return (
            <div
              key={p.id}
              className={`bg-slate-900 border rounded-2xl overflow-hidden transition-all duration-200 shadow-xl ${
                isSelected ? 'border-indigo-500 shadow-indigo-500/10 ring-1 ring-indigo-500/20' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Header do Card */}
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-800 bg-slate-950/70">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(p.id)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 accent-indigo-600 cursor-pointer"
                  />
                  <span className="font-mono font-extrabold text-xs text-white">ID: {p.id}</span>
                  
                  {(() => {
                    const tb = TYPE_BADGE[(p.productType ?? 'SIMPLE').toUpperCase()] ?? TYPE_BADGE.SIMPLE
                    const allowed = canPatchProduct(p)
                    return (
                      <>
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border" style={{ background: tb.bg, color: tb.color, borderColor: tb.border }}>
                          {tb.text}
                        </span>
                        {!allowed && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center gap-1" title={`Bloqueado: ${p.productType} (${p.priceCalculation})`}>
                            🔒 Bloqueado
                          </span>
                        )}
                      </>
                    )
                  })()}

                  {sl && (
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase" style={ss}>
                      {sl}
                    </span>
                  )}
                </div>

                {/* Seletores de Campo do Card + Refazer */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {['titulo', 'descricao'].map((field) => {
                      const active = fsel[field]
                      const isTitle = field === 'titulo'
                      return (
                        <button
                          key={field}
                          type="button"
                          onClick={() => toggleFieldSel(p.id, field)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                            active
                              ? isTitle
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                                : 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                              : 'bg-slate-950 border-slate-800 text-slate-500'
                          }`}
                        >
                          <span>{isTitle ? '🏷️ Título' : '📄 Descrição'}</span>
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => handleRedoSingle(p)}
                    disabled={isLoading}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-all flex items-center gap-1"
                  >
                    <span>🔄 Refazer IA</span>
                  </button>
                </div>
              </div>

              {/* Título (Antes vs Depois) */}
              {fsel.titulo && (
                <div className="grid grid-cols-1 md:grid-cols-2 border-b border-slate-800/80">
                  {/* Título Antes */}
                  <div className="p-5 border-b md:border-b-0 md:border-r border-slate-800/80 space-y-1.5">
                    <p className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">
                      Título — Antes
                    </p>
                    <p className="text-sm font-semibold text-slate-200 leading-snug">
                      {p.title || <span className="text-slate-500 italic">—</span>}
                    </p>
                  </div>

                  {/* Título Depois */}
                  <div className="p-5 bg-indigo-950/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] uppercase font-extrabold tracking-wider text-indigo-300">
                          Título — Depois (IA)
                        </p>
                        {titleFeedback && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            titleFeedback === 'approved'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : titleFeedback === 'rejected'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {titleFeedback === 'approved' ? '✅ Aprovado' : titleFeedback === 'rejected' ? '❌ Rejeitado' : '✏️ Editado'}
                          </span>
                        )}
                      </div>

                      {/* Feedback Buttons */}
                      <div className="flex items-center gap-2">
                        {titleGenId && (
                          <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                            <button
                              type="button"
                              onClick={() => handleSingleFeedback(titleGenId, 'approved')}
                              title="Aprovar título (treina a IA)"
                              className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                                titleFeedback === 'approved' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400'
                              }`}
                            >
                              ✅ Aprovar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSingleFeedback(titleGenId, 'rejected')}
                              title="Rejeitar título"
                              className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                                titleFeedback === 'rejected' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-rose-400'
                              }`}
                            >
                              ❌ Rejeitar
                            </button>
                          </div>
                        )}
                        <span className="text-xs font-mono font-bold" style={{ color: titleColor }}>
                          {titleLen}/{TITLE_MAX}{titleLen > TITLE_MAX && ' ⚠️'}
                        </span>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={p.newTitle ?? ''}
                      onChange={(e) => handleEditTitle(p.id, e.target.value)}
                      disabled={isLoading}
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-bold focus:outline-none focus:border-indigo-500"
                    />

                    {/* Progress Character Bar */}
                    <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${charBarPct(titleLen, TITLE_MAX)}%`, background: titleColor }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Descrição (Antes vs Depois) */}
              {fsel.descricao && (
                <div className="grid grid-cols-1 md:grid-cols-2">
                  {/* Descrição Antes */}
                  <div className="p-5 border-b md:border-b-0 md:border-r border-slate-800/80 space-y-1.5">
                    <p className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">
                      Descrição — Antes
                    </p>
                    <div
                      className="text-xs text-slate-300 max-h-48 overflow-y-auto leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: p.description || '<em>—</em>' }}
                    />
                  </div>

                  {/* Descrição Depois */}
                  <div className="p-5 bg-emerald-950/15 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] uppercase font-extrabold tracking-wider text-emerald-400">
                          Descrição — Depois (IA)
                        </p>
                        {descFeedback && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            descFeedback === 'approved'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : descFeedback === 'rejected'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {descFeedback === 'approved' ? '✅ Aprovado' : descFeedback === 'rejected' ? '❌ Rejeitado' : '✏️ Editado'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {descGenId && (
                          <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                            <button
                              type="button"
                              onClick={() => handleSingleFeedback(descGenId, 'approved')}
                              title="Aprovar descrição (treina a IA)"
                              className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                                descFeedback === 'approved' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400'
                              }`}
                            >
                              ✅ Aprovar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSingleFeedback(descGenId, 'rejected')}
                              title="Rejeitar descrição"
                              className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                                descFeedback === 'rejected' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-rose-400'
                              }`}
                            >
                              ❌ Rejeitar
                            </button>
                          </div>
                        )}
                        <button
                          onClick={() => togglePreview(p.id)}
                          className="px-2 py-1 rounded text-xs font-bold bg-slate-900 border border-slate-700 text-emerald-400 hover:text-white"
                        >
                          {isPreview ? 'Editar HTML' : 'Preview HTML'}
                        </button>
                      </div>
                    </div>

                    {isPreview ? (
                      <div
                        className="text-xs text-white max-h-48 overflow-y-auto rounded-xl p-3 bg-slate-950 border border-slate-700 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: p.newDescription || '<em>—</em>' }}
                      />
                    ) : (
                      <textarea
                        value={p.newDescription ?? ''}
                        onChange={(e) => handleEditDescription(p.id, e.target.value)}
                        disabled={isLoading}
                        rows={5}
                        className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-mono leading-relaxed focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-y"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <FloatingActionBar onProcess={handleRedoSelected} onApply={handleApplySelected} disabled={isLoading} />
    </div>
  )
}
