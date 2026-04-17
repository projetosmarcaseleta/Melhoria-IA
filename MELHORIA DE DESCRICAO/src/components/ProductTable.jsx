import { useState } from 'react'
import useStore from '../store/useStore'
import FileUpload from './FileUpload'
import ProcessingBar from './ProcessingBar'
import { parseIdsFromExcel } from '../services/excelService'
import { fetchProductsFromWebhook } from '../services/webhookService'
import { processProductsWithAI } from '../services/aiService'
import { patchProduct, sleep } from '../services/anymarketService'
import { parallelProcess } from '../utils/batchUtils'
import { v4 as uuidv4 } from 'uuid'

const CONCURRENCY = 10

const STATUS_LABEL = {
  idle: { text: 'Aguardando', cls: 'bg-gray-100 text-gray-600' },
  processing: { text: 'Processando IA...', cls: 'bg-blue-100 text-blue-700 animate-pulse' },
  processed: { text: 'Processado', cls: 'bg-yellow-100 text-yellow-700' },
  applying: { text: 'Aplicando...', cls: 'bg-purple-100 text-purple-700 animate-pulse' },
  applied: { text: 'Aplicado', cls: 'bg-emerald-100 text-emerald-700' },
  undone: { text: 'Desfeito', cls: 'bg-gray-100 text-gray-500' },
  error: { text: 'Erro', cls: 'bg-red-100 text-red-700' },
}

export default function ProductTable() {
  const products = useStore((s) => s.products)
  const setProducts = useStore((s) => s.setProducts)
  const updateProductStatus = useStore((s) => s.updateProductStatus)
  const updateProductResult = useStore((s) => s.updateProductResult)
  const addLog = useStore((s) => s.addLog)
  const addToast = useStore((s) => s.addToast)
  const config = useStore((s) => s.config)
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const ui = useStore((s) => s.ui)
  const setProcessing = useStore((s) => s.setProcessing)
  const setFetchingWebhook = useStore((s) => s.setFetchingWebhook)
  const setApplying = useStore((s) => s.setApplying)
  const setProgress = useStore((s) => s.setProgress)
  const setTab = useStore((s) => s.setTab)
  const toggleSelectId = useStore((s) => s.toggleSelectId)
  const selectAllIds = useStore((s) => s.selectAllIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const clearProducts = useStore((s) => s.clearProducts)

  const [loadedIds, setLoadedIds] = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [inputMode, setInputMode] = useState('manual')  // 'file' | 'manual'
  const [manualText, setManualText] = useState('')

  // ── Upload Excel ────────────────────────────────────────────────────────
  const handleFileLoaded = async (file, err) => {
    if (err) { addToast('error', err); return }
    try {
      const ids = await parseIdsFromExcel(file)
      setLoadedIds(ids)
      addToast('success', `${ids.length} IDs carregados da planilha.`)
    } catch (e) {
      addToast('error', e.message)
    }
  }

  // ── IDs manuais ──────────────────────────────────────────────────────────
  const handleApplyManual = () => {
    const ids = manualText
      .split(/[\n,;|\s]+/)          // separa por quebra de linha, vírgula, ponto-e-vírgula, pipe ou espaço
      .map((s) => s.trim())
      .filter(Boolean)

    const unique = [...new Set(ids)]

    if (!unique.length) { addToast('warning', 'Nenhum ID válido encontrado.'); return }
    setLoadedIds(unique)
    addToast('success', `${unique.length} IDs adicionados.`)
  }

  // ── Consulta webhook n8n ────────────────────────────────────────────────
  const handleFetchWebhook = async () => {
    if (!loadedIds.length) { addToast('warning', 'Adicione IDs primeiro.'); return }
    if (!config.n8nWebhookUrl) { setConfigOpen(true); return }

    setFetchingWebhook(true)
    try {
      const fetched = await fetchProductsFromWebhook(config.n8nWebhookUrl, loadedIds)
      setProducts(fetched)
      clearSelection()
      addToast('success', `${fetched.length} produtos carregados do banco.`)
    } catch (e) {
      addToast('error', 'Erro no webhook: ' + e.message)
    } finally {
      setFetchingWebhook(false)
    }
  }

  // ── Processar com IA ────────────────────────────────────────────────────
  const handleProcessAI = async () => {
    const targets = products.filter((p) =>
      (ui.selectedIds.length ? ui.selectedIds.includes(p.id) : true) &&
      p.status === 'idle'
    )

    if (!targets.length) { addToast('info', 'Nenhum produto elegível (status Aguardando).'); return }

    targets.forEach((p) => updateProductStatus(p.id, 'processing'))
    setProcessing(true)
    setProgress(0, targets.length)

    await parallelProcess(
      targets,
      CONCURRENCY,
      async (p) => {
        try {
          const results = await processProductsWithAI([p])
          const r = results[0]
          if (r.error) updateProductStatus(r.id, 'error')
          else updateProductResult(r.id, r.newTitle, r.newDescription)
        } catch (e) {
          updateProductStatus(p.id, 'error')
          addToast('error', `Erro produto ${p.id}: ` + e.message)
        }
      },
      (done, total) => setProgress(done, total)
    )

    setProcessing(false)
    addToast('success', `IA concluída. ${targets.length} produtos processados.`)
    setTab('review')
  }

  // ── Aplicar no AnyMarket ────────────────────────────────────────────────
  const handleApply = async () => {
    const targets = products.filter((p) =>
      (ui.selectedIds.length ? ui.selectedIds.includes(p.id) : true) &&
      p.status === 'processed'
    )

    if (!targets.length) { addToast('info', 'Nenhum produto com status Processado para aplicar.'); return }
    if (!config.gumgaToken) { setConfigOpen(true); return }

    setApplying(true)
    setProgress(0, targets.length)

    let done = 0
    for (const p of targets) {
      updateProductStatus(p.id, 'applying')
      try {
        await patchProduct(p.id, p.newTitle, p.newDescription, config.gumgaToken, config.anymarketMode === 'webhook' ? config.anymarketWebhookUrl : '')
        updateProductStatus(p.id, 'applied')

        addLog({
          logId: uuidv4(),
          productId: p.id,
          productTitle: p.newTitle,
          timestamp: new Date().toISOString(),
          status: 'applied',
          changes: [
            { field: 'TITULO', before: p.title, after: p.newTitle },
            { field: 'DESCRIÇÃO', before: p.description, after: p.newDescription },
          ],
          originalData: { title: p.title, description: p.description },
        })
      } catch (e) {
        updateProductStatus(p.id, 'error')
        addToast('error', `Erro ao aplicar produto ${p.id}: ` + e.message)
      }

      done++
      setProgress(done, targets.length)
      await sleep(1500) // respeitando rate limit da AnyMarket
    }

    setApplying(false)
    addToast('success', `${done} produto(s) aplicados na AnyMarket.`)
    setTab('logs')
  }

  // ── Renderização ────────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    const matchSearch =
      !search ||
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      p.title.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const allSelected =
    filtered.length > 0 && filtered.every((p) => ui.selectedIds.includes(p.id))

  const toggleAll = () => {
    if (allSelected) clearSelection()
    else selectAllIds()
  }

  const isLoading = ui.isProcessing || ui.isFetchingWebhook || ui.isApplying

  return (
    <div className="space-y-4">
      {/* Entrada de IDs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Cabeçalho com abas */}
        <div className="flex items-center border-b border-gray-200 px-4 pt-3 gap-1">
          <span className="text-sm font-semibold text-gray-700 mr-3">1. Informe os IDs</span>
          <button
            onClick={() => setInputMode('manual')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors ${
              inputMode === 'manual'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            ✏️ Inserir manualmente
          </button>
          <button
            onClick={() => setInputMode('file')}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors ${
              inputMode === 'file'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📂 Planilha Excel
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Aba Planilha */}
          {inputMode === 'file' && (
            <FileUpload onIdsLoaded={handleFileLoaded} disabled={isLoading} />
          )}

          {/* Aba Manual */}
          {inputMode === 'manual' && (
            <div className="space-y-2">
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                disabled={isLoading}
                placeholder={'Cole ou digite os IDs aqui, um por linha:\n12345\n67890\n11111\n\nTambém aceita vírgula, ponto-e-vírgula ou espaço como separador.'}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={handleApplyManual}
                disabled={!manualText.trim() || isLoading}
                className="w-full bg-gray-100 text-gray-700 text-sm px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Confirmar IDs
              </button>
            </div>
          )}

          {/* Contador + botão de limpar */}
          {loadedIds.length > 0 && (
            <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-md px-3 py-2">
              <span>✅ <strong>{loadedIds.length}</strong> IDs prontos para consulta</span>
              <button
                onClick={() => { setLoadedIds([]); setManualText('') }}
                className="text-red-400 hover:text-red-600"
                title="Limpar IDs"
              >
                × limpar
              </button>
            </div>
          )}

          <button
            onClick={handleFetchWebhook}
            disabled={!loadedIds.length || isLoading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {ui.isFetchingWebhook ? (
              <>⏳ Consultando banco...</>
            ) : (
              <>🔗 2. Consultar banco de dados (n8n)</>
            )}
          </button>
        </div>
      </div>

      {/* Progress */}
      {isLoading && (ui.progress?.total ?? 0) > 0 && (
        <ProcessingBar
          current={ui.progress?.current ?? 0}
          total={ui.progress?.total ?? 0}
          label={
            ui.isProcessing ? 'Processando com IA...' :
            ui.isApplying ? 'Aplicando na AnyMarket...' : 'Carregando...'
          }
        />
      )}

      {/* Tabela */}
      {products.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
            <input
              type="text"
              placeholder="Buscar por ID ou título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none"
            >
              <option value="all">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v.text}</option>
              ))}
            </select>

            <div className="ml-auto flex gap-2">
              <button
                onClick={handleProcessAI}
                disabled={isLoading}
                className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                🤖 3. Processar com IA
              </button>
              <button
                onClick={() => setTab('review')}
                disabled={isLoading}
                className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                👁️ 4. Revisar e Aplicar
              </button>
              <button
                onClick={clearProducts}
                disabled={isLoading}
                className="text-red-500 text-sm px-2 py-1.5 rounded-md hover:bg-red-50 disabled:opacity-50"
                title="Limpar lista"
              >
                🗑️
              </button>
            </div>
          </div>

          {/* Progress bar inline */}
          {isLoading && (
            <div className="px-4 py-2 border-b border-gray-100">
              <ProcessingBar
                current={ui.progress?.current ?? 0}
                total={ui.progress?.total ?? 0}
                label={
                  ui.isProcessing ? 'Processando com IA...' :
                  ui.isApplying ? 'Aplicando na AnyMarket...' : 'Carregando...'
                }
              />
            </div>
          )}

          {/* Header da tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Título atual</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Título novo</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400 text-sm">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const sl = STATUS_LABEL[p.status] ?? STATUS_LABEL.idle
                    return (
                      <tr
                        key={p.id}
                        className={`hover:bg-gray-50 transition-colors ${
                          ui.selectedIds.includes(p.id) ? 'bg-blue-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={ui.selectedIds.includes(p.id)}
                            onChange={() => toggleSelectId(p.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {p.id}
                        </td>
                        <td className="px-3 py-2 text-gray-700 max-w-xs truncate" title={p.title}>
                          {p.title || <span className="text-gray-400 italic">—</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700 max-w-xs truncate" title={p.newTitle}>
                          {p.newTitle ? (
                            <span className="text-emerald-700 font-medium">{p.newTitle}</span>
                          ) : (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${sl.cls}`}>
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

          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 flex justify-between">
            <span>{filtered.length} de {products.length} produto(s)</span>
            {ui.selectedIds.length > 0 && (
              <span>{ui.selectedIds.length} selecionado(s)</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
