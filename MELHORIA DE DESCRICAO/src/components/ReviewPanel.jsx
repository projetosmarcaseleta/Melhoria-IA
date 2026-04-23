import { useState } from 'react'
import useStore from '../store/useStore'
import ProcessingBar from './ProcessingBar'
import { processProductsWithAI } from '../services/aiService'
import { patchProduct } from '../services/anymarketService'
import { parallelProcess } from '../utils/batchUtils'
import { v4 as uuidv4 } from 'uuid'

const CONCURRENCY = 10

const STATUS_CLS = {
  processing: 'bg-blue-100 text-blue-700 animate-pulse',
  processed:  'bg-yellow-100 text-yellow-700',
  applying:   'bg-purple-100 text-purple-700 animate-pulse',
  applied:    'bg-emerald-100 text-emerald-700',
  error:      'bg-red-100 text-red-700',
}
const STATUS_LABEL = {
  processing: 'Processando...',
  processed:  'Processado',
  applying:   'Aplicando...',
  applied:    'Aplicado',
  error:      'Erro',
}

// Retorna o array de fields ativos para um produto
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
  const setConfigOpen        = useStore((s) => s.setConfigOpen)
  const ui                   = useStore((s) => s.ui)
  const setProcessing        = useStore((s) => s.setProcessing)
  const setApplying          = useStore((s) => s.setApplying)
  const setProgress          = useStore((s) => s.setProgress)
  const setTab               = useStore((s) => s.setTab)

  const [selected, setSelected]       = useState([])
  const [fieldSel, setFieldSel]       = useState({}) // { [id]: { titulo: bool, descricao: bool } }
  const [previewing, setPreviewing]   = useState({}) // { [id]: true }

  const reviewable = products.filter((p) =>
    ['processed', 'error', 'applying', 'processing'].includes(p.status) ||
    (p.newTitle || p.newDescription)
  )

  const isLoading     = ui.isProcessing || ui.isApplying
  const isAllSelected = reviewable.length > 0 && reviewable.every((p) => selected.includes(p.id))

  // ── Helpers de seleção de produto ────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const selectAll   = () => setSelected(reviewable.map((p) => p.id))
  const deselectAll = () => setSelected([])

  // ── Helpers de seleção de campo ──────────────────────────────────────────
  const getFieldSelFor = (id) => fieldSel[id] ?? { titulo: true, descricao: true }

  const toggleFieldSel = (id, field) => {
    setFieldSel((prev) => {
      const cur  = prev[id] ?? { titulo: true, descricao: true }
      const next = { ...cur, [field]: !cur[field] }
      // Pelo menos um campo deve estar ativo
      if (!next.titulo && !next.descricao) return prev
      return { ...prev, [id]: next }
    })
  }

  const togglePreview = (id) =>
    setPreviewing((prev) => ({ ...prev, [id]: !prev[id] }))

  // ── Edição inline ────────────────────────────────────────────────────────
  const handleEditTitle = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) updateProductNewData(id, value, p.newDescription ?? '')
  }

  const handleEditDescription = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) updateProductNewData(id, p.newTitle ?? '', value)
  }

  // ── Refazer IA (individual) ──────────────────────────────────────────────
  const handleRedoSingle = async (product) => {
    if (isLoading) return

    // Captura os campos ANTES de qualquer state update que cause re-render
    const fields = getActiveFields(getFieldSelFor(product.id))
    const existingNewTitle       = product.newTitle       ?? ''
    const existingNewDescription = product.newDescription ?? ''
    if (!fields.length) return

    updateProductStatus(product.id, 'processing')
    setProcessing(true)
    setProgress(0, 1)
    try {
      const results = await processProductsWithAI([product], fields)
      const r = results[0]
      if (r.error) {
        updateProductStatus(r.id, 'error')
        addToast('error', `Erro ao refazer IA para ${r.id}: ${r.error}`)
      } else {
        // Usa o valor novo apenas para os campos solicitados; mantém o existente nos demais
        updateProductResult(
          r.id,
          fields.includes('title')       ? (r.newTitle       ?? existingNewTitle)       : existingNewTitle,
          fields.includes('description') ? (r.newDescription ?? existingNewDescription) : existingNewDescription
        )
        addToast('success', `IA refeita para produto ${r.id}.`)
      }
    } catch (e) {
      updateProductStatus(product.id, 'error')
      addToast('error', 'Erro ao refazer IA: ' + e.message)
    } finally {
      setProcessing(false)
      setProgress(0, 0)
    }
  }

  // ── Refazer IA (selecionados) — 10 workers em paralelo ──────────────────
  const handleRedoSelected = async () => {
    const targets = reviewable.filter((p) => selected.includes(p.id))
    if (!targets.length) { addToast('warning', 'Selecione ao menos um produto.'); return }

    // Captura snapshot dos campos selecionados ANTES de qualquer state update
    const fieldsMap = Object.fromEntries(
      targets.map((p) => [p.id, getActiveFields(getFieldSelFor(p.id))])
    )

    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)

    await parallelProcess(
      targets,
      CONCURRENCY,
      async (p) => {
        const fields = fieldsMap[p.id]  // usa snapshot, sem closure de estado React
        if (!fields?.length) return
        try {
          const results = await processProductsWithAI([p], fields)
          const r = results[0]
          if (r.error) {
            updateProductStatus(r.id, 'error')
          } else {
            updateProductResult(
              r.id,
              fields.includes('title')       ? (r.newTitle       ?? p.newTitle       ?? '') : (p.newTitle       ?? ''),
              fields.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? '')
            )
          }
        } catch (e) {
          updateProductStatus(p.id, 'error')
          addToast('error', `Erro produto ${p.id}: ` + e.message)
        }
      },
      (done, total) => setProgress(done, total)
    )

    setProcessing(false)
    addToast('success', `IA refeita para ${targets.length} produto(s).`)
  }

  // ── Aplicar selecionados — 10 workers em paralelo ───────────────────────
  const handleApplySelected = async () => {
    const targets = reviewable.filter(
      (p) => selected.includes(p.id) && p.status === 'processed'
    )
    if (!targets.length) {
      addToast('info', 'Nenhum produto com status "Processado" selecionado.')
      return
    }
    if (!config.gumgaToken) { setConfigOpen(true); return }

    // Captura snapshot dos campos e config ANTES de qualquer state update
    const fieldsMap  = Object.fromEntries(
      targets.map((p) => [p.id, getActiveFields(getFieldSelFor(p.id))])
    )
    const webhookUrl  = config.anymarketMode === 'webhook' ? config.anymarketWebhookUrl : ''
    const gumgaToken  = config.gumgaToken

    targets.forEach((p) => updateProductStatus(p.id, 'applying'))
    setApplying(true)
    setProgress(0, targets.length)

    await parallelProcess(
      targets,
      CONCURRENCY,
      async (p) => {
        const fields = fieldsMap[p.id]  // usa snapshot, sem closure de estado React
        try {
          // Sempre envia ambos os campos para a AnyMarket.
          // Para o campo NÃO selecionado, usa o valor original (p.title / p.description)
          // para evitar que a AnyMarket apague ou sobrescreva o que não foi alterado.
          await patchProduct(
            p.id,
            fields.includes('title')       ? p.newTitle       : p.title,
            fields.includes('description') ? p.newDescription : p.description,
            gumgaToken, webhookUrl,
          )
          updateProductStatus(p.id, 'applied')

          // Log apenas os campos que foram alterados
          const changes = []
          if (fieldsMap[p.id].includes('title'))       changes.push({ field: 'TITULO',    before: p.title,       after: p.newTitle })
          if (fieldsMap[p.id].includes('description')) changes.push({ field: 'DESCRIÇÃO', before: p.description, after: p.newDescription })

          addLog({
            logId: uuidv4(),
            productId: p.id,
            productTitle: p.newTitle ?? p.title,
            timestamp: new Date().toISOString(),
            status: 'applied',
            changes,
            originalData: { title: p.title, description: p.description },
          })
        } catch (e) {
          updateProductStatus(p.id, 'error')
          addToast('error', `Erro ao aplicar produto ${p.id}: ` + e.message)
        }
      },
      (done, total) => setProgress(done, total)
    )

    setApplying(false)
    addToast('success', `${targets.length} produto(s) enviados para a AnyMarket.`)
    setSelected((prev) =>
      prev.filter((id) => {
        const p = products.find((x) => x.id === id)
        return p && p.status !== 'applied'
      })
    )

    const stillPending = products.filter((p) => ['processed', 'error'].includes(p.status))
    if (!stillPending.length) setTab('logs')
  }

  // ── Vazio ────────────────────────────────────────────────────────────────
  if (reviewable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <span className="text-5xl mb-4">🔍</span>
        <p className="text-lg font-medium">Nenhum produto processado para revisar.</p>
        <p className="text-sm mt-1">
          Volte para{' '}
          <button onClick={() => setTab('products')} className="text-indigo-600 hover:underline">
            Produtos
          </button>{' '}
          e execute o processamento com IA.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-700">
          Revisão —{' '}
          <span className="font-normal text-gray-500">{reviewable.length} produto(s)</span>
        </span>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={isAllSelected ? deselectAll : selectAll}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {isAllSelected ? 'Desselecionar todos' : 'Selecionar todos'}
          </button>
          {selected.length > 0 && !isAllSelected && (
            <button
              onClick={deselectAll}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Limpar seleção
            </button>
          )}
        </div>

        <div className="ml-auto flex gap-2 flex-wrap">
          <button
            onClick={handleRedoSelected}
            disabled={isLoading || !selected.length}
            className="flex items-center gap-1.5 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            🔄 Refazer IA
            {selected.length > 0 && (
              <span className="bg-blue-500 rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                {selected.length}
              </span>
            )}
          </button>
          <button
            onClick={handleApplySelected}
            disabled={isLoading || !selected.length}
            className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            🚀 Aplicar na AnyMarket
            {selected.length > 0 && (
              <span className="bg-emerald-500 rounded-full px-1.5 py-0.5 text-[10px] leading-none">
                {selected.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <ProcessingBar
          current={ui.progress?.current ?? 0}
          total={ui.progress?.total ?? 0}
          label={ui.isProcessing ? 'Refazendo com IA...' : 'Aplicando na AnyMarket...'}
        />
      )}

      {/* Cards */}
      <div className="space-y-3">
        {reviewable.map((p) => {
          const isSelected = selected.includes(p.id)
          const sl         = STATUS_LABEL[p.status]
          const sc         = STATUS_CLS[p.status]
          const isPreview  = previewing[p.id]
          const fsel       = getFieldSelFor(p.id)
          const titleLen   = (p.newTitle ?? '').length

          return (
            <div
              key={p.id}
              className={`bg-white rounded-xl border transition-all ${
                isSelected ? 'border-indigo-400 shadow-sm' : 'border-gray-200'
              }`}
            >
              {/* Card header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100">
                {/* Seletor de produto */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(p.id)}
                  className="rounded accent-indigo-600 w-4 h-4 shrink-0"
                />
                <span className="font-mono text-xs text-gray-500 shrink-0">{p.id}</span>
                {sl && (
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${sc}`}>
                    {sl}
                  </span>
                )}

                {/* Seletores de campo */}
                <div className="flex items-center gap-2 ml-2">
                  <label className={`flex items-center gap-1 text-xs cursor-pointer select-none px-2 py-0.5 rounded-full border transition-colors ${
                    fsel.titulo
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}>
                    <input
                      type="checkbox"
                      checked={fsel.titulo}
                      onChange={() => toggleFieldSel(p.id, 'titulo')}
                      className="w-3 h-3 accent-indigo-600"
                    />
                    Título
                  </label>
                  <label className={`flex items-center gap-1 text-xs cursor-pointer select-none px-2 py-0.5 rounded-full border transition-colors ${
                    fsel.descricao
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}>
                    <input
                      type="checkbox"
                      checked={fsel.descricao}
                      onChange={() => toggleFieldSel(p.id, 'descricao')}
                      className="w-3 h-3 accent-emerald-600"
                    />
                    Descrição
                  </label>
                </div>

                <div className="ml-auto">
                  <button
                    onClick={() => handleRedoSingle(p)}
                    disabled={isLoading}
                    className="flex items-center gap-1 text-xs text-blue-600 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    🔄 Refazer IA
                  </button>
                </div>
              </div>

              {/* Título — só exibe se o campo estiver ativo */}
              {fsel.titulo && (
                <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
                  <div className="px-4 py-3">
                    <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1.5 tracking-wide">
                      Título — Antes
                    </p>
                    <p className="text-sm text-gray-700 leading-snug">
                      {p.title || <span className="text-gray-400 italic">—</span>}
                    </p>
                  </div>
                  <div className="px-4 py-3 bg-indigo-50/40">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] uppercase font-semibold text-indigo-600 tracking-wide">
                        Título — Depois
                      </p>
                      <span className={`text-[10px] font-medium ${titleLen > 60 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {titleLen}/60{titleLen > 60 && ' ⚠'}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={p.newTitle ?? ''}
                      onChange={(e) => handleEditTitle(p.id, e.target.value)}
                      disabled={isLoading}
                      className="w-full text-sm text-indigo-900 font-medium bg-white border border-indigo-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              )}

              {/* Descrição — só exibe se o campo estiver ativo */}
              {fsel.descricao && (
                <div className="grid grid-cols-2 divide-x divide-gray-100">
                  <div className="px-4 py-3">
                    <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1.5 tracking-wide">
                      Descrição — Antes
                    </p>
                    <div
                      className="text-xs text-gray-600 prose prose-sm max-w-none max-h-40 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: p.description || '<em>—</em>' }}
                    />
                  </div>
                  <div className="px-4 py-3 bg-emerald-50/40">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] uppercase font-semibold text-emerald-600 tracking-wide">
                        Descrição — Depois
                      </p>
                      <button
                        onClick={() => togglePreview(p.id)}
                        className="text-[10px] text-emerald-600 hover:text-emerald-800 underline"
                      >
                        {isPreview ? 'Editar HTML' : 'Preview'}
                      </button>
                    </div>
                    {isPreview ? (
                      <div
                        className="text-xs text-emerald-900 prose prose-sm max-w-none max-h-40 overflow-y-auto bg-white border border-emerald-200 rounded-md px-2 py-1"
                        dangerouslySetInnerHTML={{ __html: p.newDescription || '<em>—</em>' }}
                      />
                    ) : (
                      <textarea
                        value={p.newDescription ?? ''}
                        onChange={(e) => handleEditDescription(p.id, e.target.value)}
                        disabled={isLoading}
                        rows={5}
                        className="w-full text-xs text-emerald-900 font-mono bg-white border border-emerald-200 rounded-md px-2 py-1 resize-y focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
