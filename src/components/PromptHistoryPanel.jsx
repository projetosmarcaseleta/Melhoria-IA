import { useEffect, useState } from 'react'
import apiClient from '../services/apiClient'
import useStore from '../store/useStore'

/**
 * Histórico e restauração de prompt.
 *
 * Existe porque a edição de prompt foi liberada para TODOS os operadores, e o que torna
 * isso seguro não é a restrição de perfil — é poder voltar atrás. As rotas de histórico
 * e restauração existiam sem alcance na interface: rede de segurança que ninguém
 * conseguia puxar.
 *
 * Cada gravação arquiva a versão anterior; restaurar também arquiva a que está saindo.
 * Nenhum estado se perde, então o operador pode experimentar sem medo.
 */
export default function PromptHistoryPanel({ clientId, type, onRestored }) {
  const addToast = useStore((s) => s.addToast)

  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [versoes, setVersoes] = useState([])
  const [restaurando, setRestaurando] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = async () => {
    setCarregando(true)
    setErro('')
    try {
      const { data } = await apiClient.get(`/api/prompts/${clientId}/history/${type}`)
      setVersoes(data.versoes ?? [])
    } catch (err) {
      setErro(err.response?.data?.error ?? err.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (aberto) carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, clientId, type])

  const restaurar = async (payload, rotulo) => {
    if (!confirm(`Restaurar ${rotulo}? A versão atual será arquivada e poderá ser recuperada depois.`)) return

    setRestaurando(rotulo)
    try {
      const { data } = await apiClient.post(`/api/prompts/${clientId}/restore`, { type, ...payload })
      addToast('success', data.message ?? 'Prompt restaurado.')
      await carregar()
      onRestored?.()
    } catch (err) {
      addToast('error', err.response?.data?.error ?? err.message)
    } finally {
      setRestaurando(null)
    }
  }

  const rotuloTipo = type === 'descricao' ? 'Descrição' : 'Título'

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle, #2a2a35)' }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-white transition-colors"
      >
        <span>{aberto ? '▾' : '▸'}</span>
        <span>🕐 Histórico de versões de {rotuloTipo}</span>
        {versoes.length > 0 && <span className="text-slate-600">({versoes.length})</span>}
      </button>

      {aberto && (
        <div className="mt-2.5 space-y-2">
          {carregando && <p className="text-[11px] text-slate-400">Carregando histórico…</p>}
          {erro && <p className="text-[11px] text-rose-400">{erro}</p>}

          {!carregando && !erro && versoes.length === 0 && (
            <p className="text-[11px] text-slate-500">
              Nenhuma versão arquivada ainda. O histórico começa a partir da próxima alteração salva.
            </p>
          )}

          {versoes.map((v) => (
            <div
              key={v.id}
              className="flex items-start justify-between gap-3 p-2.5 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle, #2a2a35)' }}
            >
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-200">
                  Versão {v.version}
                  <span className="font-normal text-slate-500">
                    {' · '}
                    {v.archivedAt ? new Date(v.archivedAt).toLocaleString('pt-BR') : 'data desconhecida'}
                    {v.replacedByName ? ` · substituída por ${v.replacedByName}` : ''}
                    {` · ${v.charCount} chars`}
                  </span>
                </p>
                <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">{v.preview}…</p>
              </div>

              <button
                type="button"
                onClick={() => restaurar({ historyId: v.id }, `a versão ${v.version}`)}
                disabled={restaurando !== null}
                className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border disabled:opacity-50"
                style={{ background: 'rgba(79,70,229,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' }}
              >
                {restaurando === `a versão ${v.version}` ? '…' : 'Restaurar'}
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => restaurar({ useDefault: true }, 'o padrão do sistema')}
            disabled={restaurando !== null}
            className="w-full mt-1 px-3 py-2 rounded-lg text-[11px] font-bold border disabled:opacity-50"
            style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}
          >
            ↺ Voltar ao padrão do sistema (descarta a personalização deste cliente)
          </button>
        </div>
      )}
    </div>
  )
}
