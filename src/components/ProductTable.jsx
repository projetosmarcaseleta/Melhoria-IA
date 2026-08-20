import { useState } from 'react'
import useStore from '../store/useStore'
import FileUpload from './FileUpload'
import ProcessingBar from './ProcessingBar'
import StatusDashboard from './StatusDashboard'
import FloatingActionBar from './FloatingActionBar'
import Icon from './icons/Icon'
import { Button, IconButton, Panel, PanelHeader, Badge, TypeBadge, EmptyState } from './ui/primitives'
import {
  STATUS, typeBadgeOf, statusOf, canPatchProduct, blockReason,
} from './ui/productTokens'
import { parseIdsFromExcel } from '../services/excelService'
import { fetchProductsFromWebhook } from '../services/webhookService'
import { processProductsWithAI } from '../services/aiService'
import { parallelProcess } from '../utils/batchUtils'
import { playCompletionSound, showBrowserNotification } from '../utils/notificationUtils'

const CONCURRENCY = 10

// Reexportado porque a regra vivia neste arquivo e outros módulos importavam
// daqui; a implementação agora é única, em ui/productTokens.js.
export { canPatchProduct }

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
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const clearProducts = useStore((s) => s.clearProducts)

  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [inputMode, setInputMode] = useState('manual')
  const [manualText, setManualText] = useState('')
  const [fileRef, setFileRef] = useState(null)
  const [loaderOpen, setLoaderOpen] = useState(false)
  const cancelProcessRef = useState({ current: false })[0]

  // ── Cancelar geração ────────────────────────────────────────────────────
  const handleCancelAI = () => {
    cancelProcessRef.current = true
    setProcessing(false)
    useStore.getState().products.forEach((p) => {
      if (p.status === 'processing') updateProductStatus(p.id, 'idle')
    })
    addToast('info', 'Geração interrompida.')
  }

  // ── Upload de planilha ──────────────────────────────────────────────────
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

  // ── Buscar produtos ─────────────────────────────────────────────────────
  const handleFetchWebhook = async () => {
    let ids = fileRef ?? []
    if (inputMode === 'manual') {
      ids = [...new Set(manualText.split(/[\n,;|\s]+/).map((s) => s.trim()).filter(Boolean))]
    }

    if (!ids.length) { addToast('warning', 'Informe pelo menos um ID de produto.'); return }

    setFetchingWebhook(true)
    try {
      const fetched = await fetchProductsFromWebhook(ids)
      setProducts(fetched)
      clearSelection()
      setLoaderOpen(false)
      addToast('success', `${fetched.length} produto(s) carregado(s).`)
    } catch (e) {
      addToast('error', 'Não consegui buscar esses produtos: ' + e.message)
    } finally {
      setFetchingWebhook(false)
    }
  }

  // ── Gerar com IA ────────────────────────────────────────────────────────
  const handleProcessAI = async () => {
    const fields = []
    if (config.applyTitles) fields.push('title')
    if (config.applyDescriptions) fields.push('description')

    if (fields.length === 0) {
      addToast('warning', 'Escolha ao menos um campo (título ou descrição) para gerar.')
      return
    }

    const targets = products.filter((p) =>
      (ui.selectedIds.length ? ui.selectedIds.includes(p.id) : true) && p.status === 'idle'
    )
    if (!targets.length) { addToast('info', 'Nenhum produto pronto para gerar no momento.'); return }

    cancelProcessRef.current = false
    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)

    // Quantos anúncios saíram com alguma violação de regra do cliente
    let needAttention = 0

    await parallelProcess(
      targets,
      CONCURRENCY,
      async (p) => {
        if (cancelProcessRef.current) { updateProductStatus(p.id, 'idle'); return }
        try {
          const results = await processProductsWithAI([p], fields)
          if (cancelProcessRef.current) { updateProductStatus(p.id, 'idle'); return }
          const r = results[0]
          if (r.error) {
            updateProductStatus(r.id, 'error')
          } else {
            updateProductResult(
              r.id,
              fields.includes('title') ? (r.newTitle ?? p.newTitle ?? '') : (p.newTitle ?? ''),
              fields.includes('description') ? (r.newDescription ?? p.newDescription ?? '') : (p.newDescription ?? ''),
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
          }
        } catch (e) {
          if (!cancelProcessRef.current) {
            updateProductStatus(p.id, 'error')
            addToast('error', `Erro produto ${p.id}: ` + e.message)
          }
        }
      },
      (done, total) => { if (!cancelProcessRef.current) setProgress(done, total) },
      () => cancelProcessRef.current
    )

    if (cancelProcessRef.current) { setProcessing(false); return }

    setProcessing(false)

    addToast(
      needAttention > 0 ? 'warning' : 'success',
      needAttention > 0
        ? `Pronto! ${targets.length} anúncio(s) gerado(s) — ${needAttention} precisa(m) da sua atenção.`
        : `Pronto! ${targets.length} anúncio(s) gerado(s).`
    )

    if (config.soundNotification) {
      playCompletionSound()
      showBrowserNotification(
        'Pronto! Seus anúncios estão gerados.',
        needAttention > 0
          ? `${targets.length} anúncio(s) gerado(s). ${needAttention} precisa(m) de revisão.`
          : `${targets.length} anúncio(s) prontos para revisão.`
      )
    }
    setTab('review')
  }

  // ── Derivados ───────────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    const q = search.toLowerCase()
    const matchSearch = !search || p.id.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  const allSelected = filtered.length > 0 && filtered.every((p) => ui.selectedIds.includes(p.id))
  const toggleAll = () => (allSelected ? clearSelection() : setSelectedIds(filtered.map((p) => p.id)))
  const isLoading = ui.isProcessing || ui.isFetchingWebhook || ui.isApplying
  const showLoader = loaderOpen || products.length === 0
  const pendingCount = products.filter((p) => p.status === 'idle').length
  const readyCount = products.filter((p) => p.status === 'processed').length
  const idsInformados = inputMode === 'manual'
    ? new Set(manualText.split(/[\n,;|\s]+/).map((s) => s.trim()).filter(Boolean)).size
    : (fileRef?.length ?? 0)

  return (
    <div className="space-y-4">
      {products.length > 0 && <StatusDashboard />}

      {/* ── Carregar produtos ─────────────────────────────────────────────
          A numeração "1./2./3./4." foi removida: os quatro passos viviam em
          três lugares com pesos visuais diferentes (o passo 3, a ação mais
          importante, era menor que o passo 2), prometendo uma linearidade que
          o layout não entregava. Agora este cartão recolhe depois da busca e
          devolve o topo da tela para o trabalho de verdade. */}
      {showLoader ? (
        <Panel>
          <PanelHeader
            icon="database"
            title="Carregar produtos"
            hint="Informe os IDs da AnyMarket que você quer trabalhar"
          >
            <div className="flex items-center gap-1 bg-slate-900 p-1 border border-slate-800 rounded-xl">
              {[
                { key: 'manual', icon: 'pencil', label: 'Digitar IDs' },
                { key: 'file', icon: 'upload', label: 'Planilha' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setInputMode(tab.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                    inputMode === tab.key
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  <Icon name={tab.icon} size={13} />
                  {tab.label}
                </button>
              ))}
            </div>
            {products.length > 0 && (
              <IconButton icon="x" label="Fechar" variant="ghost" onClick={() => setLoaderOpen(false)} />
            )}
          </PanelHeader>

          <div className="p-4 space-y-3">
            {inputMode === 'file' && <FileUpload onIdsLoaded={handleFileLoaded} disabled={isLoading} />}
            {inputMode === 'manual' && (
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                disabled={isLoading}
                placeholder={'Um ID por linha:\n18057008\n18060671\n\nTambém aceita vírgula, ponto-e-vírgula ou espaço.'}
                rows={4}
                className="w-full p-3 bg-slate-950 border border-slate-700/80 rounded-xl text-[13px] text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500 transition-all resize-y"
              />
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="t-meta">
                {idsInformados > 0 ? `${idsInformados} ID(s) informado(s)` : 'Nenhum ID informado ainda'}
              </p>
              <Button
                variant="primary"
                size="lg"
                icon={ui.isFetchingWebhook ? undefined : 'search'}
                onClick={handleFetchWebhook}
                disabled={isLoading || idsInformados === 0}
              >
                {ui.isFetchingWebhook ? (
                  <span className="flex items-center gap-2"><span className="login-spinner" />Buscando produtos...</span>
                ) : 'Buscar produtos'}
              </Button>
            </div>
          </div>
        </Panel>
      ) : (
        <button
          type="button"
          onClick={() => setLoaderOpen(true)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-slate-900/60 border border-slate-800 border-dashed rounded-xl text-left hover:border-indigo-500/40 hover:bg-slate-900 transition-all group"
        >
          <Icon name="plus" size={15} className="text-indigo-400" />
          <span className="t-body group-hover:text-white transition-colors">Carregar outros IDs</span>
          <Icon name="chevronDown" size={14} className="ml-auto text-slate-500" />
        </button>
      )}

      {/* ── Progresso ─────────────────────────────────────────────────── */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <Panel className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <ProcessingBar
              current={ui.progress?.current ?? 0}
              total={ui.progress?.total ?? 0}
              label={ui.isProcessing ? 'Gerando com IA...' : ui.isApplying ? 'Publicando na AnyMarket...' : 'Carregando...'}
            />
          </div>
          {ui.isProcessing && (
            <Button variant="danger" icon="stop" onClick={handleCancelAI}>Interromper</Button>
          )}
        </Panel>
      )}

      {/* ── Lista de produtos ─────────────────────────────────────────── */}
      {products.length > 0 && (
        <Panel>
          {/* Filtros: o que você está vendo */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-950/40 border-b border-slate-800">
            <div className="relative flex-1 min-w-[180px]">
              <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por ID ou título"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">Todos os status</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.text}</option>
              ))}
            </select>
            <span className="t-meta ml-auto">
              {filtered.length === products.length
                ? `${products.length} produto(s)`
                : `${filtered.length} de ${products.length}`}
            </span>
          </div>

          {/* Ações: o que vai acontecer. Os campos a gerar saíram da fileira de
              filtros — eram uma configuração da ação disfarçada de filtro. */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="t-label">Gerar</span>
              <div className="flex items-center gap-1 p-1 bg-slate-950/70 border border-slate-800 rounded-xl">
                {[
                  { key: 'applyTitles', label: 'Título', icon: 'tag', on: config.applyTitles, accent: 'indigo' },
                  { key: 'applyDescriptions', label: 'Descrição', icon: 'fileText', on: config.applyDescriptions, accent: 'emerald' },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setConfig({ [f.key]: !f.on })}
                    aria-pressed={f.on}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border transition-all ${
                      f.on
                        ? f.accent === 'indigo'
                          ? 'bg-indigo-600/20 border-indigo-500/70 text-indigo-200'
                          : 'bg-emerald-600/20 border-emerald-500/70 text-emerald-200'
                        : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Icon name={f.on ? 'check' : f.icon} size={12} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Antes era um botão "4. Revisar" com o mesmo peso do primário,
                  duplicando a aba "Revisão" do menu. Virou caminho discreto e
                  só aparece quando existe algo pronto para revisar. */}
              {readyCount > 0 && (
                <Button variant="ghost" icon="review" iconRight="arrowRight" onClick={() => setTab('review')}>
                  Revisar {readyCount} pronto(s)
                </Button>
              )}

              {ui.isProcessing ? (
                <Button variant="danger" icon="stop" onClick={handleCancelAI}>Interromper geração</Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  icon="sparkles"
                  onClick={handleProcessAI}
                  disabled={isLoading || pendingCount === 0}
                  count={ui.selectedIds.length || undefined}
                  title={ui.selectedIds.length ? 'Gera para os produtos selecionados' : 'Gera para todos os produtos aguardando'}
                >
                  Gerar com IA
                </Button>
              )}

              <IconButton
                icon="trash"
                label="Limpar a lista de produtos"
                variant="danger"
                size={34}
                disabled={isLoading}
                onClick={clearProducts}
              />
            </div>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70">
                  <th className="py-2.5 pl-4 pr-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Selecionar todos os produtos visíveis"
                      className="w-4 h-4 rounded border-slate-700 bg-slate-950 accent-indigo-600 cursor-pointer align-middle"
                    />
                  </th>
                  <th className="py-2.5 px-3 t-label">ID</th>
                  <th className="py-2.5 px-3 t-label">Título atual</th>
                  <th className="py-2.5 px-3 t-label">Título gerado</th>
                  <th className="py-2.5 px-3 t-label">Tipo</th>
                  <th className="py-2.5 px-3 t-label">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center t-body">
                      Nenhum produto corresponde aos filtros.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const st = statusOf(p)
                    const motivo = blockReason(p)
                    const isRowSelected = ui.selectedIds.includes(p.id)

                    return (
                      <tr
                        key={p.id + '-' + p.idSku}
                        className={`transition-colors ${isRowSelected ? 'bg-indigo-500/[0.08]' : 'hover:bg-slate-950/40'}`}
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={() => toggleSelectId(p.id)}
                            aria-label={`Selecionar produto ${p.id}`}
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 accent-indigo-600 cursor-pointer align-middle"
                          />
                        </td>
                        <td className="py-2.5 px-3 t-mono text-slate-400 whitespace-nowrap">{p.id}</td>
                        <td className="py-2.5 px-3 max-w-[280px]">
                          <span className="block truncate text-[13px] text-slate-200" title={p.title}>
                            {p.title || <span className="t-meta italic">—</span>}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-[280px]">
                          {p.newTitle ? (
                            <span className="block truncate text-[13px] font-medium text-emerald-300" title={p.newTitle}>
                              {p.newTitle}
                            </span>
                          ) : (
                            <span className="t-meta italic">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <TypeBadge badge={typeBadgeOf(p)} />
                            {motivo && <Badge tone="danger" icon="lock" title={motivo}>Bloqueado</Badge>}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <Badge tone={st.tone} icon={st.icon}>{st.text}</Badge>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {ui.selectedIds.length > 0 && (
            <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13px] font-medium text-indigo-300">
                {ui.selectedIds.length} selecionado(s) — a geração vai agir só neles
              </span>
              <Button size="sm" variant="ghost" icon="x" onClick={clearSelection}>Limpar seleção</Button>
            </div>
          )}
        </Panel>
      )}

      {products.length === 0 && !ui.isFetchingWebhook && (
        <EmptyState icon="box" title="Nenhum produto carregado">
          Informe os IDs da AnyMarket acima e busque os produtos para começar.
        </EmptyState>
      )}

      <FloatingActionBar onProcess={handleProcessAI} onCancel={handleCancelAI} disabled={isLoading} />
    </div>
  )
}
