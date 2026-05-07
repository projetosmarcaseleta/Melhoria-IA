import useStore from '../store/useStore'

export default function Header() {
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const setTab = useStore((s) => s.setTab)
  const activeTab = useStore((s) => s.ui.activeTab)
  const logs = useStore((s) => s.logs)
  const products = useStore((s) => s.products)
  const reviewCount = products.filter((p) => p.status === 'processed').length

  const tabs = [
    { key: 'products', label: 'Produtos', icon: '📦', count: null },
    { key: 'review', label: 'Revisão', icon: '👁️', count: reviewCount > 0 ? reviewCount : null, accent: 'var(--accent-amber)' },
    { key: 'logs', label: 'Logs', icon: '📋', count: logs.length > 0 ? logs.length : null, accent: 'var(--accent-emerald)' },
  ]

  return (
    <header className="sticky top-0 z-30 glass" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent-indigo), #4f46e5)' }}>
            <span className="text-sm">🛍️</span>
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            Melhoria de Descrição
          </span>
        </div>

        {/* Tabs */}
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className="relative px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: activeTab === tab.key ? 'var(--accent-indigo)' : 'transparent',
                color: activeTab === tab.key ? 'white' : 'var(--text-secondary)',
                boxShadow: activeTab === tab.key ? '0 2px 8px rgba(99,102,241,0.3)' : 'none',
              }}
              onMouseEnter={(e) => { if (activeTab !== tab.key) e.target.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={(e) => { if (activeTab !== tab.key) e.target.style.background = 'transparent' }}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
              {tab.count !== null && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1"
                  style={{ background: tab.accent || 'var(--accent-amber)' }}>
                  {tab.count > 99 ? '99+' : tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Config Button */}
        <button
          onClick={() => setConfigOpen(true)}
          title="Configurações"
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          ⚙️
        </button>
      </div>
    </header>
  )
}
