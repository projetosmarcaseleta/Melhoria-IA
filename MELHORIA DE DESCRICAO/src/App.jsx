import useStore from './store/useStore'
import Header from './components/Header'
import ConfigModal from './components/ConfigModal'
import ProductTable from './components/ProductTable'
import ReviewPanel from './components/ReviewPanel'
import LogPanel from './components/LogPanel'
import StatusToast from './components/StatusToast'

export default function App() {
  const activeTab = useStore((s) => s.ui.activeTab)
  const configOpen = useStore((s) => s.ui.configOpen)

  return (
    <div className="min-h-screen bg-gray-100">
      <Header />

      <main className="max-w-screen-xl mx-auto px-4 py-6">
        {activeTab === 'products' && <ProductTable />}
        {activeTab === 'review' && <ReviewPanel />}
        {activeTab === 'logs' && <LogPanel />}
      </main>

      {configOpen && <ConfigModal />}
      <StatusToast />
    </div>
  )
}
