import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import useStore from '../store/useStore'
import { patchProduct } from '../services/anymarketService'

export default function LogEntry({ log }) {
  const config = useStore((s) => s.config)
  const setLogStatus = useStore((s) => s.setLogStatus)
  const addToast = useStore((s) => s.addToast)
  const updateProductStatus = useStore((s) => s.updateProductStatus)

  const titulo = log.changes.find((c) => c.field === 'TITULO')
  const descricao = log.changes.find((c) => c.field === 'DESCRIÇÃO')

  const handleUndo = async () => {
    if (!config.gumgaToken) {
      addToast('error', 'Configure o token AnyMarket para desfazer.')
      return
    }

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
      addToast('success', `Produto ${log.productId} revertido com sucesso.`)
    } catch (e) {
      addToast('error', `Erro ao desfazer ${log.productId}: ` + e.message)
    }
  }

  const statusBadge = {
    applied: 'bg-emerald-100 text-emerald-700',
    undone: 'bg-gray-100 text-gray-500',
    error: 'bg-red-100 text-red-700',
  }[log.status] ?? 'bg-gray-100 text-gray-500'

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header do card */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-500">ID: {log.productId}</span>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}>
            {log.status === 'applied' ? 'Aplicado' : log.status === 'undone' ? 'Desfeito' : 'Erro'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {new Date(log.timestamp).toLocaleString('pt-BR')}
          </span>
          {log.status === 'applied' && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-md hover:bg-orange-200 transition-colors font-medium"
            >
              ↩️ Desfazer
            </button>
          )}
        </div>
      </div>

      {/* Diff do título */}
      {titulo && (
        <div className="border-b border-gray-100">
          <div className="px-4 pt-3 pb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Título</span>
          </div>
          <div className="overflow-x-auto text-xs">
            <ReactDiffViewer
              oldValue={titulo.before}
              newValue={titulo.after}
              splitView
              compareMethod={DiffMethod.WORDS}
              leftTitle="Antes"
              rightTitle="Depois"
              styles={{
                variables: { light: { fontSize: '12px' } },
                line: { padding: '2px 10px', fontSize: '12px' },
                titleBlock: { padding: '4px 10px', fontSize: '11px', background: '#f9fafb' },
              }}
            />
          </div>
        </div>
      )}

      {/* Diff da descrição */}
      {descricao && (
        <div>
          <div className="px-4 pt-3 pb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrição (HTML)</span>
          </div>
          <div className="overflow-x-auto text-xs">
            <ReactDiffViewer
              oldValue={descricao.before}
              newValue={descricao.after}
              splitView
              compareMethod={DiffMethod.WORDS}
              leftTitle="Antes"
              rightTitle="Depois"
              styles={{
                variables: { light: { fontSize: '12px' } },
                line: { padding: '2px 10px', fontSize: '12px' },
                titleBlock: { padding: '4px 10px', fontSize: '11px', background: '#f9fafb' },
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
