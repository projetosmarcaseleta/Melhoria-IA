import useStore from '../store/useStore'

export default function FloatingActionBar({ onProcess, onApply, disabled }) {
  const selectedIds = useStore((s) => s.ui.selectedIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const products = useStore((s) => s.products)

  if (selectedIds.length === 0) return null

  const selectedProducts = products.filter((p) => selectedIds.includes(p.id))
  const processable = selectedProducts.filter((p) => p.status === 'idle').length
  const applyable = selectedProducts.filter((p) => p.status === 'processed').length

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl animate-slideUp"
      style={{
        background: 'rgba(28,28,40,0.92)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,102,241,0.25)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.15)',
      }}
    >
      <div className="flex items-center gap-2 pr-3" style={{ borderRight: '1px solid var(--border-default)' }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ background: 'var(--accent-indigo)' }}>
          {selectedIds.length}
        </div>
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          selecionado{selectedIds.length > 1 ? 's' : ''}
        </span>
      </div>

      {processable > 0 && (
        <button
          onClick={onProcess}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-all disabled:opacity-40"
          style={{ background: 'var(--accent-indigo)', color: 'white' }}
        >
          🤖 Processar IA
          <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(255,255,255,0.2)' }}>{processable}</span>
        </button>
      )}

      {applyable > 0 && (
        <button
          onClick={onApply}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #059669, #047857)', color: 'white' }}
        >
          🚀 Aplicar
          <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(255,255,255,0.2)' }}>{applyable}</span>
        </button>
      )}

      <button
        onClick={clearSelection}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}
        title="Limpar seleção"
      >
        ✕
      </button>
    </div>
  )
}
