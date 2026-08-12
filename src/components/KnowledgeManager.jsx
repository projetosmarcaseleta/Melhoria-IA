import { useState, useEffect } from 'react'
import axios from 'axios'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || ''

function getAuthHeaders() {
  const session = useStore.getState().auth.session
  if (!session?.access_token) {
    throw new Error('Usuário não autenticado.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

export default function KnowledgeManager() {
  const activeClient = useStore((s) => s.activeClient)
  const addToast = useStore((s) => s.addToast)

  const [documents, setDocuments] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showRulesTab, setShowRulesTab] = useState(false)

  useEffect(() => {
    if (activeClient?.id) {
      fetchDocuments()
      fetchRules()
    }
  }, [activeClient?.id])

  const fetchDocuments = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`${API_BASE}/api/knowledge/${activeClient.id}`, {
        headers: getAuthHeaders(),
      })
      setDocuments(res.data)
    } catch (err) {
      console.warn('[KnowledgeManager] Aviso ao carregar documentos:', err.message)
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  const fetchRules = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/knowledge/${activeClient.id}/rules`, {
        headers: getAuthHeaders(),
      })
      setRules(res.data)
    } catch (err) {
      console.warn('[KnowledgeManager] Aviso ao carregar regras:', err.message)
      setRules([])
    }
  }

  const handleFileUpload = async (file) => {
    if (!file) return
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
      addToast('warning', 'Selecione apenas arquivos Markdown (.md) ou Texto (.txt).')
      return
    }

    try {
      setUploading(true)
      const text = await file.text()

      const res = await axios.post(
        `${API_BASE}/api/knowledge/${activeClient.id}`,
        {
          filename: file.name,
          content: text,
        },
        {
          headers: getAuthHeaders(),
        }
      )

      addToast('success', res.data.message || `Documento "${file.name}" indexado com sucesso!`)
      fetchDocuments()
      fetchRules()
    } catch (err) {
      console.error('[KnowledgeManager] Erro no upload:', err)
      addToast('error', err.response?.data?.error || 'Erro ao processar documento RAG.')
    } finally {
      setUploading(false)
    }
  }

  const handleToggleRuleStatus = async (ruleId, currentStatus) => {
    const action = currentStatus === 'approved' ? 'reject' : 'approve'
    try {
      await axios.post(`${API_BASE}/api/knowledge/${activeClient.id}/rules/${ruleId}/${action}`, {}, {
        headers: getAuthHeaders(),
      })
      addToast('success', action === 'approve' ? 'Regra aprovada com sucesso.' : 'Regra desativada.')
      fetchRules()
    } catch (err) {
      console.error('[KnowledgeManager] Erro ao alterar regra:', err)
      addToast('error', 'Erro ao atualizar regra.')
    }
  }

  const handleDelete = async (docId, filename) => {
    if (!confirm(`Deseja realmente excluir o documento "${filename}" e suas regras?`)) return

    try {
      await axios.delete(`${API_BASE}/api/knowledge/${activeClient.id}/${docId}`, {
        headers: getAuthHeaders(),
      })
      addToast('success', `Documento "${filename}" e regras removidas.`)
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      fetchRules()
    } catch (err) {
      console.error('[KnowledgeManager] Erro ao deletar:', err)
      addToast('error', 'Erro ao deletar documento.')
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFileUpload(file)
  }

  if (!activeClient) {
    return null
  }

  const TYPE_BADGES = {
    fixed_text:            { label: '📌 Texto Fixo', bg: 'rgba(52,211,153,0.15)', color: '#34d399', border: 'rgba(52,211,153,0.3)' },
    prohibition:           { label: '🚫 Proibição', bg: 'rgba(244,63,94,0.15)', color: '#f87171', border: 'rgba(244,63,94,0.3)' },
    mandatory_instruction: { label: '⚖️ Instrução Obrigatória', bg: 'rgba(99,102,241,0.15)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' },
    formatting:            { label: '📐 Formatação', bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
    category_template:     { label: '🏷️ Template Categoria', bg: 'rgba(192,132,252,0.15)', color: '#c084fc', border: 'rgba(192,132,252,0.3)' },
  }

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-indigo)' }}>
            📚
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Base de Conhecimento RAG & Regras — {activeClient.name}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Arquivos <code className="px-1 py-0.5 rounded bg-white/10 text-[11px]">.md</code> são indexados e a IA extrai automaticamente textos fixos, proibições e instruções.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRulesTab(!showRulesTab)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5"
            style={{
              background: showRulesTab ? 'rgba(99,102,241,0.2)' : 'var(--bg-input)',
              borderColor: showRulesTab ? 'var(--accent-indigo)' : 'var(--border-default)',
              color: showRulesTab ? 'var(--accent-indigo-light)' : 'var(--text-secondary)',
            }}
          >
            <span>⚡ Regras Extraídas</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/10">
              {rules.length}
            </span>
          </button>
          <span className="badge" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent-indigo-light)', border: '1px solid rgba(99,102,241,0.2)' }}>
            {documents.length} documento(s)
          </span>
        </div>
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer relative"
        style={{
          borderColor: dragOver ? 'var(--accent-indigo)' : 'var(--border-default)',
          background: dragOver ? 'rgba(99,102,241,0.08)' : 'var(--bg-input)',
        }}
      >
        <input
          type="file"
          accept=".md,.txt"
          onChange={(e) => handleFileUpload(e.target.files[0])}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          disabled={uploading}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-3 py-2">
            <span className="login-spinner" />
            <span className="text-sm font-medium" style={{ color: 'var(--accent-indigo-light)' }}>
              Indexando Markdown, gerando embeddings e extraindo regras estruturadas via IA...
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            <span className="text-3xl">📄</span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Clique aqui ou arraste um arquivo <code className="px-1.5 py-0.5 rounded bg-white/10 text-xs">.md</code> para indexar
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Diretrizes de estilo, blocos institucionais fixos, regras de SEO e tabelas de categorias
            </p>
          </div>
        )}
      </div>

      {/* Visão Alternada: Documentos vs Regras */}
      {showRulesTab ? (
        <div className="space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Regras Estruturadas Detectadas ({rules.length})
            </h4>
            <p className="text-[11px] text-slate-400">
              Textos fixos (institucionais) são inseridos pelo backend automaticamente ao estarem aprovados.
            </p>
          </div>

          {rules.length === 0 ? (
            <div className="py-6 text-center text-xs rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-tertiary)' }}>
              Nenhuma regra extraída ainda. Faça upload de um arquivo .md acima para extrair regras automaticamente!
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {rules.map((rule) => {
                const tb = TYPE_BADGES[rule.type] || { label: rule.type, bg: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: 'rgba(255,255,255,0.1)' }
                const isApproved = rule.status === 'approved'

                return (
                  <div
                    key={rule.id}
                    className="p-3.5 rounded-xl border transition-all space-y-2"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: isApproved ? 'rgba(52,211,153,0.3)' : 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border"
                          style={{ background: tb.bg, color: tb.color, borderColor: tb.border }}
                        >
                          {tb.label}
                        </span>

                        <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                          {rule.name}
                        </span>

                        {rule.scopes?.map((s) => (
                          <span key={s} className="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase bg-slate-800 text-slate-300">
                            {s}
                          </span>
                        ))}
                      </div>

                      <button
                        onClick={() => handleToggleRuleStatus(rule.id, rule.status)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                          isApproved
                            ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 hover:bg-rose-500/20 hover:border-rose-500 hover:text-rose-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-emerald-600/20 hover:border-emerald-500 hover:text-emerald-300'
                        }`}
                      >
                        {isApproved ? '✅ Aprovada (Ativa)' : '⏸️ Inativa (Aprovar)'}
                      </button>
                    </div>

                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {rule.description || rule.content}
                    </p>

                    {rule.sourceQuote && (
                      <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] font-mono text-slate-400 truncate">
                        <span className="text-slate-500 font-bold">Origem: </span>"{rule.sourceQuote}"
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Lista de Documentos */
        <div>
          {loading ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Carregando documentos RAG...
            </div>
          ) : documents.length === 0 ? (
            <div className="py-6 text-center text-xs rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-tertiary)' }}>
              Nenhum documento .md cadastrado para este cliente. Adicione um arquivo acima para enriquecer as gerações!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl transition-all" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm" style={{ background: 'rgba(52,211,153,0.1)', color: 'var(--accent-emerald)' }}>
                      📝
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={doc.filename}>
                        {doc.filename}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {doc.chunkCount ?? 0} chunk(s) • {doc.ruleCount ?? 0} regra(s) • {(doc.charCount ?? 0).toLocaleString()} chars
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id, doc.filename)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors hover:bg-rose-500/20 hover:text-rose-400"
                    style={{ color: 'var(--text-muted)' }}
                    title="Excluir documento RAG"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
