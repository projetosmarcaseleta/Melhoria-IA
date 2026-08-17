import { useState, useEffect } from 'react'
import apiClient from '../services/apiClient'
import useStore from '../store/useStore'

export default function ClientSkillsManager() {
  const activeClient = useStore((s) => s.activeClient)
  const auth = useStore((s) => s.auth)
  const addToast = useStore((s) => s.addToast)

  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    if (activeClient?.id) {
      fetchSkills()
    }
  }, [activeClient?.id])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const res = await apiClient.get(`/api/skills/${activeClient.id}`)
      setSkills(res.data)
    } catch (err) {
      console.error('[ClientSkillsManager] Erro ao carregar skills:', err)
      addToast('error', 'Não consegui carregar as habilidades desse cliente.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSkill = (skillId) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, isActive: !s.isActive } : s))
    )
  }

  const handleConfigChange = (skillId, key, value) => {
    setSkills((prev) =>
      prev.map((s) =>
        s.id === skillId
          ? { ...s, config: { ...(s.config || {}), [key]: value } }
          : s
      )
    )
  }

  const handleSaveSkill = async (skill) => {
    try {
      setSavingId(skill.id)
      await apiClient.put(
        `/api/skills/${activeClient.id}/${skill.id}`,
        {
          isActive: skill.isActive,
          config: skill.config,
        }
      )
      addToast('success', `Pronto! Habilidade "${skill.name}" atualizada.`)
    } catch (err) {
      console.error('[ClientSkillsManager] Erro ao salvar skill:', err)
      addToast('error', 'Erro ao salvar habilidade.')
    } finally {
      setSavingId(null)
    }
  }

  if (!activeClient) return null

  if (loading) {
    return (
      <div className="card p-8 text-center text-xs space-y-2" style={{ color: 'var(--text-muted)' }}>
        <span className="login-spinner login-spinner-lg mx-auto" />
        <p>Carregando catálogo de habilidades do cliente...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--accent-amber)' }}>
            ⚡
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Habilidades do Agente de IA — {activeClient.name}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Ative e configure comportamentos especializados que são injetados automaticamente no pipeline de geração.
            </p>
          </div>
        </div>
      </div>

      {/* Grid de Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {skills.map((skill) => {
          const isActive = skill.isActive
          const isSaving = savingId === skill.id

          return (
            <div
              key={skill.id}
              className="card p-5 space-y-4 transition-all"
              style={{
                borderColor: isActive ? 'rgba(99,102,241,0.35)' : 'var(--border-subtle)',
                background: isActive ? 'rgba(99,102,241,0.02)' : 'var(--bg-card)',
              }}
            >
              {/* Skill Title & Toggle */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    {skill.name}
                  </h4>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {skill.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleSkill(skill.id)}
                  className="w-10 h-[22px] rounded-full transition-all relative shrink-0"
                  style={{ background: isActive ? 'var(--accent-indigo)' : 'rgba(255,255,255,0.1)' }}
                  title={isActive ? 'Habilidade ativa' : 'Habilidade desativada'}
                >
                  <div
                    className="w-[16px] h-[16px] rounded-full bg-white absolute top-[3px] transition-all"
                    style={{ left: isActive ? '21px' : '3px' }}
                  />
                </button>
              </div>

              {/* Skill Config Inputs */}
              {isActive && (
                <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {skill.id === 'anti_forbidden_words' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Palavras Banidas (separadas por vírgula)
                      </label>
                      <textarea
                        value={skill.config?.forbiddenWords ?? ''}
                        onChange={(e) => handleConfigChange(skill.id, 'forbiddenWords', e.target.value)}
                        rows={3}
                        className="input-dark font-mono text-xs"
                      />
                    </div>
                  )}

                  {skill.id === 'tone_of_voice' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Estilo de Tom de Voz
                      </label>
                      <select
                        value={skill.config?.toneStyle ?? 'Técnico, Direto e Objetivo'}
                        onChange={(e) => handleConfigChange(skill.id, 'toneStyle', e.target.value)}
                        className="input-dark text-xs"
                      >
                        <option value="Técnico, Direto e Objetivo">Técnico, Direto e Objetivo</option>
                        <option value="Comercial e Persuasivo">Comercial e Persuasivo</option>
                        <option value="Sofisticado e Premium">Sofisticado e Premium</option>
                        <option value="Descontraído e Moderno">Descontraído e Moderno</option>
                      </select>
                    </div>
                  )}

                  {skill.id === 'html_spec_formatter' && (
                    <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', color: 'var(--accent-emerald)' }}>
                      ✓ Padronizador HTML ativo: Garante formatação consistente com parágrafo introdutório e lista <code>&lt;ul&gt;&lt;li&gt;</code> em todas as descrições geradas.
                    </div>
                  )}

                  {skill.id === 'title_max_length' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Limite Máximo de Caracteres do Título
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={200}
                        value={skill.config?.maxLength ?? 60}
                        onChange={(e) => handleConfigChange(skill.id, 'maxLength', Number(e.target.value))}
                        className="input-dark text-xs w-28"
                      />
                      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        Além de instruir a IA, o backend corta deterministicamente por palavra inteira se o título gerado exceder esse limite.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Action Button — visível para todos */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleSaveSkill(skill)}
                  disabled={isSaving}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  {isSaving ? 'Salvando...' : '💾 Salvar Habilidade'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
