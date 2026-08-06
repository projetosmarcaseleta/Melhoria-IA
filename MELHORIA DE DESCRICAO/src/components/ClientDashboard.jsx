import { useState, useEffect } from 'react'
import axios from 'axios'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function getAuthHeaders() {
  const session = useStore.getState().auth.session
  if (!session?.access_token) {
    throw new Error('Usuário não autenticado.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

export default function ClientDashboard() {
  const activeClient = useStore((s) => s.activeClient)
  const auth = useStore((s) => s.auth)
  const addToast = useStore((s) => s.addToast)

  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // Meta-prompt state
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaResult, setMetaResult] = useState(null)
  const [metaPromptType, setMetaPromptType] = useState(null)
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    if (activeClient?.id) {
      fetchInsights()
    }
  }, [activeClient?.id])

  const fetchInsights = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_BASE}/api/insights/${activeClient.id}`, {
        headers: getAuthHeaders(),
      })
      setStats(res.data)
    } catch (err) {
      console.warn('[ClientDashboard] Aviso ao carregar insights:', err.message)
      setStats({
        totalGenerations: 0,
        approved: 0,
        edited: 0,
        rejected: 0,
        approvalRate: 0,
        avgTitleCharLength: 0,
        recentRejections: [],
      })
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateMetaPrompt = async (type) => {
    try {
      setMetaLoading(true)
      setMetaPromptType(type)
      setMetaResult(null)

      const res = await axios.post(
        `${API_BASE}/api/insights/${activeClient.id}/meta-prompt`,
        { promptType: type },
        { headers: getAuthHeaders() }
      )

      setMetaResult(res.data)
      addToast('success', 'Sugestão de prompt otimizado gerada pela IA!')
    } catch (err) {
      console.error('[ClientDashboard] Erro ao gerar meta-prompt:', err)
      addToast('error', err.response?.data?.error || 'Erro ao gerar otimização de prompt.')
    } finally {
      setMetaLoading(false)
    }
  }

  const handleApplyImprovedPrompt = async () => {
    if (!metaResult?.improvedPrompt || !metaPromptType) return

    try {
      setIsApplying(true)
      const payload = {
        [metaPromptType]: metaResult.improvedPrompt,
      }

      await axios.put(
        `${API_BASE}/api/prompts/${activeClient.id}`,
        payload,
        { headers: getAuthHeaders() }
      )

      addToast('success', `Novo prompt de ${metaPromptType === 'titulo' ? 'Título' : 'Descrição'} aplicado para ${activeClient.name}!`)
      setMetaResult(null)
      fetchInsights()
    } catch (err) {
      console.error('[ClientDashboard] Erro ao aplicar prompt:', err)
      addToast('error', 'Erro ao aplicar o novo prompt.')
    } finally {
      setIsApplying(false)
    }
  }

  if (!activeClient) return null

  if (loading) {
    return (
      <div className="card p-8 text-center text-xs space-y-2" style={{ color: 'var(--text-muted)' }}>
        <span className="login-spinner login-spinner-lg mx-auto" />
        <p>Calculando métricas e estatísticas de aprendizado do cliente...</p>
      </div>
    )
  }

  const titleStats = stats?.titleStats
  const descStats = stats?.descStats

  return (
    <div className="space-y-4">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card Total Gerações */}
        <div className="card p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-indigo)' }}>
            📊
          </div>
          <div>
            <p className="text-xs uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>Gerações Totais</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {stats?.totalGenerations ?? 0}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              em todos os tipos de campo
            </p>
          </div>
        </div>

        {/* Card Títulos */}
        <div className="card p-5 space-y-2" style={{ borderLeft: '4px solid var(--accent-indigo)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-semibold" style={{ color: 'var(--accent-indigo-light)' }}>🏷️ Títulos</span>
            <span className="text-sm font-bold" style={{ color: 'var(--accent-emerald)' }}>
              {titleStats?.approvalRate ?? 0}% aprovação
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>Aprovados: <strong>{titleStats?.approved + titleStats?.edited}</strong></span>
            <span>Rejeitados: <strong style={{ color: 'var(--accent-rose)' }}>{titleStats?.rejected}</strong></span>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Tam. médio: <strong>{titleStats?.avgApprovedLength ?? 0}</strong> chars (aprovados) vs <strong>{titleStats?.avgRejectedLength ?? 0}</strong> (rejeitados)
          </div>
        </div>

        {/* Card Descrições */}
        <div className="card p-5 space-y-2" style={{ borderLeft: '4px solid var(--accent-emerald)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-semibold" style={{ color: 'var(--accent-emerald)' }}>📄 Descrições</span>
            <span className="text-sm font-bold" style={{ color: 'var(--accent-emerald)' }}>
              {descStats?.approvalRate ?? 0}% aprovação
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>Aprovadas: <strong>{descStats?.approved + descStats?.edited}</strong></span>
            <span>Rejeitadas: <strong style={{ color: 'var(--accent-rose)' }}>{descStats?.rejected}</strong></span>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Tam. médio: <strong>{descStats?.avgApprovedLength ?? 0}</strong> chars (aprovadas) vs <strong>{descStats?.avgRejectedLength ?? 0}</strong> (rejeitadas)
          </div>
        </div>
      </div>

      {/* Meta-Prompting Section */}
      <div className="card p-5 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(52,211,153,0.04))', border: '1px solid rgba(99,102,241,0.2)' }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'var(--accent-indigo-glow)', color: 'var(--accent-indigo-light)' }}>
              🧠
            </div>
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Meta-Prompting — Refinamento Evolutivo com GPT-4o
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Analisa o histórico humano de feedbacks para propor reformulações inteligentes nos prompts do cliente.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleGenerateMetaPrompt('titulo')}
              disabled={metaLoading}
              className="btn-secondary text-xs py-2 px-3"
            >
              ✨ Otimizar Prompt Título
            </button>
            <button
              onClick={() => handleGenerateMetaPrompt('descricao')}
              disabled={metaLoading}
              className="btn-primary text-xs py-2 px-3"
            >
              ✨ Otimizar Prompt Descrição
            </button>
          </div>
        </div>

        {metaLoading && (
          <div className="flex items-center justify-center gap-3 py-8 rounded-xl" style={{ background: 'var(--bg-input)' }}>
            <span className="login-spinner login-spinner-lg" />
            <span className="text-sm font-medium" style={{ color: 'var(--accent-indigo-light)' }}>
              GPT-4o analisando histórico de aprovações e rejeições do cliente...
            </span>
          </div>
        )}

        {/* Modal/Resultado da Otimização */}
        {metaResult && !metaLoading && (
          <div className="space-y-4 rounded-xl p-5 animate-slideUp" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold" style={{ color: 'var(--accent-emerald)' }}>
                ✨ Sugestão de Prompt Otimizado ({metaPromptType === 'titulo' ? 'Título' : 'Descrição'})
              </h4>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Analisados {metaResult.samplesAnalyzed?.approvedCount ?? 0} aprovados e {metaResult.samplesAnalyzed?.rejectedCount ?? 0} rejeitados
              </span>
            </div>

            {/* Explicações */}
            {metaResult.explanation && (
              <div className="p-3 rounded-lg text-xs space-y-1" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: 'var(--accent-emerald)' }}>
                <p className="font-semibold">Melhorias identificadas pela IA:</p>
                <p className="whitespace-pre-line">{metaResult.explanation}</p>
              </div>
            )}

            {/* Comparativo de Prompts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Prompt Atual</label>
                <textarea
                  readOnly
                  value={metaResult.currentPrompt}
                  rows={8}
                  className="input-dark font-mono text-xs opacity-75"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--accent-emerald)' }}>Prompt Otimizado Proposto</label>
                <textarea
                  readOnly
                  value={metaResult.improvedPrompt}
                  rows={8}
                  className="input-dark font-mono text-xs"
                  style={{ borderColor: 'var(--accent-emerald)' }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={() => setMetaResult(null)} className="btn-secondary text-xs">
                Descartar
              </button>
              {auth.user?.role === 'admin' ? (
                <button
                  onClick={handleApplyImprovedPrompt}
                  disabled={isApplying}
                  className="btn-primary text-xs py-2 px-4"
                  style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                >
                  {isApplying ? 'Aplicando...' : '🚀 Aplicar Novo Prompt para o Cliente'}
                </button>
              ) : (
                <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                  (Apenas administradores podem aplicar novos prompts)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Recomendações Automáticas */}
      <div className="card p-5 space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          💡 Recomendações do Sistema
        </h4>

        {titleStats?.recommendations?.length === 0 && descStats?.recommendations?.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Nenhuma recomendação por enquanto. Continue avaliando os produtos gerados para acumular dados de aprendizado!
          </p>
        ) : (
          <div className="space-y-2">
            {[...(titleStats?.recommendations ?? []), ...(descStats?.recommendations ?? [])].map((rec, idx) => (
              <div key={idx} className="flex items-start gap-2.5 p-3 rounded-lg text-xs" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', color: 'var(--accent-amber)' }}>
                <span className="text-sm">📌</span>
                <p className="leading-relaxed">{rec}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
