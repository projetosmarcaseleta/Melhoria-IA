import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import useStore from '../store/useStore'
import { patchProduct } from '../services/anymarketService'

const DIFF_STYLES = {
  variables: {
    dark: {
      diffViewerBackground: '#1c1c28',
      addedBackground: 'rgba(52,211,153,0.08)',
      removedBackground: 'rgba(251,113,133,0.08)',
      wordAddedBackground: 'rgba(52,211,153,0.2)',
      wordRemovedBackground: 'rgba(251,113,133,0.2)',
      addedGutterBackground: 'rgba(52,211,153,0.05)',
      removedGutterBackground: 'rgba(251,113,133,0.05)',
      gutterBackground: '#16161e',
      gutterBackgroundDark: '#16161e',
      addedGutterColor: '#34d399',
      removedGutterColor: '#fb7185',
      gutterColor: '#4a4a5e',
      addedColor: '#e0f2e9',
      removedColor: '#fde2e4',
      fontSize: '12px',
      codeFoldGutterBackground: '#1c1c28',
      codeFoldBackground: '#1c1c28',
      emptyLineBackground: '#1c1c28',
      codeFoldContentColor: '#6b6b80',
    },
  },
  line: { padding: '2px 10px', fontSize: '12px' },
  titleBlock: { padding: '4px 10px', fontSize: '11px', background: '#16161e', color: '#9a9ab0' },
  contentText: { color: '#f0f0f5' },
}

export default function LogEntry({ log }) {
  const config = useStore((s) => s.config)
  const setLogStatus = useStore((s) => s.setLogStatus)
  const addToast = useStore((s) => s.addToast)
  const updateProductStatus = useStore((s) => s.updateProductStatus)

  const titulo = log.changes.find((c) => c.field === 'TITULO')
  const descricao = log.changes.find((c) => c.field === 'DESCRIÇÃO')

  const handleUndo = async () => {
    if (!config.gumgaToken) { addToast('error', 'Configure o token AnyMarket para desfazer.'); return }
    try {
      await patchProduct(log.productId, log.originalData.title, log.originalData.description, config.gumgaToken)
      setLogStatus(log.logId, 'undone')
      updateProductStatus(log.productId, 'undone')
      addToast('success', `Produto ${log.productId} revertido com sucesso.`)
    } catch (e) {
      addToast('error', `Erro ao desfazer ${log.productId}: ` + e.message)
    }
  }

  const statusStyles = {
    applied: { background: 'var(--accent-emerald-glow)', color: 'var(--accent-emerald)' },
    undone:  { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' },
    error:   { background: 'var(--accent-rose-glow)', color: 'var(--accent-rose)' },
  }
  const statusLabels = { applied: 'Aplicado', undone: 'Desfeito', error: 'Erro' }
  const st = statusStyles[log.status] ?? statusStyles.undone

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>ID: {log.productId}</span>
          <span className="badge" style={st}>{statusLabels[log.status] ?? 'Desconhecido'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleString('pt-BR')}</span>
          {log.status === 'applied' && (
            <button onClick={handleUndo}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
              style={{ background: 'var(--accent-amber-glow)', color: 'var(--accent-amber)', border: '1px solid rgba(251,191,36,0.2)' }}>
              ↩️ Desfazer
            </button>
          )}
        </div>
      </div>

      {titulo && (
        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="px-4 pt-3 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Título</span>
          </div>
          <div className="overflow-x-auto text-xs">
            <ReactDiffViewer oldValue={titulo.before} newValue={titulo.after} splitView compareMethod={DiffMethod.WORDS}
              leftTitle="Antes" rightTitle="Depois" useDarkTheme styles={DIFF_STYLES} />
          </div>
        </div>
      )}

      {descricao && (
        <div>
          <div className="px-4 pt-3 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Descrição (HTML)</span>
          </div>
          <div className="overflow-x-auto text-xs">
            <ReactDiffViewer oldValue={descricao.before} newValue={descricao.after} splitView compareMethod={DiffMethod.WORDS}
              leftTitle="Antes" rightTitle="Depois" useDarkTheme styles={DIFF_STYLES} />
          </div>
        </div>
      )}
    </div>
  )
}
