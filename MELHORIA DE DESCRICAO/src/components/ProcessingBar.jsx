import useStore from '../store/useStore'

function formatEta(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return ''
  if (seconds < 60) return `~${Math.ceil(seconds)}s restantes`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return `~${m}min ${s}s restantes`
}

export default function ProcessingBar({ current, total, label }) {
  const startTime = useStore((s) => s.ui.progress.startTime)

  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  // Calcular ETA
  let eta = ''
  if (startTime && current > 0 && current < total) {
    const elapsed = (Date.now() - startTime) / 1000
    const avgPerItem = elapsed / current
    const remaining = (total - current) * avgPerItem
    eta = formatEta(remaining)
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
        <span>{label ?? 'Processando...'}</span>
        <div className="flex items-center gap-3">
          {eta && (
            <span className="animate-pulse" style={{ color: 'var(--accent-amber)' }}>⏱️ {eta}</span>
          )}
          <span>{current} / {total} <span style={{ color: 'var(--accent-indigo-light)' }}>({pct}%)</span></span>
        </div>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-2 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--accent-indigo), var(--accent-indigo-light))',
            boxShadow: '0 0 12px rgba(99,102,241,0.4)',
          }}
        />
      </div>
    </div>
  )
}
