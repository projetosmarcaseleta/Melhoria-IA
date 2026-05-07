import { useState } from 'react'
import useStore from '../store/useStore'
import ProcessingBar from './ProcessingBar'
import FloatingActionBar from './FloatingActionBar'
import { processProductsWithAI } from '../services/aiService'
import { patchProduct } from '../services/anymarketService'
import { parallelProcess } from '../utils/batchUtils'
import { playCompletionSound, showBrowserNotification } from '../utils/notificationUtils'
import { v4 as uuidv4 } from 'uuid'

const CONCURRENCY = 10

const STATUS_STYLES = {
  processing: { background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' },
  processed:  { background: 'var(--accent-amber-glow)', color: 'var(--accent-amber)' },
  applying:   { background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' },
  applied:    { background: 'var(--accent-emerald-glow)', color: 'var(--accent-emerald)' },
  error:      { background: 'var(--accent-rose-glow)', color: 'var(--accent-rose)' },
}
const STATUS_LABEL = {
  processing: 'Processando...', processed: 'Processado', applying: 'Aplicando...',
  applied: 'Aplicado', error: 'Erro',
}

// Feature E: Char counter color
function charColor(len, max) {
  if (len <= max * 0.7) return 'var(--accent-emerald)'
  if (len <= max) return 'var(--accent-amber)'
  return 'var(--accent-rose)'
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
  const setConfigOpen        = useStore((s) => s.setConfigOpen)
  const ui                   = useStore((s) => s.ui)
  const setProcessing        = useStore((s) => s.setProcessing)
  const setApplying          = useStore((s) => s.setApplying)
  const setProgress          = useStore((s) => s.setProgress)
  const setTab               = useStore((s) => s.setTab)

  const [selected, setSelected]       = useState([])
  const [fieldSel, setFieldSel]       = useState({})
  const [previewing, setPreviewing]   = useState({})

  const reviewable = products.filter((p) =>
    ['processed', 'error', 'applying', 'processing'].includes(p.status) || (p.newTitle || p.newDescription)
  )

  const isLoading     = ui.isProcessing || ui.isApplying
  const isAllSelected = reviewable.length > 0 && reviewable.every((p) => selected.includes(p.id))

  const toggleSelect = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const selectAll   = () => setSelected(reviewable.map((p) => p.id))
  const deselectAll = () => setSelected([])

  const getFieldSelFor = (id) => fieldSel[id] ?? { titulo: true, descricao: true }

  const toggleFieldSel = (id, field) => {
    setFieldSel((prev) => {
      const cur  = prev[id] ?? { titulo: true, descricao: true }
      const next = { ...cur, [field]: !cur[field] }
      if (!next.titulo && !next.descricao) return prev
      return { ...prev, [id]: next }
    })
  }

  // Bulk toggles — liga/desliga todos títulos ou descrições de uma vez
  const allTitulosOn = reviewable.every((p) => getFieldSelFor(p.id).titulo)
  const allDescOn    = reviewable.every((p) => getFieldSelFor(p.id).descricao)

  const toggleAllTitulos = () => {
    const newVal = !allTitulosOn
    setFieldSel((prev) => {
      const next = { ...prev }
      for (const p of reviewable) {
        const cur = next[p.id] ?? { titulo: true, descricao: true }
        // Não deixa ambos false
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
        const cur = next[p.id] ?? { titulo: true, descricao: true }
        // Não deixa ambos false
        if (!newVal && !cur.titulo) continue
        next[p.id] = { ...cur, descricao: newVal }
      }
      return next
    })
  }

  const togglePreview = (id) => setPreviewing((prev) => ({ ...prev, [id]: !prev[id] }))

  const handleEditTitle = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) updateProductNewData(id, value, p.newDescription ?? '')
  }
  const handleEditDescription = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (p) updateProductNewData(id, p.newTitle ?? '', value)
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
          fields.includes('description') ? (r.newDescription ?? product.newDescription ?? '') : (product.newDescription ?? ''))
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
          fields.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? ''))
      } catch (e) { updateProductStatus(p.id, 'error') }
    }, (done, total) => setProgress(done, total))
    setProcessing(false)
    addToast('success', `IA refeita para ${targets.length} produto(s).`)
    if (config.soundNotification) { playCompletionSound(); showBrowserNotification('IA Concluída', `${targets.length} produtos reprocessados.`) }
  }

  const handleApplySelected = async () => {
    const targets = reviewable.filter((p) => selected.includes(p.id) && p.status === 'processed')
    if (!targets.length) { addToast('info', 'Nenhum produto "Processado" selecionado.'); return }
    if (!config.gumgaToken) { setConfigOpen(true); return }
    const fieldsMap = Object.fromEntries(targets.map((p) => [p.id, getActiveFields(getFieldSelFor(p.id))]))
    targets.forEach((p) => updateProductStatus(p.id, 'applying'))
    setApplying(true)
    setProgress(0, targets.length)
    await parallelProcess(targets, CONCURRENCY, async (p) => {
      const fields = fieldsMap[p.id]
      try {
        await patchProduct(p.id, fields.includes('title') ? p.newTitle : p.title, fields.includes('description') ? p.newDescription : p.description, config.gumgaToken)
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

  if (reviewable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
        <span className="text-5xl mb-4">🔍</span>
        <p className="text-lg font-medium">Nenhum produto processado para revisar.</p>
        <p className="text-sm mt-1">Volte para{' '}
          <button onClick={() => setTab('products')} style={{ color: 'var(--accent-indigo-light)' }} className="hover:underline">Produtos</button>
          {' '}e execute o processamento com IA.</p>
      </div>
    )
  }

  const TITLE_MAX = 60

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Revisão — <span className="font-normal" style={{ color: 'var(--text-muted)' }}>{reviewable.length} produto(s)</span>
        </span>
        <div className="flex gap-2 flex-wrap">
          <button onClick={isAllSelected ? deselectAll : selectAll} className="btn-secondary text-xs py-1.5 px-3">
            {isAllSelected ? 'Desselecionar todos' : 'Selecionar todos'}
          </button>
          <button onClick={toggleAllTitulos}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: allTitulosOn ? 'var(--accent-indigo-glow)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${allTitulosOn ? 'rgba(99,102,241,0.35)' : 'var(--border-default)'}`,
              color: allTitulosOn ? 'var(--accent-indigo-light)' : 'var(--text-muted)',
            }}>
            🏷️ Todos Títulos
            <div className="w-7 h-[16px] rounded-full relative ml-1" style={{ background: allTitulosOn ? 'var(--accent-indigo)' : 'rgba(255,255,255,0.1)' }}>
              <div className="w-[12px] h-[12px] rounded-full bg-white absolute top-[2px] transition-all" style={{ left: allTitulosOn ? '13px' : '2px' }} />
            </div>
          </button>
          <button onClick={toggleAllDescricoes}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: allDescOn ? 'var(--accent-emerald-glow)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${allDescOn ? 'rgba(52,211,153,0.35)' : 'var(--border-default)'}`,
              color: allDescOn ? 'var(--accent-emerald)' : 'var(--text-muted)',
            }}>
            📄 Todas Descrições
            <div className="w-7 h-[16px] rounded-full relative ml-1" style={{ background: allDescOn ? 'var(--accent-emerald)' : 'rgba(255,255,255,0.1)' }}>
              <div className="w-[12px] h-[12px] rounded-full bg-white absolute top-[2px] transition-all" style={{ left: allDescOn ? '13px' : '2px' }} />
            </div>
          </button>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <button onClick={handleRedoSelected} disabled={isLoading || !selected.length} className="btn-primary text-xs py-1.5">
            🔄 Refazer IA {selected.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(255,255,255,0.2)' }}>{selected.length}</span>}
          </button>
          <button onClick={handleApplySelected} disabled={isLoading || !selected.length}
            className="btn-primary text-xs py-1.5" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
            🚀 Aplicar {selected.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(255,255,255,0.2)' }}>{selected.length}</span>}
          </button>
        </div>
      </div>

      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <div className="card p-4">
          <ProcessingBar current={ui.progress?.current ?? 0} total={ui.progress?.total ?? 0}
            label={ui.isProcessing ? 'Refazendo com IA...' : 'Aplicando na AnyMarket...'} />
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {reviewable.map((p) => {
          const isSelected = selected.includes(p.id)
          const sl = STATUS_LABEL[p.status]
          const ss = STATUS_STYLES[p.status]
          const isPreview  = previewing[p.id]
          const fsel       = getFieldSelFor(p.id)
          const titleLen   = (p.newTitle ?? '').length
          const titleColor = charColor(titleLen, TITLE_MAX)

          return (
            <div key={p.id} className="card transition-all" style={{ borderColor: isSelected ? 'rgba(99,102,241,0.3)' : undefined, boxShadow: isSelected ? 'var(--shadow-glow-indigo)' : undefined }}>
              {/* Card header */}
              <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)} className="checkbox-custom" />
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{p.id}</span>
                {sl && <span className="badge" style={ss}>{sl}</span>}
                <div className="flex items-center gap-2 ml-2">
                  {['titulo', 'descricao'].map((field) => {
                    const active = fsel[field]
                    const isTitle = field === 'titulo'
                    return (
                      <label key={field} className="flex items-center gap-1 text-xs cursor-pointer select-none px-2 py-0.5 rounded-full transition-all"
                        style={{
                          background: active ? (isTitle ? 'var(--accent-indigo-glow)' : 'var(--accent-emerald-glow)') : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${active ? (isTitle ? 'rgba(99,102,241,0.3)' : 'rgba(52,211,153,0.3)') : 'var(--border-default)'}`,
                          color: active ? (isTitle ? 'var(--accent-indigo-light)' : 'var(--accent-emerald)') : 'var(--text-muted)',
                        }}>
                        <input type="checkbox" checked={active} onChange={() => toggleFieldSel(p.id, field)} style={{ display: 'none' }} />
                        {isTitle ? '🏷️ Título' : '📄 Descrição'}
                      </label>
                    )
                  })}
                </div>
                <div className="ml-auto">
                  <button onClick={() => handleRedoSingle(p)} disabled={isLoading}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-all disabled:opacity-40"
                    style={{ background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    🔄 Refazer IA
                  </button>
                </div>
              </div>

              {/* Título */}
              {fsel.titulo && (
                <div className="grid grid-cols-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="px-4 py-3" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                    <p className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider" style={{ color: 'var(--text-muted)' }}>Título — Antes</p>
                    <p className="text-sm leading-snug" style={{ color: 'var(--text-secondary)' }}>{p.title || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}</p>
                  </div>
                  <div className="px-4 py-3" style={{ background: 'rgba(99,102,241,0.03)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--accent-indigo-light)' }}>Título — Depois</p>
                      <span className="text-[10px] font-bold" style={{ color: titleColor }}>{titleLen}/{TITLE_MAX}{titleLen > TITLE_MAX && ' ⚠'}</span>
                    </div>
                    <input type="text" value={p.newTitle ?? ''} onChange={(e) => handleEditTitle(p.id, e.target.value)} disabled={isLoading} className="input-dark text-sm font-medium py-1.5" />
                    {/* Feature E: Visual char bar */}
                    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-1 rounded-full transition-all duration-200" style={{ width: `${charBarPct(titleLen, TITLE_MAX)}%`, background: titleColor }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Descrição */}
              {fsel.descricao && (
                <div className="grid grid-cols-2">
                  <div className="px-4 py-3" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                    <p className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider" style={{ color: 'var(--text-muted)' }}>Descrição — Antes</p>
                    <div className="text-xs max-h-40 overflow-y-auto" style={{ color: 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: p.description || '<em>—</em>' }} />
                  </div>
                  <div className="px-4 py-3" style={{ background: 'rgba(52,211,153,0.03)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--accent-emerald)' }}>Descrição — Depois</p>
                      <button onClick={() => togglePreview(p.id)} className="text-[10px] underline" style={{ color: 'var(--accent-emerald)' }}>
                        {isPreview ? 'Editar HTML' : 'Preview'}
                      </button>
                    </div>
                    {isPreview ? (
                      <div className="text-xs max-h-40 overflow-y-auto rounded-lg p-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: p.newDescription || '<em>—</em>' }} />
                    ) : (
                      <textarea value={p.newDescription ?? ''} onChange={(e) => handleEditDescription(p.id, e.target.value)} disabled={isLoading} rows={4}
                        className="input-dark text-xs font-mono resize-y" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Feature G: Floating bar */}
      <FloatingActionBar onProcess={handleRedoSelected} onApply={handleApplySelected} disabled={isLoading} />
    </div>
  )
}
