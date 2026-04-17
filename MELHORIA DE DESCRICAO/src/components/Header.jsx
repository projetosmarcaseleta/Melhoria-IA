import useStore from '../store/useStore'

export default function Header() {
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const setTab = useStore((s) => s.setTab)
  const activeTab = useStore((s) => s.ui.activeTab)
  const logs = useStore((s) => s.logs)
  const products = useStore((s) => s.products)
  const reviewCount = products.filter((p) => p.status === 'processed').length

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30">
      <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo / Título */}
        <div className="flex items-center gap-2">
          <span className="text-xl">🛍️</span>
          <span className="font-semibold text-gray-800 text-sm sm:text-base">
            Melhoria de Descrição de Produtos
          </span>
        </div>

        {/* Abas */}
        <nav className="flex gap-1">
          <button
            onClick={() => setTab('products')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'products'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Produtos
          </button>
          <button
            onClick={() => setTab('review')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors relative ${
              activeTab === 'review'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Revisão
            {reviewCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {reviewCount > 99 ? '99+' : reviewCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('logs')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors relative ${
              activeTab === 'logs'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Logs
            {logs.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {logs.length > 99 ? '99+' : logs.length}
              </span>
            )}
          </button>
        </nav>

        {/* Config */}
        <button
          onClick={() => setConfigOpen(true)}
          title="Configurações"
          className="p-2 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
        >
          ⚙️
        </button>
      </div>
    </header>
  )
}
