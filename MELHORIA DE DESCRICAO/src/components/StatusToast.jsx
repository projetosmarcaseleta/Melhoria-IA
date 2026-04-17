import useStore from '../store/useStore'

const ICONS = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
}

const BG = {
  success: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  error: 'bg-red-50 border-red-300 text-red-800',
  info: 'bg-blue-50 border-blue-300 text-blue-800',
  warning: 'bg-amber-50 border-amber-300 text-amber-800',
}

export default function StatusToast() {
  const toasts = useStore((s) => s.ui.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 shadow-lg text-sm ${BG[t.type] ?? BG.info}`}
        >
          <span className="text-base shrink-0">{ICONS[t.type] ?? 'ℹ️'}</span>
          <p className="flex-1 leading-snug">{t.message}</p>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 text-base leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
