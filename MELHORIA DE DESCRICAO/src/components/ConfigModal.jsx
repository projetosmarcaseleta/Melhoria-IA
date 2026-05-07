import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import useStore from '../store/useStore'

export default function ConfigModal() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setConfigOpen = useStore((s) => s.setConfigOpen)

  const [form, setForm] = useState({ ...config })

  // ── Prompts ──────────────────────────────────────────────────────────────
  const [defaultPrompts, setDefaultPrompts] = useState(null)
  const [customPrompts, setCustomPrompts]   = useState(config.customPrompts ?? null)
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [promptsError, setPromptsError]     = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState('')
  const autoSaveTimer = useRef(null)

  // Carrega prompts default do servidor quando modo custom é selecionado
  useEffect(() => {
    if (form.promptMode === 'custom' && !defaultPrompts && !promptsLoading) {
      setPromptsLoading(true)
      setPromptsError('')
      axios.get('/edit/api/prompts')
        .then(({ data }) => {
          setDefaultPrompts(data)
          // Se não tem custom local, usa default como base
          if (!customPrompts) setCustomPrompts({ ...data })
        })
        .catch(() => setPromptsError('Não foi possível carregar os prompts.'))
        .finally(() => setPromptsLoading(false))
    }
  }, [form.promptMode])

  // Feature F: Auto-save custom prompts com debounce
  const debounceSave = useCallback((updatedPrompts) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setAutoSaveStatus('⏳ Salvando...')
    autoSaveTimer.current = setTimeout(() => {
      setConfig({ customPrompts: updatedPrompts })
      setAutoSaveStatus('✅ Salvo')
      setTimeout(() => setAutoSaveStatus(''), 2000)
    }, 1500)
  }, [setConfig])

  const updateCustomPrompt = (field, value) => {
    const updated = { ...customPrompts, [field]: value }
    setCustomPrompts(updated)
    debounceSave(updated)
  }

  const save = () => {
    setConfig({
      ...form,
      customPrompts: form.promptMode === 'custom' ? customPrompts : config.customPrompts,
    })
    setConfigOpen(false)
  }

  // ── Seção config de IA ──────────────────────────────────────────────────
  const SectionAI = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--accent-indigo-glow)' }}>🤖</div>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Provedor de IA</h3>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Escolha o modelo que processará seus produtos</p>
        </div>
      </div>

      <div className="toggle-pill">
        <button type="button" className={`toggle-pill-option ${form.aiProvider === 'openai' ? 'active' : ''}`}
          onClick={() => setForm({ ...form, aiProvider: 'openai' })}>
          🟢 Default — ChatGPT
        </button>
        <button type="button" className={`toggle-pill-option ${form.aiProvider === 'gemini' ? 'active' : ''}`}
          onClick={() => setForm({ ...form, aiProvider: 'gemini' })}>
          ✨ Personalizado — Gemini
        </button>
      </div>

      {form.aiProvider === 'openai' ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{ background: 'rgba(52, 211, 153, 0.08)', border: '1px solid rgba(52, 211, 153, 0.15)' }}>
          <span className="text-sm">✅</span>
          <p className="text-xs" style={{ color: 'var(--accent-emerald)' }}>
            <strong>ChatGPT (gpt-4o-mini)</strong> selecionado. A chave API é gerenciada via <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>.env</code> no servidor.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Chave API do Google Gemini</label>
          <input type="password" value={form.geminiApiKey ?? ''} onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
            placeholder="AIza..." className="input-dark" />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Obtenha em <span style={{ color: 'var(--accent-indigo-light)' }}>aistudio.google.com</span> • Armazenada no navegador
          </p>
        </div>
      )}
    </div>
  )

  // ── Seção Controles de Campos ───────────────────────────────────────────
  const SectionFieldControls = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--accent-amber-glow)' }}>📝</div>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Controle de Campos</h3>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Defina quais campos serão processados e substituídos</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Títulos */}
        <button type="button" onClick={() => setForm({ ...form, applyTitles: !form.applyTitles })}
          className="relative text-left px-4 py-4 rounded-xl transition-all"
          style={{
            background: form.applyTitles ? 'var(--accent-indigo-glow)' : 'var(--bg-input)',
            border: `1.5px solid ${form.applyTitles ? 'rgba(99,102,241,0.4)' : 'var(--border-default)'}`,
          }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">🏷️</span>
            <div className="w-10 h-[22px] rounded-full transition-all relative"
              style={{ background: form.applyTitles ? 'var(--accent-indigo)' : 'rgba(255,255,255,0.1)' }}>
              <div className="w-[16px] h-[16px] rounded-full bg-white absolute top-[3px] transition-all"
                style={{ left: form.applyTitles ? '21px' : '3px' }} />
            </div>
          </div>
          <p className="text-sm font-semibold" style={{ color: form.applyTitles ? 'var(--accent-indigo-light)' : 'var(--text-secondary)' }}>Todos os Títulos</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {form.applyTitles ? 'IA gerará novos títulos para todos os produtos' : 'Títulos originais serão mantidos'}
          </p>
        </button>

        {/* Descrições */}
        <button type="button" onClick={() => setForm({ ...form, applyDescriptions: !form.applyDescriptions })}
          className="relative text-left px-4 py-4 rounded-xl transition-all"
          style={{
            background: form.applyDescriptions ? 'var(--accent-emerald-glow)' : 'var(--bg-input)',
            border: `1.5px solid ${form.applyDescriptions ? 'rgba(52,211,153,0.4)' : 'var(--border-default)'}`,
          }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">📄</span>
            <div className="w-10 h-[22px] rounded-full transition-all relative"
              style={{ background: form.applyDescriptions ? 'var(--accent-emerald)' : 'rgba(255,255,255,0.1)' }}>
              <div className="w-[16px] h-[16px] rounded-full bg-white absolute top-[3px] transition-all"
                style={{ left: form.applyDescriptions ? '21px' : '3px' }} />
            </div>
          </div>
          <p className="text-sm font-semibold" style={{ color: form.applyDescriptions ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>Todas as Descrições</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {form.applyDescriptions ? 'IA gerará novas descrições para todos' : 'Descrições originais serão mantidas'}
          </p>
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.12)' }}>
        <span className="text-xs">💡</span>
        <p className="text-[11px]" style={{ color: 'var(--accent-amber)' }}>
          {form.applyTitles && form.applyDescriptions ? 'Ambos serão processados pela IA e substituídos.'
            : form.applyTitles ? 'Apenas títulos serão substituídos — descrições originais mantidas.'
            : form.applyDescriptions ? 'Apenas descrições serão substituídas — títulos originais mantidos.'
            : 'Nenhum campo selecionado — ative ao menos um.'}
        </p>
      </div>
    </div>
  )

  // ── Seção Prompts ───────────────────────────────────────────────────────
  const SectionPrompts = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--accent-rose-glow)' }}>✏️</div>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Prompts da IA</h3>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Controle as instruções enviadas ao modelo</p>
        </div>
      </div>

      <div className="toggle-pill">
        <button type="button" className={`toggle-pill-option ${form.promptMode === 'default' ? 'active' : ''}`}
          onClick={() => setForm({ ...form, promptMode: 'default' })}>
          📋 Prompt Default
        </button>
        <button type="button" className={`toggle-pill-option ${form.promptMode === 'custom' ? 'active' : ''}`}
          onClick={() => setForm({ ...form, promptMode: 'custom' })}>
          ✨ Prompt Personalizado
        </button>
      </div>

      {form.promptMode === 'default' ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg" style={{ background: 'rgba(52, 211, 153, 0.08)', border: '1px solid rgba(52, 211, 153, 0.15)' }}>
          <span className="text-sm">✅</span>
          <p className="text-xs" style={{ color: 'var(--accent-emerald)' }}>
            Usando prompts padrão otimizados para SEO e conversão definidos no servidor.
          </p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Use <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '3px' }}>{'{{title}}'}</code>,{' '}
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '3px' }}>{'{{description}}'}</code> e{' '}
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '3px' }}>{'{{characteristics}}'}</code> como variáveis.
            </p>
            {autoSaveStatus && (
              <span className="text-[10px] font-medium" style={{ color: autoSaveStatus.includes('✅') ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                {autoSaveStatus}
              </span>
            )}
          </div>

          {promptsError && (
            <div className="px-3 py-2 rounded-md text-xs" style={{ background: 'var(--accent-rose-glow)', color: 'var(--accent-rose)' }}>
              {promptsError}
            </div>
          )}

          {promptsLoading ? (
            <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Carregando prompts...</div>
          ) : customPrompts ? (
            <>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prompt — Descrição</label>
                <textarea value={customPrompts.descricao} onChange={(e) => updateCustomPrompt('descricao', e.target.value)}
                  rows={8} className="input-dark font-mono text-xs resize-y" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Prompt — Título</label>
                <textarea value={customPrompts.titulo} onChange={(e) => updateCustomPrompt('titulo', e.target.value)}
                  rows={6} className="input-dark font-mono text-xs resize-y" />
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>💾 Os prompts personalizados são salvos automaticamente no cache local do navegador.</p>
            </>
          ) : null}
        </div>
      )}
    </div>
  )

  // ── Seção Notificações ──────────────────────────────────────────────────
  const SectionNotifications = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--accent-cyan-glow)' }}>🔔</div>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Notificações</h3>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Alertas quando processos em lote terminam</p>
        </div>
      </div>

      <button type="button" onClick={() => setForm({ ...form, soundNotification: !form.soundNotification })}
        className="w-full text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between"
        style={{
          background: form.soundNotification ? 'var(--accent-cyan-glow)' : 'var(--bg-input)',
          border: `1.5px solid ${form.soundNotification ? 'rgba(34,211,238,0.3)' : 'var(--border-default)'}`,
        }}>
        <div>
          <p className="text-sm font-medium" style={{ color: form.soundNotification ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
            🔊 Som + Notificação do browser
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Toca um som sutil e mostra notificação ao finalizar lotes
          </p>
        </div>
        <div className="w-10 h-[22px] rounded-full transition-all relative"
          style={{ background: form.soundNotification ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)' }}>
          <div className="w-[16px] h-[16px] rounded-full bg-white absolute top-[3px] transition-all"
            style={{ left: form.soundNotification ? '21px' : '3px' }} />
        </div>
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-overlayFade" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="animate-slideUp w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-lg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-indigo-glow)' }}>
              <span className="text-base">⚙️</span>
            </div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Configurações</h2>
          </div>
          <button onClick={() => setConfigOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-colors" style={{ color: 'var(--text-muted)', background: 'transparent' }}
            onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}>×</button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-1 overflow-y-auto flex-1">
          <SectionAI />
          <div className="section-divider" />
          <SectionPrompts />
          <div className="section-divider" />
          <SectionNotifications />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex justify-end gap-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={() => setConfigOpen(false)} className="btn-secondary">Cancelar</button>
          <button onClick={save} className="btn-primary">
            💾 Salvar configurações
          </button>
        </div>
      </div>
    </div>
  )
}
