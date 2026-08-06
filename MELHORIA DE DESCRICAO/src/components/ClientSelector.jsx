import { useState, useEffect } from 'react'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export default function ClientSelector() {
  const auth = useStore((s) => s.auth)
  const clients = useStore((s) => s.clients)
  const setClients = useStore((s) => s.setClients)
  const setActiveClient = useStore((s) => s.setActiveClient)
  const setTab = useStore((s) => s.setTab)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/clients`, {
        headers: {
          Authorization: `Bearer ${auth.session?.access_token}`,
        },
      })

      if (!res.ok) throw new Error('Falha ao buscar clientes')

      const data = await res.json()
      setClients(data.filter((c) => c.isActive !== false))
    } catch (err) {
      setError('Erro ao carregar lista de clientes.')
      console.error('[ClientSelector]', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (client) => {
    setActiveClient(client)
    setTab('products')
  }

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      {/* Glow ambient background */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative z-10 animate-slideUp">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center mx-auto text-xl shadow-lg shadow-indigo-500/25">
            🏢
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Selecione o Cliente
          </h1>
          <p className="text-xs text-slate-400">
            Olá, <strong className="text-slate-200">{auth.user?.name || auth.user?.email}</strong>. Escolha a conta para iniciar os trabalhos.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs text-center font-medium">
            {error}
          </div>
        )}

        {/* Search Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou slug..."
            className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all font-medium"
            autoFocus
          />
        </div>

        {/* Client List */}
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400 space-y-3">
            <span className="login-spinner login-spinner-lg mx-auto" />
            <p>Carregando clientes cadastrados...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 bg-slate-950/60 rounded-2xl border border-slate-800 p-6 space-y-3">
            <p className="font-semibold text-slate-300">
              {clients.length === 0 ? 'Nenhum cliente cadastrado no sistema.' : 'Nenhum cliente corresponde ao filtro.'}
            </p>
            {auth.user?.role === 'admin' && (
              <button
                onClick={() => { setTab('admin'); setActiveClient({ id: 'dummy', name: 'Admin' }) }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all"
              >
                👑 Ir para Painel Admin e Cadastrar Cliente
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {filtered.map((client) => (
              <button
                key={client.id}
                onClick={() => handleSelect(client)}
                className="w-full p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-950 transition-all duration-200 flex items-center justify-between group text-left shadow-sm hover:shadow-indigo-500/5"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {client.name}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {client.slug}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-2">
                  {client.anymarket_token ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                      Token ✓
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-300">
                      Sem token
                    </span>
                  )}
                  <div className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-white group-hover:bg-indigo-600 group-hover:border-indigo-500 transition-all">
                    →
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>{clients.length} cliente(s) ativo(s)</span>
          {auth.user?.role === 'admin' && (
            <button
              onClick={() => { setActiveClient({ id: 'admin-mode', name: 'Painel Admin' }); setTab('admin') }}
              className="text-indigo-400 hover:text-indigo-300 font-semibold hover:underline flex items-center gap-1"
            >
              <span>👑 Painel Admin</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
