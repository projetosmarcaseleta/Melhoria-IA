import { createPortal } from 'react-dom'
import useStore from '../store/useStore'

export default function FloatingActionBar({ onProcess, onApply, onCancel, disabled }) {
  const selectedIds = useStore((s) => s.ui.selectedIds)
  const activeTab = useStore((s) => s.ui.activeTab)
  const isProcessing = useStore((s) => s.ui.isProcessing)
  const clearSelection = useStore((s) => s.clearSelection)
  const products = useStore((s) => s.products)

  // Só exibe a barra flutuante nas abas 'products' ou 'review' e quando houver seleção
  if (!['products', 'review'].includes(activeTab) || selectedIds.length === 0) {
    return null
  }

  const selectedProducts = products.filter((p) => selectedIds.includes(p.id))
  const processable = selectedProducts.filter((p) => p.status === 'idle').length
  const applyable = selectedProducts.filter((p) => p.status === 'processed').length

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-900/95 border border-indigo-500/40 shadow-2xl shadow-indigo-500/20 backdrop-blur-xl animate-slideUp">
      
      {/* Contagem de Seleção */}
      <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
        <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-indigo-600/30">
          {selectedIds.length}
        </div>
        <span className="text-xs font-bold text-slate-200">
          selecionado{selectedIds.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Ação: Cancelar IA */}
      {isProcessing && onCancel && (
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-xs font-extrabold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 transition-all flex items-center gap-1.5 animate-pulse"
        >
          <span>⏹️ Cancelar IA</span>
        </button>
      )}

      {/* Ação: Processar IA */}
      {!isProcessing && processable > 0 && onProcess && (
        <button
          onClick={onProcess}
          disabled={disabled}
          className="px-4 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
        >
          <span>✨ Criar com o CRIA</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
            {processable}
          </span>
        </button>
      )}

      {/* Ação principal: aprova E publica (mesmo handler do CTA da revisão) */}
      {applyable > 0 && onApply && (
        <button
          onClick={onApply}
          disabled={disabled}
          className="px-4 py-2 rounded-xl text-xs font-extrabold text-white shadow-md transition-all flex items-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, #336cff, #6337f1)' }}
        >
          <span>🚀 Aprovar e publicar</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
            {applyable}
          </span>
        </button>
      )}

      {/* Limpar Seleção (Fechar) */}
      <button
        onClick={clearSelection}
        className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 transition-all text-xs"
        title="Desmarcar tudo / Fechar barra"
      >
        ✕
      </button>
    </div>,
    document.body
  )
}
