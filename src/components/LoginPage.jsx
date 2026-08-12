import { useState, useEffect } from 'react'
import {
  signInWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  OAuthProvider,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../services/firebaseClient'
import useStore from '../store/useStore'
import CriaSymbol from './icons/CriaSymbol'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msLoading, setMsLoading] = useState(false)
  const [error, setError] = useState('')
  const setAuth = useStore((s) => s.setAuth)

  // signInWithPopup depende de monitorar a janela do popup (window.closed /
  // postMessage), o que o Cross-Origin-Opener-Policy das páginas de login da
  // Microsoft/Google bloqueia no Chrome. signInWithRedirect não depende disso.
  useEffect(() => {
    let cancelled = false

    const finishMicrosoftLogin = async () => {
      try {
        const result = await getRedirectResult(auth)
        if (!result || cancelled) return

        setMsLoading(true)
        const user = result.user

        const opDoc = await getDoc(doc(db, 'operators', user.uid))
        if (!opDoc.exists()) {
          await signOut(auth)
          setError('Conta Microsoft não autorizada. Solicite acesso a um administrador.')
          return
        }

        const operatorData = opDoc.data()
        const token = await user.getIdToken()

        setAuth(
          {
            id: user.uid,
            email: user.email,
            name: operatorData?.name ?? user.displayName ?? user.email,
            role: operatorData?.role ?? 'editor',
          },
          { access_token: token }
        )
      } catch (authError) {
        if (authError.code === 'auth/account-exists-with-different-credential') {
          setError('Este e-mail já possui login com senha. Use e-mail e senha para entrar.')
        } else {
          console.error('[Login/Microsoft]', authError)
          setError('Erro ao entrar com Microsoft. Tente novamente.')
        }
      } finally {
        if (!cancelled) setMsLoading(false)
      }
    }

    finishMicrosoftLogin()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      const user = userCredential.user
      const token = await user.getIdToken()

      // Buscar perfil do operador no Firestore
      let operatorData = null
      try {
        const opDoc = await getDoc(doc(db, 'operators', user.uid))
        if (opDoc.exists()) {
          operatorData = opDoc.data()
        }
      } catch (err) {
        console.warn('[Login] Aviso ao buscar perfil do operador:', err.message)
      }

      setAuth(
        {
          id: user.uid,
          email: user.email,
          name: operatorData?.name ?? user.displayName ?? user.email,
          role: operatorData?.role ?? 'editor',
        },
        { access_token: token }
      )
    } catch (authError) {
      console.error('[Login]', authError)
      let msg = 'Erro ao fazer login. Tente novamente.'
      if (
        authError.code === 'auth/invalid-credential' ||
        authError.code === 'auth/user-not-found' ||
        authError.code === 'auth/wrong-password'
      ) {
        msg = 'E-mail ou senha inválidos.'
      } else if (authError.code === 'auth/too-many-requests') {
        msg = 'Muitas tentativas incorretas. Tente mais tarde.'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleMicrosoftLogin = async () => {
    setError('')
    setMsLoading(true)

    try {
      const provider = new OAuthProvider('microsoft.com')
      provider.setCustomParameters({ prompt: 'select_account' })
      // Navega para a Microsoft e volta; o resultado é tratado no useEffect
      // acima via getRedirectResult, após o reload da página.
      await signInWithRedirect(auth, provider)
    } catch (authError) {
      console.error('[Login/Microsoft]', authError)
      setError('Erro ao entrar com Microsoft. Tente novamente.')
      setMsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      {/* Ambient Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 relative z-10 animate-slideUp">
        
        {/* Header — lockup CRIA: símbolo + wordmark + tagline (brand book pág. 5) */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25 p-2.5">
            <CriaSymbol size={44} />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            CRIA
          </h1>
          <p className="text-xs text-slate-400">
            Do produto bruto ao anúncio pronto.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs text-center font-medium">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs font-semibold text-slate-300">
              E-mail de Acesso
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu.email@empresa.com"
              required
              autoFocus
              autoComplete="email"
              className="w-full px-3.5 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-slate-300">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full px-3.5 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-3 px-4 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <>
                <span className="login-spinner" />
                <span>Autenticando...</span>
              </>
            ) : (
              <span>Entrar no Sistema</span>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-[11px] text-slate-500 font-medium">ou</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        <button
          type="button"
          onClick={handleMicrosoftLogin}
          disabled={loading || msLoading}
          className="w-full py-3 px-4 rounded-xl text-xs font-extrabold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {msLoading ? (
            <>
              <span className="login-spinner" />
              <span>Autenticando...</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              <span>Entrar com Microsoft</span>
            </>
          )}
        </button>

        <div className="text-center pt-2 border-t border-slate-800">
          <p className="text-[11px] text-slate-400">
            Acesso restrito para operadores autorizados
          </p>
        </div>
      </div>
    </div>
  )
}
