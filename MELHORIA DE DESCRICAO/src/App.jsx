import useStore from './store/useStore'
import Header from './components/Header'
import TokenBar from './components/TokenBar'
import ConfigModal from './components/ConfigModal'
import ProductTable from './components/ProductTable'
import ReviewPanel from './components/ReviewPanel'
import LogPanel from './components/LogPanel'
import StatusToast from './components/StatusToast'

export default function App() {
  const activeTab = useStore((s) => s.ui.activeTab)
  const configOpen = useStore((s) => s.ui.configOpen)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-4">
        {/* Token AnyMarket — sempre visível na página principal */}
        {activeTab === 'products' && <TokenBar />}

        {activeTab === 'products' && <ProductTable />}
        {activeTab === 'review' && <ReviewPanel />}
        {activeTab === 'logs' && <LogPanel />}
      </main>

      {configOpen && <ConfigModal />}
      <StatusToast />
    </div>
  )
}
