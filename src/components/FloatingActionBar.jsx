import { createPortal } from 'react-dom'
import useStore from '../store/useStore'
import Icon from './icons/Icon'
import { Button, IconButton } from './ui/primitives'

/**
 * Barra flutuante de ação em lote — só na aba de Produtos.
 *
 * Duas correções em relação à versão anterior:
 *  - o rótulo era "Criar com o CRIA" enquanto o mesmo handler aparecia como
 *    "3. Processar com IA" na tabela: três nomes para a mesma ação;
 *  - ela também aparecia na aba de Revisão, duplicando a barra de ações de lá
 *    (que agora é fixa no topo). Uma tela, uma superfície de ação.
 */
export default function FloatingActionBar({ onProcess, onCancel, disabled }) {
  const selectedIds = useStore((s) => s.ui.selectedIds)
  const activeTab = useStore((s) => s.ui.activeTab)
  const isProcessing = useStore((s) => s.ui.isProcessing)
  const clearSelection = useStore((s) => s.clearSelection)
  const products = useStore((s) => s.products)

  if (activeTab !== 'products' || selectedIds.length === 0) return null

  const selectedProducts = products.filter((p) => selectedIds.includes(p.id))
  const processable = selectedProducts.filter((p) => p.status === 'idle').length

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-indigo-500/40 shadow-2xl shadow-indigo-500/20 backdrop-blur-xl animate-slideUp">
      <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
        <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-bold text-[12px] flex items-center justify-center tabular-nums">
          {selectedIds.length}
        </span>
        <span className="text-[13px] font-medium text-slate-200">
          selecionado{selectedIds.length > 1 ? 's' : ''}
        </span>
      </div>

      {isProcessing && onCancel ? (
        <Button variant="danger" icon="stop" onClick={onCancel}>Interromper geração</Button>
      ) : (
        processable > 0 && onProcess && (
          <Button variant="primary" icon="sparkles" onClick={onProcess} disabled={disabled} count={processable}>
            Gerar com IA
          </Button>
        )
      )}

      {!isProcessing && processable === 0 && (
        <span className="t-meta flex items-center gap-1.5">
          <Icon name="info" size={12} />
          Nada a gerar na seleção
        </span>
      )}

      <IconButton icon="x" label="Limpar seleção" onClick={clearSelection} />
    </div>,
    document.body
  )
}
