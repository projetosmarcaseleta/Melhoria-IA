import { useEffect, useState, useCallback } from 'react'
import useStore from '../store/useStore'
import { fetchCurrentCategory } from '../services/categoryService'
import {
  fetchClientMarketplaces,
  fetchCategoryAttributes,
  extractAttributesWithAI,
  saveProductAttributes,
} from '../services/channelBindingService'
import { parallelProcess } from '../utils/batchUtils'
import Icon from './icons/Icon'

/**
 * Etapa "Atributos" do PipelineWizard — substitui o placeholder.
 *
 * 3 passos internos:
 *   canal    — operador escolhe qual marketplace quer preencher
 *   gerando  — para cada produto: busca categoria → atributos → IA preenche
 *   revisao  — cards de revisão com edição inline e aprovação por produto / em lote
 */

const CANAL_ICONES = {
  MERCADO_LIVRE: '🛒',
  B2W: '🛍',
  VIA_VAREJO: '🏪',
  AMAZON: '📦',
  MAGAZINE_LUIZA: '🔷',
}

function iconeCanal(code) {
  return CANAL_ICONES[String(code ?? '').toUpperCase()] ?? '🌐'
}

function nomeCanal(mp) {
  if (!mp) return '—'
  return mp.name || mp.code || mp.marketplace || String(mp)
}

// ─────────────────────────────────────────────────────────────────────────────
// Passo 1 — Seleção de Canal
// ─────────────────────────────────────────────────────────────────────────────
function PassoCanal({ clientId, onSelect }) {
  const [canais, setCanais] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let cancelado = false
    fetchClientMarketplaces(clientId)
      .then((res) => { if (!cancelado) setCanais(res.marketplaces ?? []) })
      .catch((err) => { if (!cancelado) setErro(err.message ?? 'Falha ao carregar canais.') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [clientId])

  if (carregando) return <p className="text-xs text-slate-400 py-6 text-center">Carregando canais configurados…</p>
  if (erro) return <p className="text-xs text-rose-400 py-4 text-center">{erro}</p>
  if (!canais?.length) {
    return (
      <div className="rounded-xl px-4 py-8 text-center border border-dashed border-slate-700 bg-white/[0.02] space-y-2">
        <Icon name="info" size={20} className="mx-auto text-slate-500" />
        <p className="font-semibold text-slate-300 text-sm">Nenhum canal configurado</p>
        <p className="text-xs text-slate-500">Configure os canais deste cliente antes de preencher atributos em lote.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-slate-300 mb-4">
        Selecione o marketplace para o qual você quer preencher os atributos dos produtos selecionados.
      </p>
      <div className="space-y-2">
        {canais.map((mp) => {
          const code = mp.code ?? mp.marketplace ?? String(mp)
          return (
            <button
              key={code}
              onClick={() => onSelect(mp)}
              className="w-full text-left flex items-center gap-3 rounded-xl p-3.5 border transition-all bg-white/[0.02] border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/[0.06] group"
            >
              <span className="text-2xl">{iconeCanal(code)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                  {nomeCanal(mp)}
                </span>
                <span className="block text-xs text-slate-500">{code}</span>
              </span>
              <Icon name="arrowRight" size={14} className="text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Passo 2 — Geração em lote com IA
// ─────────────────────────────────────────────────────────────────────────────
function PassoGerando({ clientId, canal, products, onConcluir }) {
  const addToast = useStore((s) => s.addToast)
  const [log, setLog] = useState([])
  const [progresso, setProgresso] = useState(0)
  const [concluido, setConcluido] = useState(false)
  const [resultados, setResultados] = useState([])
  const total = products.length

  const canalCode = canal.code ?? canal.marketplace ?? String(canal)

  const addLog = useCallback((productId, msg, tipo = 'info') => {
    setLog((prev) => [...prev, { productId, msg, tipo }])
  }, [])

  useEffect(() => {
    let cancelado = false

    async function gerar() {
      const res = []
      await parallelProcess(products, 3, async (p) => {
        if (cancelado) return
        const pid = p.id
        addLog(pid, `⏳ Buscando categoria do produto #${pid}…`)

        let categoryId = null
        let categoryPath = null
        try {
          const cat = await fetchCurrentCategory(clientId, pid)
          categoryId = cat?.id ? String(cat.id) : null
          categoryPath = cat?.fullPath ?? cat?.name ?? null
        } catch {
          addLog(pid, `⚠ Não foi possível ler a categoria — produto ignorado.`, 'warn')
          setProgresso((n) => n + 1)
          res.push({ productId: pid, title: p.title, skipped: true, motivo: 'sem_categoria' })
          return
        }

        if (!categoryId) {
          addLog(pid, `⚠ Produto sem categoria no AnyMarket — ignorado.`, 'warn')
          setProgresso((n) => n + 1)
          res.push({ productId: pid, title: p.title, skipped: true, motivo: 'sem_categoria' })
          return
        }

        addLog(pid, `🔍 Buscando atributos da categoria em ${nomeCanal(canal)}…`)

        let atributos = []
        try {
          const resp = await fetchCategoryAttributes(clientId, categoryId, {
            marketplace: canalCode,
            withValues: true,
          })
          atributos = resp?.attributes ?? []
        } catch {
          addLog(pid, `⚠ Falha ao buscar atributos — produto ignorado.`, 'warn')
          setProgresso((n) => n + 1)
          res.push({ productId: pid, title: p.title, categoryId, categoryPath, skipped: true, motivo: 'sem_atributos' })
          return
        }

        if (!atributos.length) {
          addLog(pid, `ℹ️ Categoria sem atributos neste canal — ignorado.`)
          setProgresso((n) => n + 1)
          res.push({ productId: pid, title: p.title, categoryId, categoryPath, skipped: true, motivo: 'sem_atributos' })
          return
        }

        addLog(pid, `✨ Gerando com IA (${atributos.filter((a) => a.required).length} obrigatórios)…`)

        let extracted = []
        try {
          const aiRes = await extractAttributesWithAI(clientId, {
            productId: pid,
            title: p.newTitle || p.title || null,
            description: p.newDescription || p.description || null,
            characteristics: p.characteristics || null,
            attributes: atributos,
            scope: 'required',
          })
          extracted = aiRes.extracted ?? []
        } catch {
          addLog(pid, `⚠ IA falhou — você pode preencher manualmente na revisão.`, 'warn')
        }

        const aiValues = Object.fromEntries(extracted.map((e) => [e.name, e.value]))
        addLog(
          pid,
          extracted.length
            ? `✅ ${extracted.length} atributo(s) preenchido(s) pela IA.`
            : `ℹ️ IA não encontrou dados — revise manualmente.`,
          extracted.length ? 'success' : 'info'
        )

        setProgresso((n) => n + 1)
        res.push({
          productId: pid,
          title: p.newTitle || p.title,
          categoryId,
          categoryPath,
          atributos,
          aiValues,
          editValues: { ...aiValues },
          salvo: false,
          rejeitado: false,
          skipped: false,
        })
      })

      if (!cancelado) {
        setResultados(res)
        setConcluido(true)
        const ignorados = res.filter((r) => r.skipped)
        if (ignorados.length) addToast('info', `${ignorados.length} produto(s) ignorados (sem categoria ou atributos no canal).`)
        if (!res.filter((r) => !r.skipped).length) addToast('warning', 'Nenhum produto com atributos para revisar neste canal.')
      }
    }

    gerar()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = total > 0 ? Math.round((progresso / total) * 100) : 0

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-300">
            {concluido ? 'Geração concluída!' : `Gerando… ${progresso}/${total}`}
          </p>
          <span className="text-xs text-slate-500">{pct}%</span>
        </div>
        <div className="w-full rounded-full h-1.5 bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: concluido
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : 'linear-gradient(90deg, #6366f1, #a855f7)',
            }}
          />
        </div>
      </div>

      <div
        className="rounded-xl border border-slate-800 max-h-64 overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.25)' }}
      >
        {log.length === 0 && <p className="text-xs text-slate-500 px-4 py-3 text-center">Aguardando…</p>}
        {log.map((entry, i) => (
          <div
            key={i}
            className={`px-3.5 py-1.5 text-[11px] border-b border-slate-800/50 last:border-0 ${
              entry.tipo === 'warn' ? 'text-amber-400' :
              entry.tipo === 'success' ? 'text-emerald-400' :
              'text-slate-400'
            }`}
          >
            <span className="text-slate-600 mr-2 font-mono">#{entry.productId}</span>
            {entry.msg}
          </div>
        ))}
      </div>

      {concluido && (
        <button
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          onClick={() => onConcluir(resultados)}
        >
          <Icon name="arrowRight" size={14} />
          Ver revisão ({resultados.filter((r) => !r.skipped).length} produto(s))
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Campo de atributo individual na tela de revisão
// ─────────────────────────────────────────────────────────────────────────────
function CampoAtributoRevisao({ attr, valor, onChange }) {
  const required = Boolean(attr.required)
  const labelClass = `text-[11px] shrink-0 w-36 truncate ${required ? 'text-amber-300' : 'text-slate-400'}`
  const badge = required ? <span className="ml-1 text-amber-400 text-[9px] font-bold">OBRIG.</span> : null

  if (attr.valueType === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={valor === 'true' || valor === true}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="w-3.5 h-3.5 rounded border-slate-700 accent-indigo-500"
        />
        <span className={labelClass}>{attr.name}{badge}</span>
      </label>
    )
  }

  const allowedValues = Array.isArray(attr.allowedValues)
    ? attr.allowedValues.map((v) => typeof v === 'object' ? (v.value ?? v.name ?? v.description ?? v.id ?? String(v)) : v).filter(Boolean)
    : []

  if (attr.valueType === 'LIST' && allowedValues.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <span className={labelClass}>{attr.name}{badge}</span>
        <select
          value={valor ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2 py-1 text-[11px] rounded bg-slate-900 border border-slate-700 text-slate-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">— selecione —</option>
          {allowedValues.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className={labelClass}>{attr.name}{badge}</span>
      <input
        type={attr.valueType === 'NUMBER' ? 'number' : 'text'}
        value={valor ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="flex-1 px-2.5 py-1 text-[11px] rounded bg-slate-900 border border-slate-700 text-slate-200 focus:border-indigo-500 focus:outline-none"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card de produto na tela de revisão
// ─────────────────────────────────────────────────────────────────────────────
function CardProdutoAtributos({ item, onEditar, onAprovar, onRejeitar }) {
  const { productId, title, categoryPath, atributos, editValues, salvo, rejeitado } = item
  const [aberto, setAberto] = useState(true)

  const obrigatorios = atributos.filter((a) => Boolean(a.required))
  const opcionais = atributos.filter((a) => !a.required)
  const faltando = obrigatorios.filter((a) => !String(editValues[a.name] ?? '').trim())

  if (salvo) {
    return (
      <div className="rounded-xl px-4 py-3 border border-emerald-500/30 bg-emerald-500/[0.05] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-emerald-400 text-base">✅</span>
          <div>
            <p className="text-[12px] font-semibold text-emerald-300">{title || `Produto #${productId}`}</p>
            <p className="text-[10px] text-emerald-600">Gravado com sucesso</p>
          </div>
        </div>
        <span className="text-[10px] text-emerald-600 font-mono">#{productId}</span>
      </div>
    )
  }

  if (rejeitado) {
    return (
      <div className="rounded-xl px-4 py-3 border border-slate-700 bg-white/[0.02] flex items-center justify-between gap-3 opacity-40">
        <div className="flex items-center gap-2.5">
          <span className="text-slate-500 text-base">❌</span>
          <p className="text-[12px] text-slate-500">{title || `Produto #${productId}`}</p>
        </div>
        <span className="text-[10px] text-slate-600">Descartado</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setAberto((v) => !v)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm">📦</span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-slate-200 truncate">{title || `Produto #${productId}`}</p>
            {categoryPath && <p className="text-[10px] text-slate-500 truncate">{categoryPath}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {faltando.length > 0 && (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
              ⚠ {faltando.length} obrig. vazio(s)
            </span>
          )}
          <Icon name={aberto ? 'chevronDown' : 'chevronRight'} size={13} className="text-slate-500" />
        </div>
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
          {obrigatorios.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-2 font-bold">Obrigatórios</p>
              <div className="space-y-1.5">
                {obrigatorios.map((attr) => (
                  <CampoAtributoRevisao
                    key={attr.name}
                    attr={attr}
                    valor={editValues[attr.name] ?? ''}
                    onChange={(v) => onEditar(productId, attr.name, v)}
                  />
                ))}
              </div>
            </div>
          )}

          {opcionais.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors font-bold mt-1 mb-2 select-none">
                Opcionais & Recomendados ({opcionais.length}) ▶
              </summary>
              <div className="space-y-1.5 mt-2">
                {opcionais.map((attr) => (
                  <CampoAtributoRevisao
                    key={attr.name}
                    attr={attr}
                    valor={editValues[attr.name] ?? ''}
                    onChange={(v) => onEditar(productId, attr.name, v)}
                  />
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={() => onRejeitar(productId)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-rose-400 border border-rose-500/30 bg-rose-500/[0.06] hover:bg-rose-500/10 transition-colors"
            >
              ❌ Descartar
            </button>
            <button
              onClick={() => onAprovar(productId)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-emerald-300 border border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/10 transition-colors"
            >
              ✅ Aprovar e gravar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Passo 3 — Revisão e aprovação
// ─────────────────────────────────────────────────────────────────────────────
function PassoRevisao({ clientId, resultados: resultadosIniciais }) {
  const addToast = useStore((s) => s.addToast)
  const [itens, setItens] = useState(resultadosIniciais.filter((r) => !r.skipped))
  const [gravandoTodos, setGravandoTodos] = useState(false)

  const editarValor = (productId, attrName, valor) => {
    setItens((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? { ...item, editValues: { ...item.editValues, [attrName]: valor } }
          : item
      )
    )
  }

  const aprovar = async (productId) => {
    const item = itens.find((i) => i.productId === productId)
    if (!item) return
    const updates = Object.entries(item.editValues)
      .filter(([, v]) => String(v ?? '').trim())
      .map(([name, value]) => ({ name, value }))
    if (!updates.length) { addToast('info', 'Nenhum atributo preenchido para gravar.'); return }
    try {
      await saveProductAttributes(clientId, productId, updates)
      setItens((prev) => prev.map((i) => (i.productId === productId ? { ...i, salvo: true } : i)))
      addToast('success', `✅ ${updates.length} atributo(s) gravado(s) para #${productId}.`)
    } catch (err) {
      addToast('error', err.response?.data?.error ?? err.message ?? `Falha ao gravar #${productId}.`)
    }
  }

  const rejeitar = (productId) => {
    setItens((prev) => prev.map((i) => (i.productId === productId ? { ...i, rejeitado: true } : i)))
  }

  const aprovarTodos = async () => {
    const pendentes = itens.filter((i) => !i.salvo && !i.rejeitado)
    if (!pendentes.length) { addToast('info', 'Nenhum produto pendente.'); return }
    setGravandoTodos(true)
    try {
      await parallelProcess(pendentes, 4, async (item) => {
        const updates = Object.entries(item.editValues)
          .filter(([, v]) => String(v ?? '').trim())
          .map(([name, value]) => ({ name, value }))
        if (!updates.length) return
        try {
          await saveProductAttributes(clientId, item.productId, updates)
          setItens((prev) => prev.map((i) => (i.productId === item.productId ? { ...i, salvo: true } : i)))
        } catch (err) {
          addToast('error', `Falha ao gravar #${item.productId}: ${err.message}`)
        }
      })
      addToast('success', '✅ Todos os atributos aprovados foram gravados!')
    } finally {
      setGravandoTodos(false)
    }
  }

  const pendentes = itens.filter((i) => !i.salvo && !i.rejeitado)
  const salvos = itens.filter((i) => i.salvo)

  if (!itens.length) {
    return (
      <div className="rounded-xl px-4 py-10 text-center border border-dashed border-slate-700 bg-white/[0.02] space-y-2">
        <Icon name="info" size={20} className="mx-auto text-slate-500" />
        <p className="font-semibold text-slate-300 text-sm">Nenhum produto com atributos para revisar</p>
        <p className="text-xs text-slate-500">Todos os produtos foram ignorados (sem categoria ou atributos neste canal).</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Resumo + Aprovar Todos */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-white/[0.02]">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            <span className="text-slate-200 font-bold">{itens.length}</span> produto(s)
          </span>
          {salvos.length > 0 && <span className="text-emerald-400">✅ {salvos.length} gravado(s)</span>}
          {pendentes.length > 0 && <span className="text-amber-400">⏳ {pendentes.length} pendente(s)</span>}
        </div>
        {pendentes.length > 0 && (
          <button
            onClick={aprovarTodos}
            disabled={gravandoTodos}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold text-white border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-60 transition-colors"
          >
            {gravandoTodos ? <><span className="animate-spin inline-block">⟳</span> Gravando todos…</> : <>✅ Aprovar todos ({pendentes.length})</>}
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {itens.map((item) => (
          <CardProdutoAtributos
            key={item.productId}
            item={item}
            onEditar={editarValor}
            onAprovar={aprovar}
            onRejeitar={rejeitar}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal exportado
// ─────────────────────────────────────────────────────────────────────────────
export default function PipelineAttributesStage({ clientId, products }) {
  const [passo, setPasso] = useState('canal') // 'canal' | 'gerando' | 'revisao'
  const [canal, setCanal] = useState(null)
  const [resultados, setResultados] = useState([])

  const handleSelectCanal = (mp) => { setCanal(mp); setPasso('gerando') }
  const handleConcluirGeracao = (res) => { setResultados(res); setPasso('revisao') }
  const handleVoltarParaCanal = () => { setCanal(null); setResultados([]); setPasso('canal') }

  const PASSOS = [
    { key: 'canal', label: 'Canal' },
    { key: 'gerando', label: 'Gerando' },
    { key: 'revisao', label: 'Revisão' },
  ]
  const indexAtual = PASSOS.findIndex((p) => p.key === passo)

  return (
    <div className="space-y-4">
      {/* Indicador de passos */}
      <div className="flex items-center gap-0 mb-2">
        {PASSOS.map((p, i) => (
          <div key={p.key} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                i < indexAtual
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : i === indexAtual
                  ? 'text-indigo-300 bg-indigo-500/15 border border-indigo-500/30'
                  : 'text-slate-600 bg-transparent'
              }`}
            >
              {i < indexAtual ? <Icon name="check" size={10} /> : <span>{i + 1}</span>}
              <span className="ml-1">{p.label}</span>
            </div>
            {i < PASSOS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < indexAtual ? 'bg-emerald-500/40' : 'bg-slate-800'}`} />
            )}
          </div>
        ))}
        {canal && passo !== 'canal' && (
          <button
            onClick={handleVoltarParaCanal}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            ↩ Trocar canal
          </button>
        )}
      </div>

      {/* Contexto do canal selecionado */}
      {canal && passo !== 'canal' && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-white/[0.02]">
          <span>{iconeCanal(canal.code ?? canal.marketplace ?? '')}</span>
          <span className="text-[11px] text-slate-300 font-medium">{nomeCanal(canal)}</span>
          <span className="text-[10px] text-slate-500 ml-auto">{products.length} produto(s)</span>
        </div>
      )}

      {passo === 'canal' && <PassoCanal clientId={clientId} onSelect={handleSelectCanal} />}
      {passo === 'gerando' && canal && (
        <PassoGerando clientId={clientId} canal={canal} products={products} onConcluir={handleConcluirGeracao} />
      )}
      {passo === 'revisao' && (
        <PassoRevisao clientId={clientId} resultados={resultados} />
      )}
    </div>
  )
}
