import useStore from '../store/useStore'

const STATS = [
  { key: 'idle',       label: 'Aguardando',    icon: '⏳', color: '#cbd5e1', bg: 'bg-slate-900', border: 'border-slate-800' },
  { key: 'processing', label: 'Processando',   icon: '🤖', color: '#818cf8', bg: 'bg-indigo-950/30', border: 'border-indigo-500/30' },
  { key: 'processed',  label: 'Processados',   icon: '✨', color: '#fbbf24', bg: 'bg-amber-950/30', border: 'border-amber-500/30' },
  { key: 'applied',    label: 'Aplicados',      icon: '✅', color: '#34d399', bg: 'bg-emerald-950/30', border: 'border-emerald-500/30' },
  { key: 'error',      label: 'Com erro',       icon: '❌', color: '#f87171', bg: 'bg-rose-950/30', border: 'border-rose-500/30' },
]

export default function StatusDashboard() {
  const products = useStore((s) => s.products)

  if (products.length === 0) return null

  const counts = {}
  for (const s of STATS) counts[s.key] = 0
  for (const p of products) counts[p.status] = (counts[p.status] ?? 0) + 1

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-fadeIn">
      {STATS.map((s) => {
        const count = counts[s.key]

        return (
          <div
            key={s.key}
            className={`rounded-2xl p-4 text-center transition-all border shadow-md ${
              count > 0 ? `${s.bg} ${s.border}` : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="text-xl mb-1">{s.icon}</div>
            <div
              className="text-2xl font-extrabold tabular-nums tracking-tight"
              style={{ color: count > 0 ? s.color : '#94a3b8' }}
            >
              {count}
            </div>
            <div className="text-[10px] font-extrabold uppercase tracking-wider mt-1 text-slate-400">
              {s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}
