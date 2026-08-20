import useStore from '../store/useStore'
import Icon from './icons/Icon'
import { STATUS, TONE } from './ui/productTokens'

/**
 * Faixa compacta de progresso do lote.
 *
 * Substitui os cinco cards de contagem que ocupavam ~120px de altura para
 * mostrar, no caso dominante (um lote recém-carregado), "1 / 0 / 0 / 0 / 0" —
 * quatro quintos do espaço gastos com zeros. Agora só os status que existem de
 * fato aparecem, e a proporção do lote fica legível de relance.
 */
const ORDER = ['idle', 'processing', 'processed', 'applying', 'applied', 'undone', 'error']

export default function StatusDashboard() {
  const products = useStore((s) => s.products)

  if (products.length === 0) return null

  const counts = {}
  for (const p of products) counts[p.status] = (counts[p.status] ?? 0) + 1

  const present = ORDER.filter((k) => counts[k] > 0)
  const total = products.length

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 bg-slate-900 border border-slate-800 rounded-2xl shadow-lg animate-fadeIn">
      <div className="flex items-baseline gap-1.5 shrink-0">
        <span className="text-[19px] font-bold tabular-nums text-white leading-none">{total}</span>
        <span className="t-meta">produto{total > 1 ? 's' : ''} no lote</span>
      </div>

      {/* Barra proporcional */}
      <div className="flex-1 min-w-[160px] flex rounded-full overflow-hidden bg-slate-950 border border-slate-800">
        {present.map((k) => {
          const tone = TONE[STATUS[k].tone]
          return (
            <div
              key={k}
              className="status-strip-seg"
              style={{ width: `${(counts[k] / total) * 100}%`, background: tone.color, opacity: 0.85 }}
              title={`${counts[k]} ${STATUS[k].text.toLowerCase()}`}
            />
          )
        })}
      </div>

      {/* Legenda — só o que existe */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {present.map((k) => {
          const st = STATUS[k]
          const tone = TONE[st.tone]
          return (
            <span key={k} className="flex items-center gap-1.5" style={{ color: tone.color }}>
              <Icon name={st.icon} size={13} />
              <span className="text-[13px] font-semibold tabular-nums">{counts[k]}</span>
              <span className="t-meta">{st.text}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
