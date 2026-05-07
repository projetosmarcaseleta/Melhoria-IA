import useStore from '../store/useStore'

const STATS = [
  { key: 'idle',       label: 'Aguardando',    icon: '⏳', color: 'var(--text-muted)',           glow: 'rgba(255,255,255,0.04)' },
  { key: 'processing', label: 'Processando',   icon: '🤖', color: 'var(--accent-indigo-light)',  glow: 'var(--accent-indigo-glow)' },
  { key: 'processed',  label: 'Processados',   icon: '✨', color: 'var(--accent-amber)',         glow: 'var(--accent-amber-glow)' },
  { key: 'applied',    label: 'Aplicados',      icon: '✅', color: 'var(--accent-emerald)',       glow: 'var(--accent-emerald-glow)' },
  { key: 'error',      label: 'Com erro',       icon: '❌', color: 'var(--accent-rose)',          glow: 'var(--accent-rose-glow)' },
]

export default function StatusDashboard() {
  const products = useStore((s) => s.products)

  if (products.length === 0) return null

  const counts = {}
  for (const s of STATS) counts[s.key] = 0
  for (const p of products) counts[p.status] = (counts[p.status] ?? 0) + 1

  return (
    <div className="grid grid-cols-5 gap-3 animate-fadeIn">
      {STATS.map((s) => (
        <div
          key={s.key}
          className="rounded-xl px-4 py-3 text-center transition-all"
          style={{
            background: counts[s.key] > 0 ? s.glow : 'var(--bg-card)',
            border: `1px solid ${counts[s.key] > 0 ? `${s.color}22` : 'var(--border-subtle)'}`,
          }}
        >
          <p className="text-xl mb-1">{s.icon}</p>
          <p className="text-2xl font-bold tabular-nums" style={{ color: counts[s.key] > 0 ? s.color : 'var(--text-muted)' }}>
            {counts[s.key]}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  )
}
