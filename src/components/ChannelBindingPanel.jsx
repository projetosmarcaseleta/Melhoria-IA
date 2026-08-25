import { useCallback, useEffect, useState } from 'react'
import useStore from '../store/useStore'
import {
  fetchBindingStatus,
  fetchBindSuggestions,
  fetchChannelTree,
  applyChannelBinding,
  fetchCategoryAttributes,
  fetchProductAttributeStatus,
  saveProductAttributes,
  extractAttributesWithAI,
  proposeChannelBindings,
  applyChannelBindingsBatch,
} from '../services/channelBindingService'

/**
 * Painel "Canais e Atributos" de uma categoria do AnyMarket.
 *
 * Duas etapas, na ordem que a publicação exige (ver
 * docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §4.5):
 *
 *   1. CANAIS   — por marketplace, se a categoria tem de-para. Sem de-para, o produto
 *                 não publica, e essa era exatamente a lacuna deixada pela criação de
 *                 categoria ("categoria nova nasce sem de-para de canal").
 *   2. ATRIBUTOS — só depois de vinculado, porque a obrigatoriedade vem POR CANAL.
 *                  Obrigatórios primeiro; opcionais colapsados.
 *
 * O fluxo de vínculo oferece as sugestões da AnyMarket primeiro e o drill-down manual
 * como alternativa — e registra qual dos dois foi usado, para dar para medir depois
 * se as sugestões valem a pena.
 */
export default function ChannelBindingPanel({ clientId, anymarketCategoryId, categoryPath = null, productId = null, product = null }) {
  const addToast = useStore((s) => s.addToast)

  const [status, setStatus] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [erroCode, setErroCode] = useState(null)
  const [canalEmVinculo, setCanalEmVinculo] = useState(null)
  const [canalAtributos, setCanalAtributos] = useState(null)
  // Fluxo automático ligado por padrão quando há canal pendente: é o caminho principal.
  const [autoAberto, setAutoAberto] = useState(true)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    setErroCode(null)
    try {
      setStatus(await fetchBindingStatus(clientId, anymarketCategoryId))
    } catch (err) {
      setErro(err.response?.data?.error ?? err.message)
      setErroCode(err.response?.data?.code ?? null)
    } finally {
      setCarregando(false)
    }
  }, [clientId, anymarketCategoryId])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  const handleVinculado = (marketplace, resultado) => {
    setCanalEmVinculo(null)
    addToast('success', `De-para de ${rotuloCanal(marketplace)} salvo: ${resultado.completePath}`)
    // Vínculo novo limpa os atributos vinculados do canal (é o que
    // cleanBoundAttributes faz) — então a etapa de atributos vem em seguida.
    setCanalAtributos(marketplace)
    recarregar()
  }

  if (carregando) {
    return <p className="text-xs text-slate-400 py-3">Consultando o de-para de cada canal no AnyMarket…</p>
  }

  if (erro) {
    return (
      <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.3)' }}>
        <p className="font-bold text-rose-400 mb-1">Não foi possível ler os vínculos de canal</p>
        <p className="text-slate-300 break-words">{erro}</p>

        {/* A §1 usa a API não documentada do painel. Quando ela muda — ou quando recusa
            o token, que é o comportamento medido hoje — o CRIA não tem como consertar
            sozinho: o operador precisa saber que o caminho manual continua valendo, em
            vez de encarar isso como bug do CRIA. */}
        {(erroCode === 'internal_contract_changed' || erroCode === 'panel_token_unsupported') && (
          <p className="text-[11px] text-amber-400 mt-2">
            {erroCode === 'panel_token_unsupported'
              ? 'A API interna do painel não aceita o token de API. Faça o de-para na tela "Vínculo de Categorias" do painel do AnyMarket.'
              : 'A AnyMarket parece ter mudado a tela de vínculo de categorias. Faça o de-para direto no painel e avise o time — o CRIA precisa de ajuste.'}
          </p>
        )}

        <button onClick={recarregar} className="mt-2 px-3 py-1.5 rounded-md text-[11px] font-bold text-white" style={{ background: '#4f46e5' }}>
          Tentar de novo
        </button>
      </div>
    )
  }

  if (!status?.channels?.length) {
    return (
      <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,0.03)', color: '#9a9ab0' }}>
        Nenhum canal configurado para este cliente e nenhum de-para existente nesta categoria. Cadastre os canais do
        cliente (campo <strong>marketplaces</strong>) para o CRIA saber o que checar.
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Canais {categoryPath ? <span className="text-slate-600">· {categoryPath}</span> : null}
        </p>
        <button onClick={recarregar} className="text-[11px] text-slate-400 hover:text-white">
          ⟳ reconferir
        </button>
      </div>

      {/* Plano B (docs/GUIA_CAPTURA_CHAMADAS_PAINEL_ANYMARKET.md): quando a API interna
          do painel não responde ao token, o CRIA continua DETECTANDO o que falta, mas a
          ação de vincular é do operador, na tela do AnyMarket. Dizer isso é melhor que
          oferecer um botão "Vincular" que vai falhar. */}
      {status.hubUnavailable && (
        <div
          className="rounded-lg px-3 py-2.5 mb-3 text-[11px]"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#fbbf24' }}
        >
          {status.categoryNotFound ? (
            <>
              <p className="font-bold mb-1">⚠ Esta categoria não existe mais no AnyMarket</p>
              <p className="text-slate-300">
                A categoria atual do produto foi deletada do AnyMarket. O estado abaixo é o último conhecido pelo CRIA.
                Abra o painel e mova o produto para uma categoria válida.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold mb-1">O vínculo precisa ser feito no painel do AnyMarket</p>
              <p className="text-slate-300">
                {status.hubError?.message ??
                  'A API interna do painel não respondeu — o CRIA não consegue gravar o de-para por aqui.'}
              </p>
              <p className="text-slate-400 mt-1">
                O estado abaixo é o <strong>último conhecido</strong> pelo CRIA, não uma conferência de agora.
              </p>
            </>
          )}
          {status.panelUrl && (
            <a
              href={status.panelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 px-2.5 py-1 rounded-md font-bold border"
              style={{ borderColor: 'rgba(245,158,11,0.5)', color: '#fbbf24' }}
            >
              Abrir painel do AnyMarket ↗
            </a>
          )}
        </div>
      )}

      {status.pendingCount > 0 && (
        <div
          className="rounded-lg px-3 py-2 mb-3 text-[11px]"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}
        >
          {status.pendingCount === 1 ? '1 canal sem de-para' : `${status.pendingCount} canais sem de-para`} — o produto
          não publica nesses canais até o vínculo existir.
        </div>
      )}

      {status.degraded && (
        <p className="text-[11px] text-amber-400 mb-2">
          ⚠ O estado foi lido do AnyMarket, mas o espelho local não pôde ser gravado (Firestore indisponível).
        </p>
      )}

      {/* Caminho principal: o CRIA resolve e o operador confirma. A lista de canais
          abaixo continua como painel de estado e porta de entrada do ajuste manual. */}
      {autoAberto && status.canBindHere !== false && status.pendingCount > 0 && (
        <div className="mb-3">
          <AutoBindStep
            clientId={clientId}
            anymarketCategoryId={anymarketCategoryId}
            canais={status.channels.filter((c) => !c.bound && !c.unexpected).map((c) => c.marketplace)}
            onDone={() => {
              setAutoAberto(false)
              recarregar()
            }}
            onAjustar={(marketplace) => setCanalEmVinculo(marketplace)}
          />
        </div>
      )}

      {!autoAberto && status.pendingCount > 0 && (
        <button
          onClick={() => setAutoAberto(true)}
          className="w-full mb-3 px-3 py-2 rounded-lg text-xs font-bold border"
          style={{ background: 'rgba(79,70,229,0.15)', borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc' }}
        >
          ✨ Resolver os {status.pendingCount} canais pendentes automaticamente
        </button>
      )}

      <div className="space-y-1.5">
        {status.channels.map((channel) => (
          <div
            key={channel.marketplace}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle, #2a2a35)' }}
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                {rotuloCanal(channel.marketplace)}
                <BadgeVinculo channel={channel} />
                {channel.unexpected && <span className="text-[10px] text-slate-500">(fora dos canais do cliente)</span>}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {channel.bound ? (
                  <>
                    {channel.completePath ?? '(sem caminho)'} <span className="text-slate-600">· {channel.codeInMarketPlace}</span>
                  </>
                ) : channel.removed ? (
                  'vínculo desfeito no painel — precisa ser refeito'
                ) : (
                  'sem de-para nesta categoria'
                )}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {channel.bound && (
                <button
                  onClick={() => setCanalAtributos(canalAtributos === channel.marketplace ? null : channel.marketplace)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-bold border"
                  style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border-subtle, #2a2a35)', color: '#cbd5e1' }}
                >
                  Atributos
                </button>
              )}
              <button
                onClick={() => setCanalEmVinculo(canalEmVinculo === channel.marketplace ? null : channel.marketplace)}
                disabled={status.canBindHere === false}
                title={status.canBindHere === false ? 'Indisponível: o de-para precisa ser feito no painel do AnyMarket.' : undefined}
                className="px-2.5 py-1 rounded-md text-[11px] font-bold border disabled:opacity-40 disabled:cursor-not-allowed"
                style={
                  channel.bound
                    ? { background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border-subtle, #2a2a35)', color: '#cbd5e1' }
                    : { background: 'rgba(79,70,229,0.15)', borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc' }
                }
              >
                {channel.bound ? 'Trocar' : 'Vincular'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {canalEmVinculo && (
        <BindFlow
          clientId={clientId}
          anymarketCategoryId={anymarketCategoryId}
          marketplace={canalEmVinculo}
          jaVinculado={status.channels.find((c) => c.marketplace === canalEmVinculo)?.bound}
          onCancel={() => setCanalEmVinculo(null)}
          onDone={(resultado) => handleVinculado(canalEmVinculo, resultado)}
        />
      )}

      {canalAtributos && (
        <AttributesStep
          clientId={clientId}
          anymarketCategoryId={anymarketCategoryId}
          marketplace={canalAtributos}
          productId={productId}
          product={product}
          onClose={() => setCanalAtributos(null)}
        />
      )}
    </div>
  )
}

const rotuloCanal = (marketplace) =>
  String(marketplace ?? '')
    .split('_')
    .map((parte) => parte.charAt(0) + parte.slice(1).toLowerCase())
    .join(' ')

function BadgeVinculo({ channel }) {
  const estilo = channel.bound
    ? { background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#34d399' }
    : { background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.35)', color: '#fbbf24' }

  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border" style={estilo}>
      {channel.bound ? '✓ vinculado' : '⚠ pendente'}
    </span>
  )
}

/**
 * Sub-fluxo de vínculo: sugestões primeiro, drill-down manual como alternativa.
 *
 * A distinção não é cosmética — `source` viaja até a API como `suggestionAccepted`.
 */
function BindFlow({ clientId, anymarketCategoryId, marketplace, jaVinculado, onCancel, onDone }) {
  const addToast = useStore((s) => s.addToast)

  const [modo, setModo] = useState('suggestions') // suggestions | manual
  const [sugestoes, setSugestoes] = useState(null)
  const [nivel, setNivel] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(null)
  const [erro, setErro] = useState(null)
  const [retrySafe, setRetrySafe] = useState(false)

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)
      setErro(null)
      try {
        if (modo === 'suggestions') {
          const data = await fetchBindSuggestions(clientId, anymarketCategoryId, marketplace)
          if (!cancelado) setSugestoes(data.suggestions ?? [])
        } else if (!nivel) {
          const data = await fetchChannelTree(clientId, marketplace, null)
          if (!cancelado) setNivel(data)
        }
      } catch (err) {
        if (!cancelado) setErro(err.response?.data?.error ?? err.message)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [clientId, anymarketCategoryId, marketplace, modo])

  const navegar = async (code) => {
    setCarregando(true)
    setErro(null)
    try {
      setNivel(await fetchChannelTree(clientId, marketplace, code))
    } catch (err) {
      setErro(err.response?.data?.error ?? err.message)
    } finally {
      setCarregando(false)
    }
  }

  const salvar = async ({ codeInMarketPlace, completePath, source }) => {
    setSalvando(codeInMarketPlace)
    setErro(null)
    setRetrySafe(false)
    try {
      const resultado = await applyChannelBinding(clientId, {
        anymarketCategoryId,
        marketplace,
        codeInMarketPlace,
        completePath,
        source,
      })
      onDone(resultado)
    } catch (err) {
      const data = err.response?.data
      setErro(data?.error ?? err.message)
      // O cenário da §5: a limpeza de atributos foi feita e o vínculo não. Dizer que
      // o retry é seguro é a diferença entre o operador tentar de novo e ele achar
      // que precisa consertar algo no painel.
      setRetrySafe(Boolean(data?.detail?.retrySafe))
      if (data?.code === 'bind_failed_after_clean') {
        addToast('error', 'Vínculo ficou pela metade — clique de novo para concluir (a limpeza não será repetida).')
      }
    } finally {
      setSalvando(null)
    }
  }

  return (
    <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-indigo-300">
          {jaVinculado ? 'Trocar' : 'Vincular'} de-para em {rotuloCanal(marketplace)}
        </p>
        <button onClick={onCancel} className="text-[11px] text-slate-400 hover:text-white">
          fechar
        </button>
      </div>

      {jaVinculado && (
        <p className="text-[11px] text-amber-400 mb-2">
          Trocar o de-para LIMPA os atributos já vinculados deste canal nesta categoria — eles precisarão ser
          reconfigurados.
        </p>
      )}

      <div className="flex gap-1.5 mb-2">
        {[
          ['suggestions', 'Sugestões da AnyMarket'],
          ['manual', 'Escolher na árvore do canal'],
        ].map(([valor, rotulo]) => (
          <button
            key={valor}
            onClick={() => setModo(valor)}
            className="px-2.5 py-1 rounded-md text-[11px] font-bold border"
            style={
              modo === valor
                ? { background: 'rgba(99,102,241,0.25)', borderColor: 'rgba(99,102,241,0.6)', color: '#c7d2fe' }
                : { background: 'transparent', borderColor: 'var(--border-subtle, #2a2a35)', color: '#94a3b8' }
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-md px-2.5 py-2 mb-2 text-[11px]" style={{ background: 'rgba(244,63,94,0.10)', color: '#fda4af' }}>
          {erro}
          {retrySafe && <div className="mt-1 font-bold text-amber-300">Tentar de novo é seguro: a limpeza não será repetida.</div>}
        </div>
      )}

      {carregando && <p className="text-[11px] text-slate-400 py-2">Consultando o canal…</p>}

      {!carregando && modo === 'suggestions' && (
        <div className="space-y-1">
          {!sugestoes?.length && (
            <p className="text-[11px] text-slate-400">
              A AnyMarket não sugeriu nenhuma categoria para este canal. Use a árvore do canal para escolher.
            </p>
          )}
          {sugestoes?.map((s) => (
            <div key={s.codeInMarketPlace} className="flex items-center justify-between gap-2 py-1">
              <span className="text-[11px] text-slate-300 truncate">
                {s.completePath ?? s.name}
                <span className="text-slate-500">
                  {typeof s.percentage === 'number' ? ` · ${s.percentage.toFixed(0)}% de confiança` : ''} · {s.codeInMarketPlace}
                </span>
              </span>
              <button
                disabled={salvando !== null}
                onClick={() => salvar({ codeInMarketPlace: s.codeInMarketPlace, completePath: s.completePath ?? s.name, source: 'suggestion' })}
                className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold border disabled:opacity-50"
                style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}
              >
                {salvando === s.codeInMarketPlace ? 'salvando…' : 'Usar esta'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!carregando && modo === 'manual' && nivel && (
        <div>
          <div className="flex flex-wrap items-center gap-1 mb-2 text-[11px]">
            <button onClick={() => navegar(null)} className="text-indigo-300 hover:text-indigo-200">
              raiz
            </button>
            {nivel.path?.map((p) => (
              <span key={p.codeInMarketPlace} className="flex items-center gap-1">
                <span className="text-slate-600">›</span>
                <button onClick={() => navegar(p.codeInMarketPlace)} className="text-indigo-300 hover:text-indigo-200">
                  {p.name}
                </button>
              </span>
            ))}
          </div>

          {/* `canBeSelected` só vem preenchido para o NÍVEL ATUAL — na lista de filhos a
              AnyMarket devolve o campo ausente (medido em conta real). Por isso o botão
              de vincular fica aqui, no nó aberto, e as linhas abaixo são navegação: o
              operador abre a categoria e então vincula. Nem toda folha é selecionável, e
              nem todo nó selecionável é folha. */}
          {nivel.canBeSelected && (
            <button
              disabled={salvando !== null}
              onClick={() => salvar({ codeInMarketPlace: nivel.codeInMarketPlace, completePath: nivel.completePath, source: 'manual' })}
              className="w-full mb-2 px-3 py-1.5 rounded-md text-[11px] font-bold border disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}
            >
              {salvando ? 'salvando…' : `Vincular nesta categoria: ${nivel.name}`}
            </button>
          )}

          {nivel.isReceivingItens === false && (
            <p className="text-[11px] text-amber-400 mb-2">
              ⚠ Esta categoria do canal não está recebendo itens. O de-para é aceito, mas o anúncio pode ser recusado.
            </p>
          )}

          <div className="space-y-0.5 max-h-52 overflow-y-auto">
            {!nivel.childs?.length && <p className="text-[11px] text-slate-500">Este nível não tem subcategorias.</p>}
            {nivel.childs?.map((filho) => (
              <div key={filho.codeInMarketPlace} className="flex items-center justify-between gap-2">
                <button
                  onClick={() => navegar(filho.codeInMarketPlace)}
                  className="text-[11px] text-slate-300 hover:text-white truncate text-left"
                >
                  {filho.name} <span className="text-slate-600">· {filho.codeInMarketPlace}</span>
                </button>
                {filho.canBeSelected && (
                  <button
                    disabled={salvando !== null}
                    onClick={() => salvar({ codeInMarketPlace: filho.codeInMarketPlace, completePath: filho.completePath, source: 'manual' })}
                    className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold border disabled:opacity-50"
                    style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}
                  >
                    {salvando === filho.codeInMarketPlace ? '…' : 'vincular'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Etapa de atributos do canal: obrigatórios primeiro, opcionais colapsados.
 *
 * Com `productId`, mostra também o que falta preencher NESTE produto e permite
 * gravar. Sem produto, é só a lista do que o canal exige na categoria.
 */
function AttributesStep({ clientId, anymarketCategoryId, marketplace, productId, product = null, onClose }) {
  const addToast = useStore((s) => s.addToast)

  const [dados, setDados] = useState(null)
  const [valores, setValores] = useState({})
  const [preenchidos, setPreenchidos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [carregandoValores, setCarregandoValores] = useState(false)
  const [gerandoEscopo, setGerandoEscopo] = useState(null) // null | 'required' | 'optional' | 'all'
  const [menuIAAberto, setMenuIAAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)
  const [caveat, setCaveat] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)
      setErro(null)
      try {
        const atributos = await fetchCategoryAttributes(clientId, anymarketCategoryId, { marketplace, withValues: true })
        if (cancelado) return
        setDados(atributos)
        setCarregando(false)

        if (productId) {
          setCarregandoValores(true)
          try {
            const statusProduto = await fetchProductAttributeStatus(clientId, productId, {
              categoryId: anymarketCategoryId,
              marketplaces: [marketplace],
            })
            if (cancelado) return
            setPreenchidos(statusProduto.filled ?? [])
            setCaveat(statusProduto.caveat ?? null)
            setValores(
              Object.fromEntries((statusProduto.filled ?? []).map((item) => [item.name, item.value ?? '']))
            )
          } catch (errProd) {
            console.warn('[AttributesStep] Não foi possível carregar atributos do produto:', errProd)
          } finally {
            if (!cancelado) setCarregandoValores(false)
          }
        }
      } catch (err) {
        if (!cancelado) {
          setErro(err.response?.data?.error ?? err.message)
          setCarregando(false)
        }
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [clientId, anymarketCategoryId, marketplace, productId])

  const obrigatorios = (dados?.attributes ?? []).filter((a) => Boolean(a.required))
  const opcionais = (dados?.attributes ?? []).filter((a) => !a.required)
  const faltando = obrigatorios.filter((a) => !String(valores[a.name] ?? '').trim())

  const gerarComIA = async (scope = 'all') => {
    setMenuIAAberto(false)
    if (!dados?.attributes?.length) return

    let alvoAtributos = dados.attributes
    if (scope === 'required') {
      alvoAtributos = obrigatorios
      if (!alvoAtributos.length) {
        addToast('info', 'Esta categoria não possui atributos obrigatórios para este canal.')
        return
      }
    } else if (scope === 'optional') {
      alvoAtributos = opcionais
      if (!alvoAtributos.length) {
        addToast('info', 'Esta categoria não possui atributos opcionais para este canal.')
        return
      }
    }

    setGerandoEscopo(scope)
    try {
      const res = await extractAttributesWithAI(clientId, {
        productId,
        title: product?.newTitle || product?.title || null,
        description: product?.newDescription || product?.description || null,
        characteristics: product?.characteristics || null,
        attributes: alvoAtributos,
        scope,
      })

      const extracted = res.extracted ?? []
      if (!extracted.length) {
        addToast('info', 'A IA não identificou informações para esses atributos no texto do produto.')
        return
      }

      const novosValores = {}
      extracted.forEach((item) => {
        novosValores[item.name] = item.value
      })

      setValores((prev) => ({
        ...prev,
        ...novosValores,
      }))

      const rotuloEscopo =
        scope === 'required'
          ? 'obrigatório(s)'
          : scope === 'optional'
          ? 'opcional(is)'
          : 'atributo(s) (obrigatórios e opcionais)'

      addToast('success', `✨ IA preencheu ${extracted.length} ${rotuloEscopo}!`)
    } catch (err) {
      addToast('error', err.response?.data?.error ?? err.message ?? 'Falha ao gerar atributos com IA.')
    } finally {
      setGerandoEscopo(null)
    }
  }

  const salvar = async () => {
    const originais = new Map(preenchidos.map((item) => [item.name, item.value ?? '']))
    const updates = Object.entries(valores)
      .filter(([name, value]) => String(value ?? '') !== String(originais.get(name) ?? ''))
      .map(([name, value]) => ({ name, value }))

    if (!updates.length) {
      addToast('info', 'Nenhum atributo alterado.')
      return
    }

    setSalvando(true)
    try {
      await saveProductAttributes(clientId, productId, updates)
      setPreenchidos(updates.reduce((acc, u) => {
        const outros = acc.filter((item) => item.name !== u.name)
        return [...outros, { name: u.name, value: u.value }]
      }, preenchidos))
      addToast('success', `${updates.length} atributo(s) gravado(s) no produto ${productId}.`)
    } catch (err) {
      addToast('error', err.response?.data?.error ?? err.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg px-4 py-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle, #2a2a35)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-slate-200">Atributos em {rotuloCanal(marketplace)}</p>
          {dados?.attributes && (
            <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
              {dados.attributes.length} {dados.attributes.length === 1 ? 'atributo' : 'atributos'}
            </span>
          )}
          {carregandoValores && (
            <span className="text-[10px] text-indigo-400 animate-pulse">
              (carregando valores do produto…)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {dados?.attributes?.length > 0 && (
            <div className="relative">
              <div className="inline-flex rounded-md shadow-sm">
                <button
                  onClick={() => gerarComIA('required')}
                  disabled={Boolean(gerandoEscopo) || carregando}
                  title="Preencher com IA os atributos obrigatórios com base no título e descrição"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-l-md text-[11px] font-bold text-white border border-r-0 border-purple-500/40 hover:border-purple-400 disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
                >
                  <span>{gerandoEscopo ? '⟳' : '✨'}</span>
                  <span>
                    {gerandoEscopo === 'required'
                      ? 'Preenchendo Obrigatórios…'
                      : gerandoEscopo === 'all'
                      ? 'Preenchendo Todos…'
                      : gerandoEscopo === 'optional'
                      ? 'Preenchendo Opcionais…'
                      : 'Preencher Obrigatórios com IA'}
                  </span>
                </button>

                <button
                  onClick={() => setMenuIAAberto((prev) => !prev)}
                  disabled={Boolean(gerandoEscopo) || carregando}
                  title="Outras opções de preenchimento com IA"
                  className="px-2 py-1 rounded-r-md text-[10px] font-bold text-white border border-purple-500/40 hover:border-purple-300 disabled:opacity-50 transition-all border-l border-white/20"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #9333ea 100%)' }}
                >
                  ▼
                </button>
              </div>

              {/* Menu Dropdown de Opções de IA */}
              {menuIAAberto && (
                <div
                  className="absolute right-0 mt-1 w-64 rounded-lg shadow-xl py-1 z-30 border"
                  style={{ background: '#181824', borderColor: '#3b3b4f' }}
                >
                  <button
                    onClick={() => gerarComIA('required')}
                    className="w-full text-left px-3 py-2 text-[11px] text-amber-300 hover:bg-white/5 flex items-center justify-between"
                  >
                    <span>⭐ Só Obrigatórios</span>
                    <span className="text-[10px] text-slate-500">({obrigatorios.length})</span>
                  </button>
                  <button
                    onClick={() => gerarComIA('all')}
                    className="w-full text-left px-3 py-2 text-[11px] text-indigo-300 hover:bg-white/5 flex items-center justify-between border-t border-slate-800"
                  >
                    <span>✨ Todos (Obrigatórios + Opcionais)</span>
                    <span className="text-[10px] text-slate-500">({dados.attributes.length})</span>
                  </button>
                  <button
                    onClick={() => gerarComIA('optional')}
                    className="w-full text-left px-3 py-2 text-[11px] text-slate-300 hover:bg-white/5 flex items-center justify-between border-t border-slate-800"
                  >
                    <span>💡 Só Opcionais & Recomendados</span>
                    <span className="text-[10px] text-slate-500">({opcionais.length})</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/5">
            ✕ fechar
          </button>
        </div>
      </div>

      {carregando && (
        <div className="py-4 text-center">
          <div className="inline-block animate-spin text-indigo-400 text-lg mb-1">⟳</div>
          <p className="text-[11px] text-slate-400">Lendo os atributos da categoria…</p>
        </div>
      )}
      {erro && <p className="text-[11px] text-rose-400 py-2">{erro}</p>}

      {!carregando && !erro && !dados?.attributes?.length && (
        <p className="text-[11px] text-slate-400 py-2">
          Esta categoria não tem atributos cadastrados para este canal
          {dados?.unlinkedGroups ? ` (${dados.unlinkedGroups} grupo(s) de características não estão ligados a nenhuma categoria)` : ''}.
        </p>
      )}

      {!carregando && !erro && dados?.attributes?.length > 0 && (
        <div className="space-y-4">
          {productId && faltando.length > 0 && (
            <div className="rounded-md px-3 py-2 text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <span className="font-bold">⚠ {faltando.length} atributo(s) obrigatório(s) sem preenchimento:</span>
              <div className="mt-1 text-slate-300">
                {faltando.map((a) => a.name).join(', ')}
              </div>
            </div>
          )}

          {/* ── SEÇÃO: OBRIGATÓRIOS ──────────────────────────────── */}
          <div className="rounded-lg p-3" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="text-xs font-bold text-amber-300">
                  Obrigatórios ({obrigatorios.length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                {obrigatorios.length > 0 && (
                  <button
                    onClick={() => gerarComIA('required')}
                    disabled={Boolean(gerandoEscopo)}
                    title="Preencher com IA apenas os atributos obrigatórios"
                    className="px-2 py-0.5 rounded text-[10px] font-bold border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                  >
                    ✨ IA Obrigatórios
                  </button>
                )}
                <span className="text-[10px] text-amber-400/80 font-medium">Exigidos para publicação</span>
              </div>
            </div>

            {obrigatorios.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic py-1">Nenhum atributo obrigatório para esta categoria neste canal.</p>
            ) : (
              <div className="space-y-2">
                {obrigatorios.map((attr) => (
                  <CampoAtributo
                    key={attr.codeInMarketPlace || attr.id || attr.name}
                    attr={attr}
                    valor={valores[attr.name] ?? ''}
                    editavel={Boolean(productId)}
                    onChange={(v) => setValores((prev) => ({ ...prev, [attr.name]: v }))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── SEÇÃO: OPCIONAIS / RECOMENDADOS ────────────────────── */}
          {opcionais.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle, #2a2a35)' }}>
              <details className="group" open>
                <summary className="cursor-pointer flex items-center justify-between select-none">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span className="text-xs font-bold text-slate-300">
                      Opcionais & Recomendados ({opcionais.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        gerarComIA('optional')
                      }}
                      disabled={Boolean(gerandoEscopo)}
                      title="Preencher com IA apenas os atributos opcionais e recomendados"
                      className="px-2 py-0.5 rounded text-[10px] font-bold border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
                    >
                      ✨ IA Opcionais
                    </button>
                    <span className="text-[10px] text-slate-400 group-open:rotate-180 transition-transform duration-200">
                      ▼
                    </span>
                  </div>
                </summary>
                <div className="mt-3 pt-2 border-t border-slate-800/80 space-y-2">
                  {opcionais.map((attr) => (
                    <CampoAtributo
                      key={attr.codeInMarketPlace || attr.id || attr.name}
                      attr={attr}
                      valor={valores[attr.name] ?? ''}
                      editavel={Boolean(productId)}
                      onChange={(v) => setValores((prev) => ({ ...prev, [attr.name]: v }))}
                    />
                  ))}
                </div>
              </details>
            </div>
          )}

          {productId && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <p className="text-[10px] text-slate-500 leading-tight">{caveat}</p>
              <button
                onClick={salvar}
                disabled={salvando}
                className="shrink-0 px-3.5 py-1.5 rounded-md text-xs font-bold text-white shadow-sm disabled:opacity-60 transition-colors"
                style={{ background: '#4f46e5' }}
              >
                {salvando ? 'Gravando…' : 'Gravar atributos no produto'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Um campo por atributo. Diferencia visualmente obrigatórios e opcionais. */
function CampoAtributo({ attr, valor, editavel, onChange }) {
  const estiloCampo = {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-subtle, #2a2a35)',
    color: '#e2e8f0',
  }

  const isRequired = Boolean(attr.required)
  const isRecommended = Boolean(attr.recommended)

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 p-1.5 rounded hover:bg-white/[0.02] transition-colors">
      <div className="w-full sm:w-56 shrink-0 flex items-center gap-1.5">
        {isRequired ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-amber-500/40 bg-amber-500/15 text-amber-300">
            OBRIGATÓRIO
          </span>
        ) : isRecommended ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-sky-500/40 bg-sky-500/15 text-sky-300">
            RECOMENDADO
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border border-slate-700 bg-slate-800/60 text-slate-400">
            OPCIONAL
          </span>
        )}
        <label className="text-[11px] font-medium text-slate-300 truncate" title={`${attr.name} (${attr.codeInMarketPlace || ''})`}>
          {attr.name}
        </label>
      </div>

      <div className="flex-1 min-w-0">
        {attr.valueType === 'LIST' && attr.allowedValues?.length ? (
          <select
            disabled={!editavel}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md px-2.5 py-1.5 text-[11px] disabled:opacity-60 focus:outline-none focus:border-indigo-500"
            style={estiloCampo}
          >
            <option value="">(vazio)</option>
            {attr.allowedValues.map((opcao) => {
              const val = typeof opcao === 'object' ? (opcao.value ?? opcao.description ?? opcao.name ?? opcao.id) : opcao
              const label = typeof opcao === 'object' ? (opcao.description ?? opcao.name ?? opcao.value ?? opcao.id) : opcao
              return (
                <option key={typeof opcao === 'object' ? (opcao.id ?? val) : val} value={val}>
                  {label}
                </option>
              )
            })}
          </select>
        ) : (
          <input
            disabled={!editavel}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              attr.valueType === 'BOOLEAN'
                ? 'true / false'
                : attr.valueType === 'NUMBER'
                ? 'número'
                : attr.codeInMarketPlace
                ? `Ex: valor para ${attr.codeInMarketPlace}`
                : 'digite o valor…'
            }
            className="w-full rounded-md px-2.5 py-1.5 text-[11px] disabled:opacity-60 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
            style={estiloCampo}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Etapa de vínculo automático: o CRIA propõe, o operador confirma uma vez.
 *
 * O fluxo manual (drill-down na árvore do canal) fica como AJUSTE de um canal específico,
 * não como caminho principal — escolher categoria na árvore do Mercado Livre à mão já é o
 * que o painel do AnyMarket faz, e não era isso que se pedia do CRIA.
 *
 * Três estados de proposta, com tratamento diferente na tela porque a decisão do operador
 * é diferente em cada um:
 *   - correspondência exata (nome idêntico no canal) → vem MARCADA;
 *   - resolvida com ressalva (confiança baixa, ou o nome não é o mesmo) → vem DESMARCADA,
 *     com o rastro visível: é exatamente onde a conferência humana vale;
 *   - não resolvida → não é oferecida como vínculo; sobra o ajuste manual.
 *
 * Exportado porque `PipelineChannelsStage.jsx` (etapa "Canais" do wizard em lote,
 * docs/PLANO_WIZARD_PIPELINE.md) reaproveita este mesmo resolver uma vez por categoria
 * distinta do lote, em vez de duplicar a lógica de proposta/confirmação.
 */
export function AutoBindStep({ clientId, anymarketCategoryId, canais, onDone, onAjustar }) {
  const addToast = useStore((s) => s.addToast)

  const [proposta, setProposta] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [erroCode, setErroCode] = useState(null)
  const [marcados, setMarcados] = useState({})
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState(null)

  const resolver = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    setErroCode(null)
    setResultado(null)

    try {
      const data = await proposeChannelBindings(clientId, { anymarketCategoryId })
      setProposta(data)

      // Pré-marcação: só o que casou exatamente. Marcar proposta duvidosa por padrão
      // transformaria a confirmação em carimbo.
      setMarcados(
        Object.fromEntries(
          (data.proposals ?? [])
            .filter((p) => p.resolved)
            .map((p) => [p.marketplace, Boolean(p.exactLeafMatch && !p.lowConfidence)])
        )
      )
    } catch (err) {
      const dados = err.response?.data
      setErro(dados?.error ?? err.message)
      setErroCode(dados?.code ?? null)
    } finally {
      setCarregando(false)
    }
  }, [clientId, anymarketCategoryId])

  // Resolve ao abrir: o operador chegou aqui porque há canal pendente, e fazer com que
  // ele clique num botão para "começar" é uma etapa vazia.
  useEffect(() => {
    resolver()
  }, [resolver])

  const selecionadas = (proposta?.proposals ?? []).filter((p) => p.resolved && marcados[p.marketplace])

  const confirmar = async () => {
    if (!selecionadas.length) return

    setAplicando(true)
    try {
      const r = await applyChannelBindingsBatch(
        clientId,
        selecionadas.map((p) => ({
          anymarketCategoryId,
          marketplace: p.marketplace,
          codeInMarketPlace: p.codeInMarketPlace,
          completePath: p.completePath,
          source: p.source,
          // A conta do canal vem da proposta e volta no vínculo: Shopee e Nuvemshop
          // identificam a conta no de-para, e perder isso aqui gravaria o vínculo solto.
          accountIdentifier: p.accountIdentifier ?? null,
        }))
      )

      setResultado(r)

      if (r.ok) {
        addToast('success', `De-para gravado em ${r.appliedCount} canal(is).`)
        onDone?.(r)
      } else {
        // Parcial: dizer quantos entraram E quantos não. Um toast de sucesso aqui
        // esconderia canais que continuam sem publicar.
        addToast('warning', `${r.appliedCount} canal(is) vinculado(s), ${r.failedCount} com falha — veja os detalhes.`)
        onDone?.(r)
      }
    } catch (err) {
      addToast('error', err.response?.data?.error ?? err.message)
    } finally {
      setAplicando(false)
    }
  }

  if (carregando) {
    return (
      <div className="rounded-lg px-3 py-4 text-xs" style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
        <p className="font-bold text-indigo-300 mb-1">Resolvendo o de-para de cada canal…</p>
        <p className="text-[11px] text-slate-400">
          O CRIA está percorrendo a árvore de categorias de {canais.length === 1 ? '1 canal' : `${canais.length} canais`} e
          escolhendo o destino. Leva alguns segundos por canal.
        </p>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="rounded-lg px-3 py-3 text-xs" style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.3)' }}>
        <p className="font-bold text-rose-400 mb-1">Não foi possível resolver os vínculos</p>
        <p className="text-slate-300 break-words">{erro}</p>
        {(erroCode === 'panel_token_expired' || erroCode === 'panel_token_missing') && (
          <p className="text-[11px] text-amber-400 mt-1">
            Isso se resolve em ⚙️ Configurações → Token do painel. É um token de sessão e expira.
          </p>
        )}
        <button onClick={resolver} className="mt-2 px-3 py-1.5 rounded-md text-[11px] font-bold text-white" style={{ background: '#4f46e5' }}>
          Tentar de novo
        </button>
      </div>
    )
  }

  if (!proposta) return null

  return (
    <div className="rounded-lg px-3 py-3" style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-bold text-indigo-300">Vínculo proposto pelo CRIA</p>
          <p className="text-[11px] text-slate-400">{proposta.hubPath?.join(' › ')}</p>
        </div>
        <button onClick={resolver} className="text-[11px] text-slate-400 hover:text-white">
          ⟳ resolver de novo
        </button>
      </div>

      <div className="space-y-1.5">
        {proposta.proposals.map((p) => (
          <PropostaLinha
            key={p.marketplace}
            proposta={p}
            marcado={Boolean(marcados[p.marketplace])}
            onToggle={() => setMarcados((prev) => ({ ...prev, [p.marketplace]: !prev[p.marketplace] }))}
            onAjustar={() => onAjustar?.(p.marketplace)}
            resultado={
              resultado?.applied?.find((a) => a.marketplace === p.marketplace) ??
              resultado?.failed?.find((f) => f.marketplace === p.marketplace) ??
              null
            }
          />
        ))}
      </div>

      {proposta.skipped?.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">
          Já vinculados, fora da proposta: {proposta.skipped.join(', ')}.
        </p>
      )}

      {resultado?.failed?.length > 0 && (
        <div className="mt-2 rounded-md px-2.5 py-2 text-[11px]" style={{ background: 'rgba(244,63,94,0.10)', color: '#fda4af' }}>
          {resultado.failed.map((f, i) => (
            <div key={`${f.marketplace}-${i}`}>
              <strong>{f.marketplace}:</strong> {f.error}
              {f.retrySafe && ' — tentar de novo é seguro (a limpeza não será repetida)'}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        <p className="text-[10px] text-slate-500 leading-tight">
          {proposta.needsAttention?.length > 0
            ? `${proposta.needsAttention.length} proposta(s) precisam de conferência — vêm desmarcadas de propósito.`
            : 'Confira o destino de cada canal antes de confirmar.'}
        </p>
        <button
          onClick={confirmar}
          disabled={aplicando || !selecionadas.length}
          className="shrink-0 px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#4f46e5' }}
        >
          {aplicando ? 'gravando…' : `Confirmar e vincular (${selecionadas.length})`}
        </button>
      </div>
    </div>
  )
}

/** Uma linha de proposta: canal, destino, por que, e o que fazer. */
function PropostaLinha({ proposta, marcado, onToggle, onAjustar, resultado }) {
  const [aberto, setAberto] = useState(false)

  const selo = proposta.resolved
    ? proposta.exactLeafMatch && !proposta.lowConfidence
      ? { texto: '✓ nome idêntico', cor: '#34d399', fundo: 'rgba(16,185,129,0.12)', borda: 'rgba(16,185,129,0.35)' }
      : { texto: '⚠ confira', cor: '#fbbf24', fundo: 'rgba(245,158,11,0.10)', borda: 'rgba(245,158,11,0.35)' }
    : { texto: '✕ sem equivalente', cor: '#fda4af', fundo: 'rgba(244,63,94,0.10)', borda: 'rgba(244,63,94,0.3)' }

  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle, #2a2a35)' }}>
      <div className="flex items-start gap-2">
        {proposta.resolved ? (
          <input type="checkbox" checked={marcado} onChange={onToggle} className="mt-0.5 accent-indigo-500" />
        ) : (
          <span className="mt-0.5 w-3.5" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5 flex-wrap">
            {rotuloCanal(proposta.marketplace)}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border" style={{ background: selo.fundo, borderColor: selo.borda, color: selo.cor }}>
              {selo.texto}
            </span>
            {resultado && (
              <span className="text-[10px]" style={{ color: resultado.bound ? '#34d399' : '#fda4af' }}>
                {resultado.bound ? '· gravado' : '· falhou'}
              </span>
            )}
          </p>

          {proposta.resolved ? (
            <p className="text-[11px] text-slate-300 break-words">
              {proposta.completePath ?? proposta.name}
              <span className="text-slate-500">
                {' '}
                · {Math.round((proposta.confidence ?? 0) * 100)}% · {proposta.source === 'suggestion' ? 'sugestão da AnyMarket' : 'resolvido pelo CRIA'}
                {proposta.usedLlm ? ' + IA' : ''}
                {proposta.backtracks > 0 ? ` · ${proposta.backtracks} volta(s)` : ''}
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 break-words">
              {proposta.reason ?? proposta.error}
              {proposta.bestGuess?.completePath && (
                <span className="text-slate-500"> · palpite descartado: {proposta.bestGuess.completePath}</span>
              )}
            </p>
          )}

          {proposta.isReceivingItens === false && (
            <p className="text-[10px] text-amber-400">⚠ essa categoria do canal não está recebendo itens</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <button onClick={onAjustar} className="px-2 py-0.5 rounded text-[10px] font-bold border" style={{ borderColor: 'var(--border-subtle, #2a2a35)', color: '#cbd5e1' }}>
            ajustar
          </button>
          {proposta.trail?.length > 0 && (
            <button onClick={() => setAberto((v) => !v)} className="text-[10px] text-slate-400 hover:text-white">
              {aberto ? 'ocultar' : 'como decidiu'}
            </button>
          )}
        </div>
      </div>

      {/* O rastro é o que torna a confirmação informada: mostra por qual ramo desceu, com
          que alternativas, e onde voltou atrás. */}
      {aberto && (
        <ol className="mt-1.5 pl-6 space-y-0.5 text-[10px] text-slate-400 list-decimal">
          {proposta.trail.map((passo, i) => (
            <li key={i} style={passo.backtrack ? { color: '#fbbf24' } : undefined}>
              {passo.backtrack ? '↩ ' : ''}
              {passo.chosen ? <strong className="text-slate-300">{passo.chosen.name}</strong> : <em>parou</em>} — {passo.reason}
              {passo.candidates?.length > 0 && (
                <span className="text-slate-600"> (alternativas: {passo.candidates.map((c) => c.name).join(', ')})</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
