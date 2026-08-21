import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import useStore from '../store/useStore'
import ProcessingBar from './ProcessingBar'

import ReviewProductRow from './ReviewProductRow'
import Icon from './icons/Icon'
import { Button, IconButton, Panel, Badge, TypeBadge, EmptyState, Kbd } from './ui/primitives'
import { typeBadgeOf, canPatchProduct } from './ui/productTokens'
// `processProductsWithAI` (sem stream) segue em uso no "refazer" de um produto só, onde
// lote e stream não têm o que ganhar.
import { processProductsWithAI, processProductsWithAIStream, payloadIdOf, submitFeedback, submitBatchFeedback } from '../services/aiService'
import { patchProduct } from '../services/anymarketService'
import { exportReviewToXlsx, exportBlockedProductsToXlsx } from '../services/excelService'
import { parallelProcess, chunk } from '../utils/batchUtils'
import { playCompletionSound, showBrowserNotification } from '../utils/notificationUtils'
import { collectViolations, countProductsNeedingAttention } from '../utils/validationUtils'
import CategoryModal from './CategoryModal'
import PipelineWizard from './PipelineWizard'
import { fetchCategoryConfig } from '../services/categoryService'
import { v4 as uuidv4 } from 'uuid'

// Um LOTE de produtos por requisição, com a concorrência real decidida no servidor
// (llmLimiter). Ver a nota longa em ProductTable.jsx: workers de 1 produto batiam no limite
// de ~6 conexões por origem do HTTP/1.1 no navegador, então os 50 valiam ~6.
const REQUEST_CONCURRENCY = 6
const PRODUCTS_PER_REQUEST = 8
// Envio ao AnyMarket mantido em 10 para evitar throttling do ERP/Marketplace
const PATCH_CONCURRENCY = 10
// Espera antes de mandar o feedback 'edited' para o backend. Antes cada tecla
const FEEDBACK_DEBOUNCE_MS = 700
const PAGE_SIZE = 50

function getActiveFields(sel) {
  const f = []
  if (sel.titulo) f.push('title')
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
  const removeProducts       = useStore((s) => s.removeProducts)
  const setSelectedIds       = useStore((s) => s.setSelectedIds)
  const toggleSelectId       = useStore((s) => s.toggleSelectId)
  const clearSelection       = useStore((s) => s.clearSelection)

  // A seleção vive no store: a barra flutuante lê `ui.selectedIds` e antes
  // mostrava a contagem da aba Produtos enquanto os botões daqui agiam sobre um
  // `useState` local — duas seleções diferentes na mesma tela.
  const selected = ui.selectedIds

  const [fieldSel, setFieldSel]       = useState({})
  const [descView, setDescView]       = useState({})
  const [expanded, setExpanded]       = useState({})
  const [focusIdx, setFocusIdx]       = useState(-1)
  const [page, setPage]               = useState(1)
  const [showBlockedBanner, setShowBlockedBanner] = useState(false)
  const [blockedProducts, setBlockedProducts]     = useState([])
  const [pendingTargets, setPendingTargets]       = useState([])
  const [showShortcuts, setShowShortcuts]         = useState(false)

  const [categoryProduct, setCategoryProduct] = useState(null)
  const [categoryEnabled, setCategoryEnabled] = useState(false)
  const [pipelineOpen, setPipelineOpen] = useState(false)

  const [feedbackState, setFeedbackState] = useState({})

  const rowRefs = useRef({})
  const feedbackTimers = useRef({})

  useEffect(() => {
    if (!activeClient?.id) { setCategoryEnabled(false); return }
    let cancelado = false
    fetchCategoryConfig(activeClient.id)
      .then((cfg) => { if (!cancelado) setCategoryEnabled(Boolean(cfg?.isActive)) })
      .catch(() => { if (!cancelado) setCategoryEnabled(false) })
    return () => { cancelado = true }
  }, [activeClient?.id])

  // Descarta timers pendentes de feedback ao desmontar.
  useEffect(() => () => {
    Object.values(feedbackTimers.current).forEach(clearTimeout)
  }, [])

  const reviewable = products.filter((p) =>
    ['processed', 'error', 'applying', 'processing'].includes(p.status) || (p.newTitle || p.newDescription)
  )

  const totalPages = Math.ceil(reviewable.length / PAGE_SIZE) || 1
  const paginatedReviewable = reviewable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const isLoading     = ui.isProcessing || ui.isApplying
  const isAllSelected = reviewable.length > 0 && reviewable.every((p) => selected.includes(p._key || p.id))
  const attentionCount = countProductsNeedingAttention(reviewable)

  const selectAll   = () => setSelectedIds(reviewable.map((p) => p._key || p.id))
  const deselectAll = () => clearSelection()

  const getFieldSelFor = (id) => {
    if (fieldSel[id]) return fieldSel[id]
    const p = products.find((x) => (x._key || x.id) === id || x.id === id)
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

  const allTitulosOn = reviewable.every((p) => getFieldSelFor(p._key || p.id).titulo)
  const allDescOn    = reviewable.every((p) => getFieldSelFor(p._key || p.id).descricao)

  const toggleAllTitulos = () => {
    const newVal = !allTitulosOn
    setFieldSel((prev) => {
      const next = { ...prev }
      for (const p of reviewable) {
        const k = p._key || p.id
        const cur = next[k] ?? getFieldSelFor(k)
        if (!newVal && !cur.descricao) continue
        next[k] = { ...cur, titulo: newVal }
      }
      return next
    })
  }

  const toggleAllDescricoes = () => {
    const newVal = !allDescOn
    setFieldSel((prev) => {
      const next = { ...prev }
      for (const p of reviewable) {
        const k = p._key || p.id
        const cur = next[k] ?? getFieldSelFor(k)
        if (!newVal && !cur.titulo) continue
        next[k] = { ...cur, descricao: newVal }
      }
      return next
    })
  }

  // ── Expandir / recolher ────────────────────────────────────────────────
  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  const setDescViewFor = (id, mode) => setDescView((prev) => ({ ...prev, [id]: mode }))

  // Abre automaticamente só o que pede atenção — o resto fica recolhido para a
  // fila continuar escaneável.
  const autoOpenedRef = useRef(new Set())
  useEffect(() => {
    const toOpen = {}
    for (const p of reviewable) {
      const k = p._key || p.id
      if (autoOpenedRef.current.has(k)) continue
      if (collectViolations(p).length > 0) {
        toOpen[k] = true
        autoOpenedRef.current.add(k)
      }
    }
    if (Object.keys(toOpen).length) setExpanded((prev) => ({ ...prev, ...toOpen }))
  }, [reviewable.length, products])

  const expandAll   = () => setExpanded(Object.fromEntries(reviewable.map((p) => [p._key || p.id, true])))
  const collapseAll = () => setExpanded({})
  const expandedCount = reviewable.filter((p) => expanded[p._key || p.id]).length

  // ── Edição de texto ────────────────────────────────────────────────────
  /** Manda o feedback 'edited' só quando o operador para de digitar. */
  const queueEditedFeedback = (generationId, value) => {
    if (!generationId) return
    setFeedbackState((prev) => ({ ...prev, [generationId]: 'edited' }))
    clearTimeout(feedbackTimers.current[generationId])
    feedbackTimers.current[generationId] = setTimeout(() => {
      submitFeedback(generationId, 'edited', value).catch((err) => {
        console.error('[Feedback] Erro ao enviar edição:', err)
      })
      delete feedbackTimers.current[generationId]
    }, FEEDBACK_DEBOUNCE_MS)
  }

  const handleEditTitle = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (!p) return
    updateProductNewData(id, value, p.newDescription ?? '')
    queueEditedFeedback(p.titleGenerationId, value)
  }

  const handleEditDescription = (id, value) => {
    const p = products.find((x) => x.id === id)
    if (!p) return
    updateProductNewData(id, p.newTitle ?? '', value)
    queueEditedFeedback(p.descGenerationId, value)
  }

  // ── Feedback ───────────────────────────────────────────────────────────
  /**
   * Aprovar/rejeitar no item. Aprovar também SELECIONA o produto: antes o ✅ do
   * card e a seleção da barra de lote eram universos paralelos — dava para
   * aprovar tudo no card e a ação em lote não pegar nenhum.
   */
  const handleSingleFeedback = async (generationId, status, editedText = null) => {
    if (!generationId) return
    setFeedbackState((prev) => ({ ...prev, [generationId]: status }))

    if (status === 'approved') {
      const dono = products.find((p) => p.titleGenerationId === generationId || p.descGenerationId === generationId)
      // Lê a seleção fresca do store, não a do closure: aprovar no item dispara
      // este handler duas vezes no mesmo tick (título e descrição), e com o
      // valor defasado o segundo toggle desfazia o primeiro.
      if (dono && !useStore.getState().ui.selectedIds.includes(dono.id)) toggleSelectId(dono.id)
    }

    try {
      await submitFeedback(generationId, status, editedText)
    } catch (err) {
      console.error('[Feedback] Erro ao enviar feedback:', err)
    }
  }

  /**
   * "Só aprovar" — registra o endosso para o aprendizado e dispensa da fila,
   * SEM publicar na AnyMarket. Caminho secundário: serve para produtos
   * bloqueados (que não podem receber PATCH) e para quando o operador não quer
   * publicar agora. O caminho principal é handleApproveAndPublish.
   */
  const handleApproveOnly = async () => {
    const targets = reviewable.filter((p) => selected.includes(p._key || p.id))
    if (!targets.length) { addToast('warning', 'Selecione ao menos um produto.'); return }

    const genIds = []
    const updatedMap = {}

    targets.forEach((p) => {
      if (p.titleGenerationId) { genIds.push(p.titleGenerationId); updatedMap[p.titleGenerationId] = 'approved' }
      if (p.descGenerationId)  { genIds.push(p.descGenerationId);  updatedMap[p.descGenerationId] = 'approved' }
    })

    if (genIds.length > 0) {
      try {
        await submitBatchFeedback(genIds, 'approved')
      } catch (err) {
        console.warn('[ReviewPanel] Erro ao enviar feedback em lote:', err)
      }
    }

    setFeedbackState((prev) => ({ ...prev, ...updatedMap }))

    const approvedIds = targets.map((p) => p._key || p.id)
    removeProducts(approvedIds)
    setSelectedIds(selected.filter((id) => !approvedIds.includes(id)))

    addToast(
      'info',
      `Aprovado para aprendizado — ${targets.length} anúncio(s) saíram da fila sem ir para a AnyMarket.`
    )
  }

  /** Remove da fila os produtos já aprovados item a item. */
  const handleClearApproved = () => {
    const approvedIds = reviewable
      .filter((p) => {
        const tf = p.titleGenerationId ? feedbackState[p.titleGenerationId] : null
        const df = p.descGenerationId ? feedbackState[p.descGenerationId] : null
        return tf === 'approved' || df === 'approved'
      })
      .map((p) => p._key || p.id)

    if (!approvedIds.length) return

    removeProducts(approvedIds)
    setSelectedIds(selected.filter((id) => !approvedIds.includes(id)))
    addToast('info', `${approvedIds.length} produto(s) aprovado(s) saíram da fila.`)
  }

  const handleRedoSingle = async (product) => {
    if (isLoading) return
    const itemKey = product._key || product.id
    const fields = getActiveFields(getFieldSelFor(itemKey))
    if (!fields.length) return
    updateProductStatus(itemKey, 'processing')
    setProcessing(true)
    setProgress(0, 1)
    try {
      const results = await processProductsWithAI([product], fields)
      const r = results[0]
      if (r.error) { updateProductStatus(r.id || itemKey, 'error'); addToast('error', `Erro: ${r.error}`) }
      else {
        updateProductResult(r.id || itemKey,
          fields.includes('title') ? (r.newTitle ?? product.newTitle ?? '') : (product.newTitle ?? ''),
          fields.includes('description') ? (r.newDescription ?? product.newDescription ?? '') : (product.newDescription ?? ''),
          r.titleGenerationId ?? product.titleGenerationId,
          r.descGenerationId ?? product.descGenerationId,
          {
            titleValidation: r.titleValidation,
            descValidation: r.descValidation,
            titleRulesApplied: r.titleRulesApplied,
            descRulesApplied: r.descRulesApplied,
          }
        )
        const violations = [
          ...(r.titleValidation?.violations ?? []),
          ...(r.descValidation?.violations ?? []),
        ]
        if (violations.length > 0) {
          addToast('warning', `Refiz o anúncio — ainda há ${violations.length} ponto(s) para revisar.`)
        } else {
          addToast('success', 'Pronto! Anúncio refeito.')
        }
      }
    } catch (e) { updateProductStatus(itemKey, 'error'); addToast('error', 'Erro: ' + e.message) }
    finally { setProcessing(false); setProgress(0, 0) }
  }

  const cancelProcessRef = useState({ current: false })[0]
  // Abortar o fetch para o servidor parar de gerar (e de gastar cota) o resto do lote.
  const abortRef = useState({ current: null })[0]

  const handleCancelAI = () => {
    cancelProcessRef.current = true
    abortRef.current?.abort()
    setProcessing(false)
    useStore.getState().products.forEach((p) => {
      const itemKey = p._key || p.id
      if (p.status === 'processing') updateProductStatus(itemKey, 'processed')
    })
    addToast('info', 'Geração interrompida.')
  }

  const handleRedoSelected = async () => {
    const targets = reviewable.filter((p) => selected.includes(p._key || p.id))
    if (!targets.length) { addToast('warning', 'Selecione ao menos um produto.'); return }
    const fieldsMap = Object.fromEntries(targets.map((p) => [p._key || p.id, getActiveFields(getFieldSelFor(p._key || p.id))]))

    cancelProcessRef.current = false
    abortRef.current = new AbortController()
    targets.forEach((p) => updateProductStatus(p._key || p.id, 'processing'))
    setProcessing(true)

    // Cada produto pode ter uma combinação de campos diferente, e uma requisição carrega um
    // só `fields`. Agrupar por combinação antes de lotear mantém a semântica exata do
    // caminho de um-produto-por-requisição.
    const porCombinacao = new Map()
    for (const p of targets) {
      const itemKey = p._key || p.id
      const campos = fieldsMap[itemKey]

      if (!campos?.length) {
        // Nada selecionado: devolver ao estado anterior. Antes ficava preso em 'processing'.
        updateProductStatus(itemKey, 'processed')
        continue
      }

      const assinatura = [...campos].sort().join(',')
      if (!porCombinacao.has(assinatura)) porCombinacao.set(assinatura, { campos, produtos: [] })
      porCombinacao.get(assinatura).produtos.push(p)
    }

    const lotes = []
    for (const { campos, produtos } of porCombinacao.values()) {
      chunk(produtos, PRODUCTS_PER_REQUEST).forEach((parte) => lotes.push({ campos, produtos: parte }))
    }

    const totalGeracoes = lotes.reduce((n, l) => n + l.produtos.length, 0)
    setProgress(0, totalGeracoes)

    let needAttention = 0
    let concluidos = 0

    await parallelProcess(
      lotes,
      REQUEST_CONCURRENCY,
      async ({ campos, produtos }) => {
        if (cancelProcessRef.current) {
          produtos.forEach((p) => updateProductStatus(p._key || p.id, 'processed'))
          return
        }

        // Casar por ID, nunca por posição: o stream devolve na ordem em que cada produto
        // fica pronto. Quem sobra no mapa no fim é quem não voltou.
        const pendentes = new Map(produtos.map((p) => [payloadIdOf(p), p]))

        try {
          await processProductsWithAIStream(
            produtos,
            campos,
            (r) => {
              if (cancelProcessRef.current) return

              const p = pendentes.get(r.id)
              if (!p) return
              pendentes.delete(r.id)

              const itemKey = p._key || p.id
              concluidos++
              setProgress(concluidos, totalGeracoes)

              if (r.error) {
                updateProductStatus(itemKey, 'error')
                return
              }

              updateProductResult(itemKey,
                campos.includes('title') ? (r.newTitle ?? p.newTitle ?? '') : (p.newTitle ?? ''),
                campos.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? ''),
                r.titleGenerationId ?? p.titleGenerationId,
                r.descGenerationId ?? p.descGenerationId,
                {
                  titleValidation: r.titleValidation,
                  descValidation: r.descValidation,
                  titleRulesApplied: r.titleRulesApplied,
                  descRulesApplied: r.descRulesApplied,
                }
              )
              const violations = [
                ...(r.titleValidation?.violations ?? []),
                ...(r.descValidation?.violations ?? []),
              ]
              if (violations.length > 0) needAttention++
            },
            { signal: abortRef.current.signal }
          )

          pendentes.forEach((p) => updateProductStatus(p._key || p.id, cancelProcessRef.current ? 'processed' : 'error'))
        } catch {
          const status = cancelProcessRef.current ? 'processed' : 'error'
          pendentes.forEach((p) => updateProductStatus(p._key || p.id, status))
        }
      },
      undefined,
      () => cancelProcessRef.current
    )

    if (cancelProcessRef.current) { setProcessing(false); return }

    setProcessing(false)

    if (needAttention > 0) {
      addToast('warning', `Refiz ${targets.length} anúncio(s) — ${needAttention} ainda precisa(m) de atenção.`)
    } else {
      addToast('success', `Pronto! ${targets.length} anúncio(s) refeito(s).`)
    }
    if (config.soundNotification) {
      playCompletionSound()
      showBrowserNotification('Pronto! Anúncios refeitos.', `${targets.length} anúncio(s) atualizados.`)
    }
  }

  /**
   * Caminho principal — aprova E publica.
   *
   * A aprovação é gravada pelo próprio backend em POST /api/anymarket/patch:
   * publicar já é o endosso humano, então as gerações com feedbackStatus
   * 'pending' são promovidas para 'approved' lá. Aqui só refletimos isso no
   * estado local para os itens mostrarem o selo.
   */
  const handleApproveAndPublish = async () => {
    const allTargets = reviewable.filter((p) => selected.includes(p._key || p.id) && p.status === 'processed')
    if (!allTargets.length) { addToast('info', 'Nenhum produto pronto para publicar entre os selecionados.'); return }

    const token = activeClient?.anymarket_token || config.gumgaToken
    if (!token) { setConfigOpen(true); addToast('warning', 'Configure o token da AnyMarket para este cliente.'); return }

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
    const fieldsMap = Object.fromEntries(targets.map((p) => [p._key || p.id, getActiveFields(getFieldSelFor(p._key || p.id))]))
    targets.forEach((p) => updateProductStatus(p._key || p.id, 'applying'))
    setApplying(true)
    setProgress(0, targets.length)
    const token = activeClient?.anymarket_token || config.gumgaToken

    await parallelProcess(targets, PATCH_CONCURRENCY, async (p) => {
      const itemKey = p._key || p.id
      const fields = fieldsMap[itemKey]
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

        setFeedbackState((prev) => {
          const next = { ...prev }
          for (const genId of genIds) if (!next[genId]) next[genId] = 'approved'
          return next
        })

        const changes = []
        if (fields.includes('title'))       changes.push({ field: 'TITULO',    before: p.title,       after: p.newTitle })
        if (fields.includes('description')) changes.push({ field: 'DESCRIÇÃO', before: p.description, after: p.newDescription })
        addLog({ logId: uuidv4(), productId: p.id, productTitle: p.newTitle ?? p.title, timestamp: new Date().toISOString(), status: 'applied', changes, originalData: { title: p.title, description: p.description } })
      } catch (e) { updateProductStatus(p._key || p.id, 'error'); addToast('error', `Erro ${p.id}: ` + e.message) }
    }, (done, total) => setProgress(done, total))
    setApplying(false)

    addToast('success', `Pronto! ${targets.length} anúncio(s) publicado(s) na AnyMarket e aprovado(s) para aprendizado.`)
    if (config.soundNotification) {
      playCompletionSound()
      showBrowserNotification('Pronto! Anúncios publicados.', `${targets.length} anúncio(s) no ar na AnyMarket.`)
    }

    // Ler o estado fresco do store — o closure ficou defasado depois dos
    // updateProductStatus acima.
    const state = useStore.getState()
    const currentProducts = state.products
    setSelectedIds(state.ui.selectedIds.filter((id) => {
      const p = currentProducts.find((x) => (x._key || x.id) === id || x.id === id)
      return p && p.status !== 'applied'
    }))
    const stillPending = currentProducts.filter((p) => ['processed', 'error'].includes(p.status))
    if (!stillPending.length) setTab('logs')
  }

  const handleExportBlocked = () => {
    exportBlockedProductsToXlsx(blockedProducts)
    addToast('success', `Planilha com ${blockedProducts.length} produto(s) bloqueado(s) baixada.`)
  }

  const handleConfirmApplyAllowed = async () => {
    setShowBlockedBanner(false)
    if (pendingTargets.length > 0) await executeApply(pendingTargets)
    setPendingTargets([])
    setBlockedProducts([])
  }

  const handleCancelBlocked = () => {
    setShowBlockedBanner(false)
    setPendingTargets([])
    setBlockedProducts([])
  }

  // ── Teclado ────────────────────────────────────────────────────────────
  const reviewableIds = useMemo(() => reviewable.map((p) => p._key || p.id), [reviewable])

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable
      if (editing || e.metaKey || e.ctrlKey || e.altKey) return
      if (!reviewableIds.length) return

      const move = (delta) => {
        e.preventDefault()
        setFocusIdx((cur) => {
          const next = Math.max(0, Math.min(reviewableIds.length - 1, (cur < 0 ? -1 : cur) + delta))
          const id = reviewableIds[next]
          rowRefs.current[id]?.scrollIntoView({ block: 'nearest' })
          return next
        })
      }

      switch (e.key) {
        case 'j': case 'ArrowDown': move(1); break
        case 'k': case 'ArrowUp':   move(-1); break
        case 'Enter': {
          const id = reviewableIds[focusIdx]
          if (!id) return
          e.preventDefault()
          toggleExpand(id)
          break
        }
        case ' ': case 'x': {
          const id = reviewableIds[focusIdx]
          if (!id) return
          e.preventDefault()
          toggleSelectId(id)
          break
        }
        case 'a': {
          const p = reviewable[focusIdx]
          if (!p) return
          e.preventDefault()
          if (p.titleGenerationId) handleSingleFeedback(p.titleGenerationId, 'approved')
          if (p.descGenerationId) handleSingleFeedback(p.descGenerationId, 'approved')
          break
        }
        case 'Escape': setExpanded({}); setShowShortcuts(false); break
        case '?': setShowShortcuts((v) => !v); break
        default: break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewableIds, focusIdx, reviewable])

  // ── Vazio ──────────────────────────────────────────────────────────────
  if (reviewable.length === 0) {
    return (
      <EmptyState icon="review" title="Nenhum produto em revisão">
        Volte para{' '}
        <button type="button" onClick={() => setTab('products')} className="text-indigo-400 font-semibold hover:underline">
          Produtos
        </button>
        {' '}e gere os anúncios com IA.
      </EmptyState>
    )
  }

  const approvedInQueue = Object.values(feedbackState).filter((v) => v === 'approved').length
  const publishableSelected = reviewable.filter((p) => selected.includes(p.id) && p.status === 'processed').length

  return (
    <div className="space-y-3 animate-fadeIn">

      {/* ── Barra de ações (fixa) ──────────────────────────────────────── */}
      <div className="sticky-toolbar bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="t-page">Revisão</h2>
            <Badge tone="info">{reviewable.length} na fila</Badge>
            {attentionCount > 0 && (
              <Badge tone="warning" icon="alert" title="Produtos com alguma regra do cliente violada">
                {attentionCount} a revisar
              </Badge>
            )}
            {approvedInQueue > 0 && (
              <Badge tone="success" icon="check">{approvedInQueue} aprovado(s)</Badge>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" icon={expandedCount ? 'chevronRight' : 'chevronDown'}
              onClick={expandedCount ? collapseAll : expandAll}>
              {expandedCount ? 'Recolher tudo' : 'Expandir tudo'}
            </Button>
            <div className="h-5 w-px bg-slate-800" />
            <Button size="sm" variant={allTitulosOn ? 'outline' : 'ghost'} icon="tag" onClick={toggleAllTitulos}>
              Títulos
            </Button>
            <Button size="sm" variant={allDescOn ? 'outline' : 'ghost'} icon="fileText" onClick={toggleAllDescricoes}>
              Descrições
            </Button>
            <IconButton icon="help" label="Atalhos de teclado" onClick={() => setShowShortcuts((v) => !v)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button size="sm" variant="outline" icon={isAllSelected ? 'xCircle' : 'checkCircle'}
              onClick={isAllSelected ? deselectAll : selectAll}>
              {isAllSelected ? 'Desselecionar todos' : 'Selecionar todos'}
            </Button>
            <span className="t-meta">
              {selected.length > 0
                ? `${selected.length} selecionado(s)${publishableSelected !== selected.length ? ` · ${publishableSelected} publicável(is)` : ''}`
                : 'Nada selecionado'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button icon="download" onClick={() => { exportReviewToXlsx(reviewable); addToast('success', 'Planilha exportada.') }}
              disabled={!reviewable.length}>
              Planilha
            </Button>

            <Button icon="refresh" onClick={handleRedoSelected} disabled={isLoading || !selected.length} count={selected.length}>
              Gerar novamente
            </Button>

            {approvedInQueue > 0 && (
              <Button variant="success" icon="archive" onClick={handleClearApproved}
                title="Tira da fila os produtos que você já aprovou">
                Limpar aprovados
              </Button>
            )}

            {/* Entrada do fluxo em etapas: antes era o 4º botão secundário de uma
                fileira de seis, sendo o fluxo principal pretendido. */}
            <Button variant="outline" icon="compass" onClick={() => setPipelineOpen(true)}
              disabled={!selected.length} count={selected.length}>
              Processar em etapas
            </Button>

            <div className="h-6 w-px bg-slate-700 hidden sm:block" />

            <Button icon="check" onClick={handleApproveOnly} disabled={!selected.length} count={selected.length}>
              Só aprovar
            </Button>

            <Button variant="primary" size="lg" icon="send" onClick={handleApproveAndPublish}
              disabled={isLoading || !selected.length} count={selected.length}>
              Aprovar e publicar
            </Button>
          </div>
        </div>

        {/* A diferença entre os dois caminhos de aprovação estava só no atributo
            `title` — uma ação irreversível não pode depender de hover. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-2.5 -mt-1">
          <span className="t-meta flex items-center gap-1.5">
            <Icon name="send" size={11} className="text-indigo-400" />
            <strong className="font-semibold text-slate-300">Aprovar e publicar</strong> escreve na AnyMarket
          </span>
          <span className="t-meta flex items-center gap-1.5">
            <Icon name="check" size={11} className="text-slate-400" />
            <strong className="font-semibold text-slate-300">Só aprovar</strong> treina o CRIA e tira da fila, sem publicar
          </span>
        </div>

        {showShortcuts && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-t border-slate-800 bg-slate-950/50">
            {[
              ['J', 'K', 'navegar'],
              ['Enter', null, 'abrir/fechar'],
              ['Espaço', null, 'selecionar'],
              ['A', null, 'aprovar'],
              ['Esc', null, 'recolher tudo'],
            ].map(([k1, k2, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <Kbd>{k1}</Kbd>
                {k2 && <Kbd>{k2}</Kbd>}
                <span className="t-meta">{label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Progresso ──────────────────────────────────────────────────── */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <Panel className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <ProcessingBar
              current={ui.progress?.current ?? 0}
              total={ui.progress?.total ?? 0}
              label={ui.isProcessing ? 'Gerando com IA...' : 'Publicando na AnyMarket...'}
            />
          </div>
          {ui.isProcessing && (
            <Button variant="danger" icon="stop" onClick={handleCancelAI}>Interromper</Button>
          )}
        </Panel>
      )}

      {/* ── Fila ───────────────────────────────────────────────────────── */}
      <Panel>
        {paginatedReviewable.map((p, idx) => {
          const itemKey = p._key || p.id
          const globalIdx = (page - 1) * PAGE_SIZE + idx
          return (
            <div key={itemKey} ref={(el) => { rowRefs.current[itemKey] = el }}>
              <ReviewProductRow
                product={p}
                isSelected={selected.includes(itemKey)}
                isExpanded={Boolean(expanded[itemKey])}
                isFocused={focusIdx === globalIdx}
                fieldSel={getFieldSelFor(itemKey)}
                titleFeedback={p.titleGenerationId ? feedbackState[p.titleGenerationId] : null}
                descFeedback={p.descGenerationId ? feedbackState[p.descGenerationId] : null}
                descView={descView[itemKey] ?? 'preview'}
                categoryEnabled={categoryEnabled}
                isLoading={isLoading}
                onToggleSelect={() => { toggleSelectId(itemKey); setFocusIdx(globalIdx) }}
                onToggleExpand={() => { toggleExpand(itemKey); setFocusIdx(globalIdx) }}
                onToggleField={(field) => toggleFieldSel(itemKey, field)}
                onSetDescView={setDescViewFor}
                onEditTitle={(val) => handleEditTitle(itemKey, val)}
                onEditDescription={(val) => handleEditDescription(itemKey, val)}
                onFeedback={handleSingleFeedback}
                onRedo={handleRedoSingle}
                onCategory={setCategoryProduct}
              />
            </div>
          )
        })}

        {reviewable.length > PAGE_SIZE && (
          <div className="px-4 py-2.5 bg-slate-950/40 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap text-[12px]">
            <span className="text-slate-400">
              Mostrando <strong className="text-slate-200">{(page - 1) * PAGE_SIZE + 1}</strong>–<strong className="text-slate-200">{Math.min(page * PAGE_SIZE, reviewable.length)}</strong> de <strong className="text-slate-200">{reviewable.length}</strong> produtos
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" icon="chevronLeft" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Anterior
              </Button>
              <span className="font-medium text-slate-300 px-2">
                Página {page} de {totalPages}
              </span>
              <Button size="sm" variant="ghost" icon="chevronRight" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Produtos bloqueados ────────────────────────────────────────── */}
      {showBlockedBanner && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl animate-slideUp">
            <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-slate-800 bg-rose-500/10">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-rose-500/15 border border-rose-500/30 text-rose-300">
                  <Icon name="lock" size={17} />
                </span>
                <div>
                  <h3 className="t-card text-rose-200">Cálculo de preço incompatível</h3>
                  <p className="t-meta">{blockedProducts.length} produto(s) não podem ser alterados via API</p>
                </div>
              </div>
              <IconButton icon="x" label="Fechar" onClick={handleCancelBlocked} />
            </div>

            <div className="px-5 py-4 space-y-3">
              <p className="t-body">
                A API da AnyMarket não aceita alteração nesses produtos. Baixe a planilha, edite no painel
                e use <strong className="text-slate-100 font-semibold">Só aprovar</strong> para o CRIA aprender com eles.
              </p>

              <div className="rounded-xl border border-slate-800 overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-950">
                      <th className="px-3 py-2 t-label">ID</th>
                      <th className="px-3 py-2 t-label">Tipo</th>
                      <th className="px-3 py-2 t-label">Cálculo</th>
                      <th className="px-3 py-2 t-label">Título</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {blockedProducts.map((bp) => (
                      <tr key={bp.id}>
                        <td className="px-3 py-2 t-mono text-slate-400">{bp.id}</td>
                        <td className="px-3 py-2"><TypeBadge badge={typeBadgeOf(bp)} /></td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-rose-300">{bp.priceCalculation || '—'}</td>
                        <td className="px-3 py-2 text-[12px] text-slate-300 truncate max-w-[160px]">{bp.newTitle ?? bp.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3 flex-wrap">
              <Button variant="outline" icon="download" onClick={handleExportBlocked}>
                Baixar planilha ({blockedProducts.length})
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleCancelBlocked}>Cancelar</Button>
                {pendingTargets.length > 0 && (
                  <Button variant="primary" icon="send" onClick={handleConfirmApplyAllowed}>
                    Publicar {pendingTargets.length} liberado(s)
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {categoryProduct && (
        <CategoryModal product={categoryProduct} onClose={() => setCategoryProduct(null)} />
      )}

      {pipelineOpen && (
        <PipelineWizard
          clientId={activeClient?.id}
          products={reviewable.filter((p) => selected.includes(p.id))}
          onClose={() => setPipelineOpen(false)}
        />
      )}
    </div>
  )
}
