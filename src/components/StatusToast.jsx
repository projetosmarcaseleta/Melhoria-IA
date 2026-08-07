import useStore from '../store/useStore'

const STYLES = {
  success: { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: '#34d399', icon: '✅' },
  error:   { bg: 'rgba(251,113,133,0.1)', border: 'rgba(251,113,133,0.25)', color: '#fb7185', icon: '❌' },
  info:    { bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.25)',  color: '#818cf8', icon: 'ℹ️' },
  warning: { bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)',  color: '#fbbf24', icon: '⚠️' },
}

export default function StatusToast() {
  const toasts = useStore((s) => s.ui.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
      {toasts.map((t) => {
        const s = STYLES[t.type] ?? STYLES.info
        return (
          <div
            key={t.id}
            className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm animate-slideUp"
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, backdropFilter: 'blur(12px)' }}
          >
            <span className="text-base shrink-0">{s.icon}</span>
            <p className="flex-1 leading-snug text-xs" style={{ color: 'var(--text-primary)' }}>{t.message}</p>
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 text-base leading-none"
              style={{ color: 'var(--text-muted)' }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
