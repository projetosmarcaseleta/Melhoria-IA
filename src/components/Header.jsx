import { signOut } from 'firebase/auth'
import { auth } from '../services/firebaseClient'
import useStore from '../store/useStore'
import CriaSymbol from './icons/CriaSymbol'

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
  const userRole = storeAuth.user?.role ?? 'editor'
  const isAdmin = userRole === 'admin'

  const allTabs = [
    { key: 'products', label: 'Produtos', icon: '📦', count: null },
    { key: 'review', label: 'Revisão', icon: '👁️', count: reviewCount > 0 ? reviewCount : null, accent: '#f59e0b' },
    { key: 'knowledge', label: 'Base RAG', icon: '📚', count: null },
    { key: 'skills', label: 'Skills', icon: '⚡', count: null },
    { key: 'insights', label: 'Insights', icon: '📈', count: null },
    { key: 'admin', label: 'Admin', icon: '👑', count: null, adminOnly: true },
    { key: 'help', label: 'Ajuda', icon: '❓', count: null },
    { key: 'logs', label: 'Logs', icon: '📋', count: logs.length > 0 ? logs.length : null, accent: '#10b981' },
  ]

  // Filtrar aba de admin se o usuário não for administrador
  const tabs = allTabs.filter((tab) => !tab.adminOnly || isAdmin)

  const handleSwitchClient = () => {
    setActiveClient(null)
  }

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
    <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800/80 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        
        {/* Lado Esquerdo: Logo & Cliente Ativo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white shadow-md shadow-indigo-500/20 p-1">
            <CriaSymbol size={22} />
          </div>

          <span className="font-extrabold text-sm text-white tracking-tight hidden sm:inline">
            CRIA
          </span>

          {activeClient && (
            <button
              onClick={handleSwitchClient}
              className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-all flex items-center gap-1.5 shadow-sm"
              title="Clique para alternar de cliente"
            >
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="truncate max-w-[130px]">🏢 {activeClient.name}</span>
            </button>
          )}
        </div>

        {/* Centro: Navegação Compacta & Responsiva (Scroll Sem Barras) */}
        <nav className="flex items-center gap-1 bg-slate-900/90 p-1 border border-slate-800 rounded-xl overflow-x-auto scrollbar-none max-w-full">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key

            return (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`relative px-2.5 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span className="text-xs">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-extrabold text-white px-1 ml-0.5"
                    style={{ background: tab.accent || '#f59e0b' }}
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Lado Direito: Configurações, Perfil & Logout */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setConfigOpen(true)}
            title="Configurações do Cliente"
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all text-xs"
          >
            ⚙️
          </button>

          <div className="h-5 w-px bg-slate-800 mx-0.5" />

          {/* Perfil com Badge de Role */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 py-1 px-2 rounded-xl">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold bg-gradient-to-br from-emerald-500 to-teal-700 text-white"
                title={storeAuth.user?.email}
              >
                {(storeAuth.user?.name || storeAuth.user?.email || '?').charAt(0).toUpperCase()}
              </div>
              <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase ${
                isAdmin
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {isAdmin ? '👑 Admin' : 'Editor'}
              </span>
            </div>

            <button
              onClick={handleLogout}
              title="Sair da Conta"
              className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-900 hover:bg-rose-500/20 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-all text-xs"
            >
              ↪
            </button>
          </div>
        </div>

      </div>
    </header>
  )
}
