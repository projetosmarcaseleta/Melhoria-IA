import { useState } from 'react'
import useStore from '../store/useStore'
import Icon from './icons/Icon'
import { Button, IconButton } from './ui/primitives'

/**
 * Estado do token da AnyMarket.
 *
 * Antes esta barra ocupava a faixa nobre da página de produtos em tamanho de
 * herói, permanentemente, para um valor definido uma vez — e escrevia só em
 * `config.gumgaToken`, enquanto quem publica lê
 * `activeClient.anymarket_token || config.gumgaToken`. Ou seja: "Alterar" aqui
 * não surtia efeito quando o cliente já tinha token próprio cadastrado.
 *
 * Agora: discreta quando está tudo certo, grande só quando falta o token (aí
 * ela é a coisa mais importante da tela, porque nada publica sem ele), e a
 * edição de um token existente vai para o ConfigModal, que grava nos dois
 * lugares. A faixa também diz DE ONDE vem o token que está valendo.
 */
export default function TokenBar() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const activeClient = useStore((s) => s.activeClient)
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const addToast = useStore((s) => s.addToast)

  const [tempToken, setTempToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  const clientToken = activeClient?.anymarket_token ?? ''
  const localToken = config.gumgaToken ?? ''
  // Mesma precedência usada em ReviewPanel.handleApproveAndPublish.
  const activeToken = clientToken || localToken
  const origem = clientToken ? 'cadastrado no cliente' : 'salvo neste navegador'

  const handleSave = () => {
    const t = tempToken.trim()
    if (!t) return
    setConfig({ gumgaToken: t })
    setTempToken('')
    addToast('success', 'Token salvo neste navegador.')
  }

  // ── Sem token: bloqueia o trabalho, então aparece em destaque ──
  if (!activeToken) {
    return (
      <div className="animate-fadeIn flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 rounded-2xl border"
        style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.04))', borderColor: 'rgba(245,158,11,0.35)' }}>
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-amber-300"
          style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <Icon name="key" size={17} />
        </span>

        <div className="flex-1 min-w-0">
          <p className="t-card text-amber-200">Falta o token da AnyMarket</p>
          <p className="t-meta">Sem ele o CRIA gera os anúncios, mas não consegue publicar.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={tempToken}
              onChange={(e) => setTempToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              placeholder="Cole o gumgaToken"
              className="w-full sm:w-64 pl-3 pr-9 py-2 bg-slate-950 border border-slate-700 rounded-xl text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <Icon name={showToken ? 'eyeOff' : 'eye'} size={15} />
            </button>
          </div>
          <Button variant="primary" icon="check" onClick={handleSave} disabled={!tempToken.trim()}>
            Salvar
          </Button>
        </div>
      </div>
    )
  }

  // ── Com token: uma linha discreta ──
  return (
    <div className="animate-fadeIn flex items-center gap-3 px-4 py-2 bg-slate-900/60 border border-slate-800 rounded-xl">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent-emerald)', boxShadow: '0 0 8px rgba(16,185,129,0.6)' }} />
      <Icon name="key" size={14} className="text-slate-400" />
      <span className="t-body">Token AnyMarket conectado</span>
      <span className="t-meta">· {origem}</span>

      <span className="t-mono truncate hidden md:inline ml-1" style={{ color: 'var(--text-muted)' }}>
        {showToken ? activeToken : '•'.repeat(Math.min(activeToken.length, 24))}
      </span>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <IconButton
          icon={showToken ? 'eyeOff' : 'eye'}
          label={showToken ? 'Ocultar token' : 'Mostrar token'}
          onClick={() => setShowToken((v) => !v)}
        />
        <Button size="sm" variant="ghost" icon="gear" onClick={() => setConfigOpen(true)}>
          Alterar
        </Button>
      </div>
    </div>
  )
}
