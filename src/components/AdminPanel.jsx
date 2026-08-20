import { useState, useEffect } from 'react'
import apiClient from '../services/apiClient'
import useStore from '../store/useStore'

export default function AdminPanel() {
  const auth = useStore((s) => s.auth)
  const addToast = useStore((s) => s.addToast)
  const setActiveClient = useStore((s) => s.setActiveClient)

  const [activeTab, setActiveTab] = useState('clients') // 'clients' | 'operators'

  // ── Estados de Clientes ──────────────────────────────────────────────────
  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [newClient, setNewClient] = useState({ name: '', slug: '', anymarket_token: '' })
  const [isCreatingClient, setIsCreatingClient] = useState(false)
  const [editingClientToken, setEditingClientToken] = useState(null)
  const [tempTokenValue, setTempTokenValue] = useState('')

  // ── Estados de Operadores ────────────────────────────────────────────────
  const [operators, setOperators] = useState([])
  const [operatorsLoading, setOperatorsLoading] = useState(true)
  const [newOperator, setNewOperator] = useState({ name: '', email: '', password: '', role: 'editor' })
  const [isCreatingOperator, setIsCreatingOperator] = useState(false)

  // ── Estados de Prompts Globais (Núcleo do Sistema) ────────────────────────
  const [globalPrompts, setGlobalPrompts] = useState({ titulo: '', descricao: '' })
  const [globalHardcoded, setGlobalHardcoded] = useState({ titulo: '', descricao: '' })
  const [globalMeta, setGlobalMeta] = useState({ titulo: null, descricao: null })
  const [globalLoading, setGlobalLoading] = useState(false)
  const [isSavingGlobal, setIsSavingGlobal] = useState(false)
  const [globalPromptTab, setGlobalPromptTab] = useState('descricao') // 'descricao' | 'titulo'

  useEffect(() => {
    fetchClients()
    if (auth.user?.role === 'admin') {
      fetchOperators()
      fetchGlobalPrompts()
    }
  }, [])

  const fetchClients = async () => {
    try {
      setClientsLoading(true)
      const res = await apiClient.get('/api/clients')
      setClients(res.data)
    } catch (err) {
      console.error('[AdminPanel] Erro ao buscar clientes:', err)
      addToast('error', 'Erro ao carregar lista de clientes.')
    } finally {
      setClientsLoading(false)
    }
  }

  const fetchOperators = async () => {
    try {
      setOperatorsLoading(true)
      const res = await apiClient.get('/api/operators')
      setOperators(res.data)
    } catch (err) {
      console.error('[AdminPanel] Erro ao buscar operadores:', err)
    } finally {
      setOperatorsLoading(false)
    }
  }

  // ── Ações de Clientes ───────────────────────────────────────────────────
  const handleClientNameChange = (name) => {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    setNewClient((prev) => ({ ...prev, name, slug }))
  }

  const handleCreateClient = async (e) => {
    e.preventDefault()
    if (!newClient.name.trim() || !newClient.slug.trim()) {
      addToast('warning', 'Nome do cliente e Slug são obrigatórios.')
      return
    }

    try {
      setIsCreatingClient(true)
      const res = await apiClient.post(
        '/api/clients',
        {
          name: newClient.name.trim(),
          slug: newClient.slug.trim(),
          anymarket_token: newClient.anymarket_token.trim() || null,
        }
      )

      addToast('success', `Pronto! Cliente "${res.data.name}" cadastrado.`)
      setNewClient({ name: '', slug: '', anymarket_token: '' })
      fetchClients()
    } catch (err) {
      console.error('[AdminPanel] Erro ao criar cliente:', err)
      addToast('error', err.response?.data?.error || 'Erro ao cadastrar cliente.')
    } finally {
      setIsCreatingClient(false)
    }
  }

  const handleSaveClientToken = async (clientId) => {
    try {
      await apiClient.patch(
        `/api/clients/${clientId}`,
        { anymarket_token: tempTokenValue.trim() }
      )
      addToast('success', 'Pronto! Token da AnyMarket atualizado.')
      setEditingClientToken(null)
      fetchClients()
    } catch (err) {
      console.error('[AdminPanel] Erro ao atualizar token:', err)
      addToast('error', 'Erro ao salvar novo token.')
    }
  }

  const handleToggleClientActive = async (client) => {
    try {
      await apiClient.patch(
        `/api/clients/${client.id}`,
        { isActive: !client.isActive }
      )
      addToast('success', `Status de ${client.name} atualizado!`)
      fetchClients()
    } catch (err) {
      console.error('[AdminPanel] Erro ao alterar status:', err)
      addToast('error', 'Erro ao atualizar status do cliente.')
    }
  }

  // ── Ações de Operadores ─────────────────────────────────────────────────
  const handleCreateOperator = async (e) => {
    e.preventDefault()
    if (!newOperator.name.trim() || !newOperator.email.trim() || !newOperator.password) {
      addToast('warning', 'Preencha Nome, E-mail e Senha temporária.')
      return
    }

    try {
      setIsCreatingOperator(true)
      const res = await apiClient.post(
        '/api/operators',
        {
          name: newOperator.name.trim(),
          email: newOperator.email.trim(),
          password: newOperator.password,
          role: newOperator.role,
        }
      )

      addToast('success', res.data.message || `Operador "${newOperator.name}" criado!`)
      setNewOperator({ name: '', email: '', password: '', role: 'editor' })
      fetchOperators()
    } catch (err) {
      console.error('[AdminPanel] Erro ao cadastrar operador:', err)
      addToast('error', err.response?.data?.error || 'Erro ao cadastrar operador.')
    } finally {
      setIsCreatingOperator(false)
    }
  }

  const handleToggleOperatorRole = async (op) => {
    const newRole = op.role === 'admin' ? 'editor' : 'admin'
    try {
      await apiClient.patch(
        `/api/operators/${op.id}`,
        { role: newRole }
      )
      addToast('success', `Função de ${op.name} alterada para ${newRole.toUpperCase()}`)
      fetchOperators()
    } catch (err) {
      console.error('[AdminPanel] Erro ao alterar função:', err)
      addToast('error', 'Erro ao atualizar função do operador.')
    }
  }

  const handleDeleteOperator = async (op) => {
    if (!confirm(`Remover o acesso de ${op.name} (${op.email}) permanentemente?`)) return

    try {
      await apiClient.delete(`/api/operators/${op.id}`)
      addToast('success', `Operador "${op.name}" removido!`)
      fetchOperators()
    } catch (err) {
      console.error('[AdminPanel] Erro ao remover operador:', err)
      addToast('error', err.response?.data?.error || 'Erro ao remover operador.')
    }
  }

  // ── Ações de Prompts Globais (Núcleo do Sistema) ────────────────────────
  const fetchGlobalPrompts = async () => {
    try {
      setGlobalLoading(true)
      const res = await apiClient.get('/api/prompts/global')
      setGlobalPrompts({
        titulo: res.data?.titulo?.content || res.data?.hardcoded?.titulo || '',
        descricao: res.data?.descricao?.content || res.data?.hardcoded?.descricao || '',
      })
      setGlobalHardcoded({
        titulo: res.data?.hardcoded?.titulo || '',
        descricao: res.data?.hardcoded?.descricao || '',
      })
      setGlobalMeta({
        titulo: res.data?.titulo || null,
        descricao: res.data?.descricao || null,
      })
    } catch (err) {
      console.error('[AdminPanel] Erro ao buscar prompts globais:', err)
      addToast('error', 'Erro ao carregar prompts globais do sistema.')
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleSaveGlobalPrompts = async (e) => {
    e.preventDefault()
    try {
      setIsSavingGlobal(true)
      await apiClient.put('/api/prompts/global', {
        titulo: globalPrompts.titulo,
        descricao: globalPrompts.descricao,
      })
      addToast('success', 'Pronto! Núcleo do sistema (prompts globais) atualizado.')
      fetchGlobalPrompts()
    } catch (err) {
      console.error('[AdminPanel] Erro ao salvar prompts globais:', err)
      addToast('error', err.response?.data?.error || 'Erro ao salvar prompt global.')
    } finally {
      setIsSavingGlobal(false)
    }
  }

  const handleResetToHardcoded = (type) => {
    const nome = type === 'descricao' ? 'Descrição' : 'Título'
    if (!confirm(`Deseja restaurar o prompt padrão de ${nome} para a versão original do código-fonte?`)) return
    setGlobalPrompts((prev) => ({
      ...prev,
      [type]: globalHardcoded[type] || '',
    }))
    addToast('info', `Prompt de ${nome} restaurado localmente. Clique em "Salvar Alterações" para aplicar.`)
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16 animate-fadeIn">
      {/* Banner de Título & Sub-Navegação */}
      <div className="rounded-2xl p-6 bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-xl">
            ⚙️
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Painel Administrativo & Gestão
            </h2>
            <p className="text-xs text-slate-400">
              Cadastre e gerencie novos clientes, operadores da equipe e os prompts do núcleo do sistema.
            </p>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl shrink-0 flex-wrap">
          <button
            onClick={() => setActiveTab('clients')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'clients'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🏢</span>
            <span>Clientes</span>
          </button>
          {auth.user?.role === 'admin' && (
            <>
              <button
                onClick={() => setActiveTab('operators')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'operators'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>👤</span>
                <span>Operadores</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('prompts')
                  fetchGlobalPrompts()
                }}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'prompts'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>🧠</span>
                <span>Núcleo do Sistema (Prompts)</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── SEÇÃO 1: GESTÃO DE CLIENTES ── */}
      {activeTab === 'clients' && (
        <div className="space-y-6">
          {/* Formulário de Novo Cliente */}
          {auth.user?.role === 'admin' && (
            <form onSubmit={handleCreateClient} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <span>➕</span> Cadastrar Novo Cliente (Empresa)
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome da Empresa / Cliente</label>
                  <input
                    type="text"
                    placeholder="Ex: Marca Eletrônicos"
                    value={newClient.name}
                    onChange={(e) => handleClientNameChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Slug Identificador</label>
                  <input
                    type="text"
                    placeholder="ex: marca-eletronicos"
                    value={newClient.slug}
                    onChange={(e) => setNewClient({ ...newClient, slug: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Token AnyMarket (gumgaToken)</label>
                  <input
                    type="password"
                    placeholder="Token Gumga do cliente (opcional)"
                    value={newClient.anymarket_token}
                    onChange={(e) => setNewClient({ ...newClient, anymarket_token: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreatingClient}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2"
                >
                  {isCreatingClient ? 'Cadastrando...' : '🚀 Cadastrar Cliente'}
                </button>
              </div>
            </form>
          )}

          {/* Tabela de Clientes */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <span>📋</span> Clientes Cadastrados ({clients.length})
              </h3>
            </div>

            {clientsLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Carregando clientes...</div>
            ) : clients.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Nenhum cliente cadastrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="pb-3">Cliente</th>
                      <th className="pb-3">Slug</th>
                      <th className="pb-3">Token AnyMarket</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {clients.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-950/40 transition-colors">
                        <td className="py-3.5 font-bold text-white flex items-center gap-2">
                          <span>🏢</span> {c.name}
                        </td>
                        <td className="py-3.5 font-mono text-slate-300 text-[11px]">{c.slug}</td>
                        <td className="py-3.5">
                          {editingClientToken === c.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={tempTokenValue}
                                onChange={(e) => setTempTokenValue(e.target.value)}
                                className="px-2 py-1 bg-slate-950 border border-indigo-500 rounded text-xs text-white font-mono"
                              />
                              <button
                                onClick={() => handleSaveClientToken(c.id)}
                                className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold"
                              >
                                Salvar
                              </button>
                              <button
                                onClick={() => setEditingClientToken(null)}
                                className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-[10px]"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 font-mono text-slate-400 text-[11px]">
                              <span>{c.anymarket_token ? '••••••••••••••••' : '(sem token)'}</span>
                              {auth.user?.role === 'admin' && (
                                <button
                                  onClick={() => {
                                    setEditingClientToken(c.id)
                                    setTempTokenValue(c.anymarket_token || '')
                                  }}
                                  className="text-indigo-400 hover:underline text-[10px]"
                                >
                                  ✏️ Editar
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            c.isActive !== false
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                              : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                          }`}>
                            {c.isActive !== false ? 'ATIVO ✅' : 'INATIVO ❌'}
                          </span>
                        </td>
                        <td className="py-3.5 text-right space-x-2">
                          <button
                            onClick={() => {
                              setActiveClient(c)
                              addToast('success', `Cliente "${c.name}" selecionado!`)
                            }}
                            className="px-2.5 py-1 bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg font-bold text-[11px] transition-all"
                          >
                            Selecionar →
                          </button>
                          {auth.user?.role === 'admin' && (
                            <button
                              onClick={() => handleToggleClientActive(c)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px]"
                            >
                              {c.isActive !== false ? 'Desativar' : 'Ativar'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEÇÃO 2: GESTÃO DE OPERADORES ── */}
      {activeTab === 'operators' && auth.user?.role === 'admin' && (
        <div className="space-y-6">
          {/* Form Novo Operador */}
          <form onSubmit={handleCreateOperator} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <span>👤</span> Adicionar Novo Operador da Equipe
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  placeholder="Ex: Carlos Silva"
                  value={newOperator.name}
                  onChange={(e) => setNewOperator({ ...newOperator, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail Corporativo</label>
                <input
                  type="email"
                  placeholder="carlos@empresa.com"
                  value={newOperator.email}
                  onChange={(e) => setNewOperator({ ...newOperator, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Senha Temporária</label>
                <input
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={newOperator.password}
                  onChange={(e) => setNewOperator({ ...newOperator, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Função / Nível</label>
                <select
                  value={newOperator.role}
                  onChange={(e) => setNewOperator({ ...newOperator, role: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="editor">✍️ Editor (Cadastro)</option>
                  <option value="admin">👑 Administrador</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isCreatingOperator}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2"
              >
                {isCreatingOperator ? 'Criando Conta...' : '👤 Criar Acesso do Operador'}
              </button>
            </div>
          </form>

          {/* Tabela de Operadores */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg space-y-3 p-5">
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <span>👥</span> Operadores Cadastrados ({operators.length})
            </h3>

            {operatorsLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Carregando operadores...</div>
            ) : operators.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Nenhum operador encontrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="pb-3">Nome</th>
                      <th className="pb-3">E-mail</th>
                      <th className="pb-3">Nível de Acesso</th>
                      <th className="pb-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {operators.map((op) => (
                      <tr key={op.id} className="hover:bg-slate-950/40 transition-colors">
                        <td className="py-3.5 font-bold text-white flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px]">
                            {(op.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <span>{op.name}</span>
                        </td>
                        <td className="py-3.5 text-slate-300 font-mono text-[11px]">{op.email}</td>
                        <td className="py-3.5">
                          <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            op.role === 'admin'
                              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                              : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                          }`}>
                            {op.role === 'admin' ? '👑 ADMIN' : '✍️ EDITOR'}
                          </span>
                        </td>
                        <td className="py-3.5 text-right space-x-2">
                          <button
                            onClick={() => handleToggleOperatorRole(op)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px]"
                            title="Alternar entre Admin e Editor"
                          >
                            Mudar para {op.role === 'admin' ? 'Editor' : 'Admin'}
                          </button>
                          {op.id !== auth.user?.id && (
                            <button
                              onClick={() => handleDeleteOperator(op)}
                              className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-lg text-[11px]"
                            >
                              🗑️ Excluir
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEÇÃO 3: NÚCLEO DO SISTEMA (PROMPTS GLOBAIS) ── */}
      {activeTab === 'prompts' && auth.user?.role === 'admin' && (
        <div className="space-y-6">
          {/* Card Explicativo e Seletor de Tipo */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>🧠</span> Núcleo do Sistema — Prompts Globais
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Estes prompts compõem o motor padrão de inteligência artificial do CRIA. Eles são herdados por todos os clientes que utilizam o prompt padrão da plataforma.
                </p>
              </div>

              {/* Seletor Título / Descrição */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setGlobalPromptTab('descricao')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    globalPromptTab === 'descricao'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>📄</span>
                  <span>Descrição</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGlobalPromptTab('titulo')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    globalPromptTab === 'titulo'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>🏷️</span>
                  <span>Título</span>
                </button>
              </div>
            </div>

            {/* Metadados e Status da Versão Vigente */}
            {globalLoading ? (
              <div className="py-12 text-center text-xs text-slate-400">
                Carregando diretrizes do núcleo...
              </div>
            ) : (
              <form onSubmit={handleSaveGlobalPrompts} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 bg-slate-950/60 px-4 py-2.5 rounded-xl border border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="font-semibold text-slate-200">
                      Prompt de {globalPromptTab === 'descricao' ? 'Descrição' : 'Título'}
                    </span>
                    <span className="text-slate-500">|</span>
                    <span>
                      {globalMeta[globalPromptTab]?.version
                        ? `Versão ${globalMeta[globalPromptTab].version} (Salvo no Firestore)`
                        : 'Padrão original do código-fonte (Hardcoded)'}
                    </span>
                  </div>

                  {globalMeta[globalPromptTab]?.updatedAt && (
                    <span className="text-[11px] text-slate-500">
                      Atualizado por {globalMeta[globalPromptTab]?.updatedByName || 'Admin'} em{' '}
                      {new Date(globalMeta[globalPromptTab].updatedAt).toLocaleString('pt-BR')}
                    </span>
                  )}
                </div>

                {/* Editor de Texto Monospace */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <span>Instruções do Sistema (System Prompt)</span>
                    <span className="font-mono">
                      {(globalPrompts[globalPromptTab] || '').length} caracteres
                    </span>
                  </div>

                  <textarea
                    rows={18}
                    value={globalPrompts[globalPromptTab] || ''}
                    onChange={(e) =>
                      setGlobalPrompts((prev) => ({
                        ...prev,
                        [globalPromptTab]: e.target.value,
                      }))
                    }
                    className="w-full p-4 rounded-xl font-mono text-xs leading-relaxed bg-slate-950 border border-slate-700/80 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-y"
                    placeholder={`Insira as diretrizes para geração de ${globalPromptTab}...`}
                  />
                </div>

                {/* Ações Inferiores */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handleResetToHardcoded(globalPromptTab)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5"
                  >
                    <span>↺ Restaurar padrão de fábrica (código-fonte)</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isSavingGlobal}
                    className="px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSavingGlobal ? (
                      <>
                        <span className="login-spinner" />
                        <span>Salvando alterações...</span>
                      </>
                    ) : (
                      <>
                        <span>💾</span>
                        <span>Salvar Alterações no Núcleo</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
