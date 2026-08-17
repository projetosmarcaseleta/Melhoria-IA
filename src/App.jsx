import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './services/firebaseClient'
import useStore from './store/useStore'

// Pages/Components
import LoginPage from './components/LoginPage'
import ClientSelector from './components/ClientSelector'
import Header from './components/Header'
import TokenBar from './components/TokenBar'
import ConfigModal from './components/ConfigModal'
import ProductTable from './components/ProductTable'
import ReviewPanel from './components/ReviewPanel'
import LogPanel from './components/LogPanel'
import KnowledgeManager from './components/KnowledgeManager'
import ClientSkillsManager from './components/ClientSkillsManager'
import ClientDashboard from './components/ClientDashboard'
import AdminPanel from './components/AdminPanel'
import HelpCenter from './components/HelpCenter'
import StatusToast from './components/StatusToast'

export default function App() {
  const storeAuth = useStore((s) => s.auth)
  const activeClient = useStore((s) => s.activeClient)
  const activeTab = useStore((s) => s.ui.activeTab)
  const configOpen = useStore((s) => s.ui.configOpen)
  const setAuth = useStore((s) => s.setAuth)
  const clearAuth = useStore((s) => s.clearAuth)

  // Escutar estado de autenticação do Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken()
          let operatorData = null

          try {
            const opDoc = await getDoc(doc(db, 'operators', firebaseUser.uid))
            if (opDoc.exists()) operatorData = opDoc.data()
          } catch (err) {
            console.warn('[App] Erro ao carregar operador:', err.message)
          }

          setAuth(
            {
              id: firebaseUser.uid,
              email: firebaseUser.email,
              name: operatorData?.name ?? firebaseUser.displayName ?? firebaseUser.email,
              role: operatorData?.role ?? 'editor',
            },
            { access_token: token }
          )
        } catch (err) {
          console.error('[App] Erro ao obter token:', err)
          clearAuth()
        }
      } else {
        const currentSession = useStore.getState().auth.session
        if (currentSession?.access_token?.startsWith('mock-')) {
          // Mantém a sessão do modo de teste ativa
          return
        }
        clearAuth()
      }
    })

    return () => unsubscribe()
  }, [])

  // Loading state
  if (storeAuth.isLoading) {
    return (
      <div className="app-loading">
        <span className="login-spinner login-spinner-lg" />
        <p>Carregando...</p>
      </div>
    )
  }

  // Not authenticated → Login
  if (!storeAuth.user) {
    return <LoginPage />
  }

  const isAdmin = storeAuth.user?.role === 'admin'

  // Authenticated but no client selected (e não está no tab admin permitido) → Client Selector
  if (!activeClient && (activeTab !== 'admin' || !isAdmin)) {
    return <ClientSelector />
  }

  // Authenticated + client selected (ou no tab admin) → Main App
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-4">
        {/* Token AnyMarket — sempre visível na página de produtos */}
        {activeTab === 'products' && <TokenBar />}

        {activeTab === 'products' && <ProductTable />}
        {activeTab === 'review' && <ReviewPanel />}
        {activeTab === 'knowledge' && <KnowledgeManager />}
        {activeTab === 'skills' && <ClientSkillsManager />}
        {activeTab === 'insights' && <ClientDashboard />}
        {activeTab === 'admin' && (isAdmin ? <AdminPanel /> : <ProductTable />)}
        {activeTab === 'help' && <HelpCenter />}
        {activeTab === 'logs' && <LogPanel />}
      </main>

      {configOpen && <ConfigModal />}
      <StatusToast />
    </div>
  )
}
