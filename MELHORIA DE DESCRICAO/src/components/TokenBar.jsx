import { useState } from 'react'
import useStore from '../store/useStore'

export default function TokenBar() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const [showToken, setShowToken] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tempToken, setTempToken] = useState(config.gumgaToken ?? '')

  const hasToken = !!config.gumgaToken

  const handleSave = () => {
    setConfig({ gumgaToken: tempToken })
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setTempToken(config.gumgaToken ?? '') }
  }

  if (!editing && hasToken) {
    return (
      <div className="animate-fadeIn token-bar">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--accent-emerald-glow), rgba(52,211,153,0.05))' }}>
          <span className="text-base">🔑</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>gumgaToken</p>
          <p className="text-sm font-mono truncate" style={{ color: 'var(--accent-emerald)' }}>
            {showToken ? config.gumgaToken : '•'.repeat(Math.min(config.gumgaToken.length, 32))}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowToken(!showToken)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            title={showToken ? 'Ocultar' : 'Mostrar'}>
            {showToken ? '🙈' : '👁️'}
          </button>
          <button onClick={() => { setEditing(true); setTempToken(config.gumgaToken) }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            Alterar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeIn token-bar" style={{ borderColor: 'rgba(99,102,241,0.3)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'var(--accent-indigo-glow)' }}>
        <span className="text-base">🔑</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {hasToken ? 'Alterar Token AnyMarket' : 'Token AnyMarket (gumgaToken)'}
        </p>
        <input
          type={showToken ? 'text' : 'password'}
          value={tempToken}
          onChange={(e) => setTempToken(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Cole seu token AnyMarket aqui..."
          className="input-dark"
          autoFocus
          style={{ fontSize: '13px' }}
        />
        {!hasToken && (
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Necessário para autenticar nas operações do AnyMarket
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 self-end pb-0.5">
        <button onClick={() => setShowToken(!showToken)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
          {showToken ? '🙈' : '👁️'}
        </button>
        {editing && (
          <button onClick={() => { setEditing(false); setTempToken(config.gumgaToken ?? '') }}
            className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
        )}
        <button onClick={handleSave} disabled={!tempToken.trim()}
          className="btn-primary text-xs py-1.5 px-3"
          style={{ opacity: tempToken.trim() ? 1 : 0.4 }}>
          💾 Salvar
        </button>
      </div>
    </div>
  )
}
