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
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    if (activeClient?.id) {
      fetchDocuments()
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
    } catch (err) {
      console.error('[KnowledgeManager] Erro no upload:', err)
      addToast('error', err.response?.data?.error || 'Erro ao processar documento RAG.')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId, filename) => {
    if (!confirm(`Deseja realmente excluir o documento "${filename}"?`)) return

    try {
      await axios.delete(`${API_BASE}/api/knowledge/${activeClient.id}/${docId}`, {
        headers: getAuthHeaders(),
      })
      addToast('success', `Documento "${filename}" removido.`)
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
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
              Base de Conhecimento RAG — {activeClient.name}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Importe arquivos <code>.md</code> de diretrizes da marca, catálogos ou manuais. A IA buscará os contextos mais relevantes a cada geração.
            </p>
          </div>
        </div>
        <span className="badge" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent-indigo-light)', border: '1px solid rgba(99,102,241,0.2)' }}>
          {documents.length} documento(s)
        </span>
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
              Processando Markdown, gerando chunks e embeddings via OpenAI...
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            <span className="text-3xl">📄</span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Clique aqui ou arraste um arquivo <code className="px-1.5 py-0.5 rounded bg-white/10 text-xs">.md</code> para indexar
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Suporta diretrizes de estilo, FAQs de produtos, tabelas de medidas e regras de SEO da marca
            </p>
          </div>
        )}
      </div>

      {/* Document List */}
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
                    {doc.chunkCount ?? 0} chunk(s) indexado(s) • {(doc.charCount ?? 0).toLocaleString()} chars
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
  )
}
