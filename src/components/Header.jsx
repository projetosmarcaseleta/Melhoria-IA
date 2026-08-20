import { signOut } from 'firebase/auth'
import { auth } from '../services/firebaseClient'
import useStore from '../store/useStore'
import CriaSymbol from './icons/CriaSymbol'
import Icon from './icons/Icon'
import { IconButton } from './ui/primitives'

export default function Header() {
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const setTab = useStore((s) => s.setTab)
  const activeTab = useStore((s) => s.ui.activeTab)
  const logs = useStore((s) => s.logs)
  const products = useStore((s) => s.products)
  const activeClient = useStore((s) => s.activeClient)
  const storeAuth = useStore((s) => s.auth)
  const setActiveClient = useStore((s) => s.setActiveClient)
  const clearAuth = useStore((s) => s.clearAuth)

  const reviewCount = products.filter((p) => p.status === 'processed').length
  const isAdmin = (storeAuth.user?.role ?? 'editor') === 'admin'

  // Ícones em SVG no lugar dos emoji: o emoji mudava de desenho por sistema
  // operacional e colidia em significado (👁️ era a aba Revisão e também o
  // botão "mostrar token").
  const allTabs = [
    { key: 'products',  label: 'Produtos', icon: 'box',      count: null },
    { key: 'review',    label: 'Revisão',  icon: 'review',   count: reviewCount || null, accent: '#f59e0b' },
    { key: 'knowledge', label: 'Base RAG', icon: 'book',     count: null },
    { key: 'skills',    label: 'Skills',   icon: 'zap',      count: null },
    { key: 'insights',  label: 'Insights', icon: 'chart',    count: null },
    { key: 'admin',     label: 'Admin',    icon: 'crown',    count: null, adminOnly: true },
    { key: 'help',      label: 'Ajuda',    icon: 'help',     count: null },
    { key: 'logs',      label: 'Logs',     icon: 'list',     count: logs.length || null, accent: '#10b981' },
  ]

  const tabs = allTabs.filter((tab) => !tab.adminOnly || isAdmin)

  const handleLogout = async () => {
    try {
      await signOut(auth)
    } catch (err) {
      console.error('[Header] Erro ao fazer logout:', err)
    }
    clearAuth()
    setActiveClient(null)
  }

  return (
    <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800/80">
      <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between gap-3">

        {/* Marca + cliente ativo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white p-1">
            <CriaSymbol size={22} />
          </div>

          <span className="font-bold text-[15px] text-white tracking-tight hidden sm:inline">CRIA</span>

          {activeClient && (
            <button
              type="button"
              onClick={() => setActiveClient(null)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-indigo-500/12 border border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/22 transition-all"
              title="Trocar de cliente"
            >
              <Icon name="building" size={12} />
              <span className="truncate max-w-[130px]">{activeClient.name}</span>
              <Icon name="chevronDown" size={11} className="opacity-60" />
            </button>
          )}
        </div>

        {/* Navegação */}
        <nav className="flex items-center gap-0.5 bg-slate-900/80 p-1 border border-slate-800 rounded-xl overflow-x-auto scrollbar-none max-w-full">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTab(tab.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <Icon name={tab.icon} size={15} />
                <span className="hidden md:inline">{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className="min-w-[17px] h-[17px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1 tabular-nums"
                    style={{ background: tab.accent ?? '#f59e0b' }}
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Conta */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <IconButton icon="gear" label="Configurações do cliente" variant="outline" size={32} onClick={() => setConfigOpen(true)} />

          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 py-1 px-1.5 rounded-xl">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold bg-gradient-to-br from-emerald-500 to-teal-700 text-white"
              title={storeAuth.user?.email}
            >
              {(storeAuth.user?.name || storeAuth.user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <span
              className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                isAdmin ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isAdmin && <Icon name="crown" size={10} />}
              {isAdmin ? 'Admin' : 'Editor'}
            </span>
          </div>

          <IconButton icon="logout" label="Sair da conta" variant="outline" size={32} onClick={handleLogout} className="hover:!text-rose-400 hover:!border-rose-500/40" />
        </div>

      </div>
    </header>
  )
}
