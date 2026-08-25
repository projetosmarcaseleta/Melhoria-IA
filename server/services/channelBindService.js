/**
 * Orquestração do vínculo de categoria por canal (de-para).
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §1, §3, §4 e §5.
 *
 * Divisão de responsabilidades, no mesmo idioma de `categoryService.js`:
 *   getBindingStatus  → só LÊ (§1.1). Reconciliação determinística: a verdade é o hub.
 *   suggestBinding    → só LÊ (§1.3). Candidatos com percentual.
 *   browseChannelTree → só LÊ (§1.4). Drill-down manual.
 *   applyBinding      → ESCREVE (§1.5). Duas chamadas em sequência, sob lock.
 *   scanUnpublished   → só LÊ (§1.2). Sinal em lote, não veredito.
 *
 * O ponto delicado é `applyBinding`: são DUAS chamadas ao painel, e a primeira
 * (`cleanBoundAttributes`) é destrutiva. Se a segunda falhar, a categoria fica sem
 * atributos vinculados e sem de-para novo — pior que o estado inicial. A resposta
 * desta camada à pergunta aberta da §5 é registrar a intenção no Firestore ANTES da
 * limpeza: o retry sabe que a limpeza já aconteceu e não a repete, e o operador
 * recebe um erro que diz exatamente em que metade parou.
 */

import { db, FieldValue } from './firebaseAdmin.js'
import { AnymarketApiError, resolveAnymarketToken } from './anymarketClient.js'
import {
  fetchCategoryBindings,
  fetchBindSuggestions,
  fetchMarketplaceCategories,
  cleanBoundAttributes,
  putCategoryBinding,
  fetchUnpublishedTransmissions,
  fetchMarketplaceCatalog,
  fetchAccountMarketplaces,
  fetchMarketplaceAccounts,
  pickAccountFor,
  assertMarketplace,
  assertCategoryId,
  assertMarketplaceCode,
  toBindCompletePath,
  panelCategoryScreenUrl,
} from './channelBindClient.js'
import { resolveByDescent, pickSuggestion } from './channelBindResolver.js'
import {
  isTestClient,
  MOCK_MARKETPLACES,
  getMockMarketplaceLevel,
  getMockBindSuggestions,
  saveMockChannelBinding,
  getMockChannelBinding,
  listMockChannelBindings,
  saveMockBindIntent,
  getMockBindIntent,
  deleteMockBindIntent,
  getMockCategoryTree,
} from './mockStorage.js'

const BINDINGS = 'channel_category_bindings'
const BIND_INTENTS = 'channel_bind_intents'
const LOCKS = 'channel_bind_locks'
const LOCK_STALE_MS = 2 * 60 * 1000

/**
 * Janela em que uma limpeza de atributos já feita continua valendo para o retry.
 *
 * Curta de propósito: passado esse tempo, alguém pode ter mexido no vínculo pelo
 * painel, e aí repetir a limpeza é mais seguro que confiar num registro velho.
 */
const INTENT_TTL_MS = 10 * 60 * 1000

export class ChannelBindError extends Error {
  constructor(message, { status = 400, code = null, detail = null } = {}) {
    super(message)
    this.name = 'ChannelBindError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export const bindingDocId = (anymarketCategoryId, marketplace) => `${anymarketCategoryId}_${marketplace}`

/**
 * A API interna do painel está fora de alcance nesta chamada?
 *
 * Quatro causas, todas com a mesma consequência para quem só quer LER o status: não dá
 * para conferir no hub agora. São separadas por `code` porque a AÇÃO do operador é
 * diferente em cada uma — token do painel não cadastrado, expirado (o caso mais comum:
 * é token de sessão), do tipo errado, ou contrato mudado.
 *
 * Quando isso acontece o CRIA não vira ao contrário: cai no plano B do
 * `docs/GUIA_CAPTURA_CHAMADAS_PAINEL_ANYMARKET.md` — mostra o último estado conhecido e
 * o que está pendente (via endpoints públicos), e manda concluir no painel.
 */
export const isPanelUnavailable = (err) =>
  ['panel_token_unsupported', 'panel_token_expired', 'panel_token_missing', 'internal_contract_changed'].includes(err?.code)

// ── Firestore com falha VISÍVEL ────────────────────────────────────────────────
//
// O espelho no Firestore é cache/auditoria, não fonte da verdade: perdê-lo não pode
// derrubar o vínculo, que já foi gravado no AnyMarket. Mas também não pode falhar em
// silêncio (regra da §3) — daí o `degraded` que sobe até a resposta HTTP e a UI.

async function tryFirestore(label, operation) {
  try {
    return { ok: true, data: await operation() }
  } catch (err) {
    console.warn(`[ChannelBindService] Firestore indisponível em ${label}: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

const bindingsRef = (clientId) => db.collection('clients').doc(clientId).collection(BINDINGS)
const intentsRef = (clientId) => db.collection('clients').doc(clientId).collection(BIND_INTENTS)

// ── Canais do cliente ──────────────────────────────────────────────────────────

/**
 * Token do painel — DIFERENTE do token de API (ver cabeçalho de channelBindClient.js).
 *
 * Mesma regra de segurança do token de API: resolvido no servidor a partir do
 * clientId, nunca aceito pelo corpo da requisição. Fica em
 * `clients/{id}.anymarket_panel_token`; `ANYMARKET_PANEL_TOKEN` serve só para
 * desenvolvimento.
 *
 * Devolve `null` em vez de lançar: quem só LÊ status consegue degradar para o espelho
 * local, e é `panelRequest` que recusa a chamada com mensagem acionável.
 */
export async function resolvePanelToken(clientId) {
  if (isTestClient(clientId)) return 'test-panel-token'

  const doc = await tryFirestore('resolvePanelToken', () => db.collection('clients').doc(clientId).get())
  const saved = doc.ok && doc.data?.exists ? doc.data.data()?.anymarket_panel_token : null

  return saved || process.env.ANYMARKET_PANEL_TOKEN || null
}

/**
 * Quais canais interessam a este cliente.
 *
 * Ordem: canais ATIVOS da conta pelo painel (`GET /rest/api/marketplaces`, confirmado
 * em conta real) → campo `marketplaces` do cadastro → variável de ambiente. O painel
 * vem primeiro porque é a única fonte que não depende de alguém manter uma lista
 * atualizada à mão; quando ele não responde (token do painel ausente ou expirado), as
 * outras duas seguram a tela em vez de derrubá-la.
 */
export async function getClientMarketplaces(clientId, { deps = null } = {}) {
  if (isTestClient(clientId)) return [...MOCK_MARKETPLACES]

  const d = resolveDeps(clientId, deps)

  try {
    const panelToken = await d.resolvePanelToken(clientId)
    if (panelToken) {
      const doPainel = await d.fetchAccountMarketplaces(panelToken)
      if (doPainel.length) return doPainel
    }
  } catch (err) {
    console.warn(`[ChannelBindService] Canais da conta indisponíveis pelo painel (${err.code ?? err.message}) — usando o cadastro.`)
  }

  const doc = await tryFirestore('getClientMarketplaces', () => db.collection('clients').doc(clientId).get())
  const configured = doc.ok && doc.data?.exists ? doc.data.data()?.marketplaces : null

  if (Array.isArray(configured) && configured.length) {
    return configured.map((mp) => assertMarketplace(mp))
  }

  const fromEnv = String(process.env.ANYMARKET_MARKETPLACES || 'MERCADO_LIVRE,AMAZON_HUB,SHOPEE,MAGAZINE_LUIZA,NUVEMSHOP')
    .split(',')
    .map((mp) => mp.trim())
    .filter(Boolean)

  return fromEnv.map((mp) => assertMarketplace(mp))
}

// ── Injeção de dependência ─────────────────────────────────────────────────────
//
// Duas razões: (a) o cliente de teste nunca deve tocar o painel real; (b) o caso que
// mais importa testar — limpeza sucede, vínculo falha — só é reproduzível injetando
// uma falha, porque nenhum ambiente real falha na hora que a gente quer.

export const realDeps = {
  // Dois tokens distintos: v2 pública vs API interna do painel. Ver channelBindClient.js.
  resolveToken: resolveAnymarketToken,
  resolvePanelToken,
  fetchAccountMarketplaces,
  fetchMarketplaceAccounts,
  fetchCategoryBindings,
  fetchBindSuggestions,
  fetchMarketplaceCategories,
  cleanBoundAttributes,
  putCategoryBinding,
  fetchUnpublishedTransmissions,
  fetchMarketplaceCatalog,
}

/** Payload de categoria do cliente de teste, com `pathFromRoot` como o painel devolve. */
function mockCategoryPayload(categoryId) {
  const nodes = getMockCategoryTree()
  const byId = new Map(nodes.map((n) => [String(n.id), n]))

  const trilha = []
  let atual = byId.get(String(categoryId))
  while (atual) {
    trilha.unshift({ id: atual.id, name: atual.name })
    atual = atual.parent?.id ? byId.get(String(atual.parent.id)) : null
  }

  return {
    id: categoryId,
    name: trilha[trilha.length - 1]?.name ?? null,
    path: trilha.map((n) => n.name).join('/'),
    pathFromRoot: trilha,
    marketPlaces: [],
  }
}

function buildMockDeps(clientId) {
  return {
    resolveToken: async () => 'test-token',
    resolvePanelToken: async () => 'test-panel-token',
    fetchAccountMarketplaces: async () => [...MOCK_MARKETPLACES],
    fetchMarketplaceAccounts: async () => MOCK_MARKETPLACES.map((mp) => ({ id: `conta-${mp}`, name: mp, marketplace: mp, isDefault: true })),
    fetchCategoryBindings: async (_token, categoryId) => ({
      anymarketCategoryId: String(categoryId),
      // `raw` carrega o caminho no hub, que é o alvo da resolução automática — sem ele
      // o resolvedor não teria contra o que comparar a árvore do canal.
      raw: mockCategoryPayload(categoryId),
      bindings: listMockChannelBindings(clientId, categoryId).map((b) => ({
        marketplace: b.marketplace,
        codeInMarketPlace: b.codeInMarketPlace,
        completePath: b.completePath,
        removed: Boolean(b.removed),
        bindIndex: '0',
      })),
    }),
    fetchBindSuggestions: async (_token, { marketplace, anymarketCategoryId }) => ({
      marketplace,
      anymarketCategoryId: String(anymarketCategoryId),
      suggestions: getMockBindSuggestions(marketplace),
    }),
    fetchMarketplaceCategories: async (_token, { marketplace, codeInMarketPlace = null }) => ({
      marketplace,
      codeInMarketPlace,
      ...getMockMarketplaceLevel(marketplace, codeInMarketPlace),
    }),
    cleanBoundAttributes: async () => ({ mock: true }),
    putCategoryBinding: async (_token, params) => {
      saveMockChannelBinding(clientId, {
        anymarketCategoryId: String(params.anymarketCategoryId),
        marketplace: params.marketplace,
        codeInMarketPlace: params.codeInMarketPlace,
        completePath: toBindCompletePath(params.completePath),
        removed: false,
      })
      return { mock: true }
    },
    fetchUnpublishedTransmissions: async () => ({ raw: [], pages: 0, truncated: false }),
    fetchMarketplaceCatalog: async () => MOCK_MARKETPLACES.map((code) => ({ code, name: code })),
  }
}

function resolveDeps(clientId, override = null) {
  const base = isTestClient(clientId) ? buildMockDeps(clientId) : realDeps
  return override ? { ...base, ...override } : base
}

// ── §1.1 — status do de-para ───────────────────────────────────────────────────

/**
 * Está vinculada? Resposta determinística, canal por canal.
 *
 * `bound` é `codeInMarketPlace` presente E `removed !== true`: o painel mantém no
 * array os vínculos desfeitos, e contar um deles como vinculado diria "pode publicar"
 * para uma categoria que vai falhar na transmissão.
 */
export async function getBindingStatus(clientId, anymarketCategoryId, { marketplaces = null, deps = null } = {}) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const d = resolveDeps(clientId, deps)

  const alvo = (marketplaces?.length ? marketplaces : await getClientMarketplaces(clientId)).map((mp) =>
    assertMarketplace(mp)
  )

  const panelToken = await d.resolvePanelToken(clientId)

  // Caminho preferido: a verdade do hub (§1.1). Caminho degradado: o espelho local,
  // marcado como tal — dizer "não sei" com o último estado conhecido é mais útil que
  // uma tela de erro, desde que a UI não finja que isso foi conferido agora.
  let bindings = []
  let hubUnavailable = false
  let hubError = null

  let categoryNotFound = false

  try {
    ;({ bindings } = await d.fetchCategoryBindings(panelToken, categoryId))
  } catch (err) {
    // Categoria deletada do AnyMarket: hub devolve HTTP 500 "não existe".
    // Tratar como estado degradado (mesma lógica do painel indisponível) em vez de
    // propagar 500 para a UI — o operador vê o espelho local e sabe que a categoria
    // já não existe, sem tela de erro.
    const isNotFound =
      err instanceof AnymarketApiError &&
      err.status === 500 &&
      (err.data?.details ?? err.data?.message ?? '').toLowerCase().includes('não existe')

    if (!isPanelUnavailable(err) && !isNotFound) throw err

    hubUnavailable = true
    if (isNotFound) categoryNotFound = true
    hubError = { code: isNotFound ? 'category_not_found_in_hub' : err.code, message: err.message }

    const espelho = await getMirroredBindings(clientId, categoryId)
    bindings = espelho.bindings.map((b) => ({
      marketplace: b.marketplace,
      codeInMarketPlace: b.codeInMarketPlace ?? null,
      completePath: b.completePath ?? null,
      removed: Boolean(b.removed),
      bindIndex: null,
    }))
  }

  const porCanal = new Map(bindings.map((b) => [b.marketplace, b]))
  // Canal vinculado que não está na lista configurada ainda deve aparecer: esconder
  // um de-para existente é pior que mostrar um canal que o cliente não usa mais.
  const canais = [...new Set([...alvo, ...porCanal.keys()])].sort()

  const channels = canais.map((marketplace) => {
    const b = porCanal.get(marketplace) ?? null
    return {
      marketplace,
      bound: Boolean(b?.codeInMarketPlace && !b.removed),
      codeInMarketPlace: b?.codeInMarketPlace ?? null,
      completePath: b?.completePath ?? null,
      removed: Boolean(b?.removed),
      // Canal fora da lista configurada do cliente — informação para a UI, não erro.
      unexpected: !alvo.includes(marketplace),
    }
  })

  // Não regravar o espelho a partir do próprio espelho: isso só renovaria
  // `lastCheckedAt` sem ninguém ter checado nada.
  const mirror = hubUnavailable ? { degraded: false } : await mirrorBindingStatus(clientId, categoryId, channels)

  return {
    anymarketCategoryId: categoryId,
    channels,
    boundCount: channels.filter((c) => c.bound).length,
    pendingCount: channels.filter((c) => !c.bound && !c.unexpected).length,
    checkedAt: hubUnavailable ? null : new Date().toISOString(),
    configuredMarketplaces: alvo,
    degraded: mirror.degraded,
    // Estado do caminho frágil, para a UI escolher entre "vincular aqui" e
    // "resolva no painel do AnyMarket".
    hubUnavailable,
    hubError,
    categoryNotFound,
    canBindHere: !hubUnavailable,
    panelUrl: panelCategoryScreenUrl(),
  }
}

/**
 * Catálogo de canais da plataforma (`/v2/marketplaces`, público e confirmado).
 *
 * Não é a lista de canais ATIVOS da conta — isso não tem endpoint público conhecido.
 * Serve para validar o código e mostrar nome legível.
 */
export async function getMarketplaceCatalog(clientId, { deps = null } = {}) {
  const d = resolveDeps(clientId, deps)
  const token = await d.resolveToken(clientId)
  const marketplaces = await (d.fetchMarketplaceCatalog ?? fetchMarketplaceCatalog)(token)
  return { marketplaces, count: marketplaces.length }
}

/** Espelha o resultado da §1.1 — `lastCheckedAt` por canal. */
async function mirrorBindingStatus(clientId, categoryId, channels) {
  if (isTestClient(clientId)) return { degraded: false }

  const now = new Date().toISOString()
  const resultado = await tryFirestore('mirrorBindingStatus', async () => {
    const writer = db.bulkWriter()
    for (const channel of channels) {
      writer
        .set(
          bindingsRef(clientId).doc(bindingDocId(categoryId, channel.marketplace)),
          {
            anymarketCategoryId: categoryId,
            marketplace: channel.marketplace,
            codeInMarketPlace: channel.codeInMarketPlace,
            completePath: channel.completePath,
            removed: channel.removed,
            bound: channel.bound,
            lastCheckedAt: now,
          },
          { merge: true }
        )
        .catch(() => {})
    }
    await writer.close()
  })

  return { degraded: !resultado.ok }
}

// ── §1.3 / §1.4 — sugestões e drill-down ───────────────────────────────────────

export async function suggestBinding(clientId, { anymarketCategoryId, marketplace }, { deps = null } = {}) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const mp = assertMarketplace(marketplace)
  const d = resolveDeps(clientId, deps)

  const panelToken = await d.resolvePanelToken(clientId)
  const { suggestions } = await d.fetchBindSuggestions(panelToken, { marketplace: mp, anymarketCategoryId: categoryId })

  return { anymarketCategoryId: categoryId, marketplace: mp, suggestions }
}

export async function browseChannelTree(clientId, { marketplace, codeInMarketPlace = null, accountIdentifier = null }, { deps = null } = {}) {
  const mp = assertMarketplace(marketplace)
  const code = codeInMarketPlace ? assertMarketplaceCode(codeInMarketPlace) : null
  const d = resolveDeps(clientId, deps)

  const panelToken = await d.resolvePanelToken(clientId)

  // Sem conta explícita, descobre a padrão do canal: Shopee e Nuvemshop recusam a árvore
  // sem `accountIdentifier`.
  let conta = accountIdentifier
  if (!conta) {
    try {
      conta = pickAccountFor(await d.fetchMarketplaceAccounts(panelToken), mp)?.id ?? null
    } catch {
      conta = null
    }
  }

  return d.fetchMarketplaceCategories(panelToken, { marketplace: mp, codeInMarketPlace: code, accountIdentifier: conta })
}

// ── Lock por categoria+canal ───────────────────────────────────────────────────

/**
 * O erro do `create()` significa que OUTRO processo tem o lock?
 *
 * Só ALREADY_EXISTS (gRPC 6). Qualquer outra falha é infraestrutura — e tratá-la como
 * lock ocupado devolve ao operador um "outro processo está vinculando" que é falso e
 * sem saída.
 */
export const isLockHeldError = (err) => err?.code === 6 || /ALREADY_EXISTS/i.test(err?.message ?? '')

/** Mesmo padrão de `category_locks`: `create()` falha se o doc já existe. */
async function acquireLock(clientId, lockId, userId) {
  if (isTestClient(clientId)) return { acquired: true, release: async () => {} }

  const ref = db.collection('clients').doc(clientId).collection(LOCKS).doc(lockId)

  try {
    await ref.create({ ownedBy: userId, startedAt: FieldValue.serverTimestamp(), startedAtMs: Date.now() })
    return { acquired: true, release: async () => ref.delete().catch(() => {}) }
  } catch (err) {
    // Só ALREADY_EXISTS (gRPC 6) significa "outro processo tem o lock". Qualquer outra
    // falha é infraestrutura — credencial ausente, cota, rede — e NÃO pode virar
    // "outro processo está vinculando", que é uma mensagem falsa e sem saída para o
    // operador. Nesse caso segue sem exclusão mútua, avisando: a escrita da §1.5 é
    // idempotente na prática (mesmo canal, mesmo código, mesmo de-para).
    //
    // A lista de erros a degradar era antes uma lista de casos conhecidos, e um
    // ambiente sem credencial do Firestore ("Unable to detect a Project Id") caía
    // fora dela e bloqueava o vínculo com "locked".
    if (!isLockHeldError(err)) {
      console.warn(`[ChannelBindService] Lock indisponível (${err.message}) — seguindo sem exclusão mútua.`)
      return { acquired: true, degraded: true, release: async () => {} }
    }

    const snapshot = await ref.get().catch(() => null)
    const startedAtMs = snapshot?.data()?.startedAtMs ?? 0

    if (startedAtMs && Date.now() - startedAtMs > LOCK_STALE_MS) {
      console.warn(`[ChannelBindService] Lock ${lockId} expirado — assumindo.`)
      await ref.set({ ownedBy: userId, startedAtMs: Date.now() }, { merge: true })
      return { acquired: true, release: async () => ref.delete().catch(() => {}) }
    }

    return { acquired: false, heldBy: snapshot?.data()?.ownedBy ?? 'desconhecido' }
  }
}

// ── Diário da transação de duas etapas (§5) ────────────────────────────────────

async function readIntent(clientId, intentId) {
  if (isTestClient(clientId)) return getMockBindIntent(clientId, intentId)

  const resultado = await tryFirestore('readIntent', () => intentsRef(clientId).doc(intentId).get())
  if (!resultado.ok || !resultado.data?.exists) return null
  return resultado.data.data()
}

async function writeIntent(clientId, intentId, data) {
  if (isTestClient(clientId)) return saveMockBindIntent(clientId, intentId, data)
  await tryFirestore('writeIntent', () => intentsRef(clientId).doc(intentId).set(data, { merge: true }))
}

async function clearIntent(clientId, intentId) {
  if (isTestClient(clientId)) return deleteMockBindIntent(clientId, intentId)
  await tryFirestore('clearIntent', () => intentsRef(clientId).doc(intentId).delete())
}

/**
 * A limpeza de atributos deste retry já foi feita e ainda vale?
 *
 * Só reaproveita se for a MESMA categoria, o MESMO canal, o MESMO código de destino e
 * dentro da janela. Qualquer divergência → limpar de novo, porque a limpeza é
 * relativa ao destino que está sendo vinculado.
 */
export function canSkipClean(intent, { marketplace, codeInMarketPlace }, now = Date.now()) {
  if (!intent || intent.phase !== 'attributes_cleaned') return false
  if (intent.marketplace !== marketplace) return false
  if (String(intent.codeInMarketPlace) !== String(codeInMarketPlace)) return false

  const age = now - (intent.cleanedAtMs ?? 0)
  return age >= 0 && age < INTENT_TTL_MS
}

// ── §1.5 — aplicar o vínculo ───────────────────────────────────────────────────

/**
 * Grava o de-para: `cleanBoundAttributes` e depois o PUT do vínculo, nesta ordem.
 *
 * Sequência do estado registrado:
 *   1. intent `cleaning`            → antes de qualquer escrita no AnyMarket
 *   2. intent `attributes_cleaned`  → a metade destrutiva ACONTECEU
 *   3. binding gravado, intent apagada → transação completa
 *
 * Parar em (2) é o cenário ruim da §5, e o erro devolvido diz isso ao operador com
 * `retrySafe: true`: chamar de novo NÃO repete a limpeza, porque o passo 1 registrou.
 */
export async function applyBinding(
  clientId,
  { anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source = 'manual', accountIdentifier = null },
  { userId = 'desconhecido', deps = null, dryRun = false } = {}
) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const mp = assertMarketplace(marketplace)
  const code = assertMarketplaceCode(codeInMarketPlace)

  if (!['suggestion', 'manual'].includes(source)) {
    throw new ChannelBindError(`Origem do vínculo inválida: "${source}". Esperado "suggestion" ou "manual".`, {
      status: 400,
      code: 'invalid_source',
    })
  }

  const bindPath = toBindCompletePath(completePath)
  if (!bindPath) {
    throw new ChannelBindError(
      'O caminho completo da categoria no canal (completePath) é obrigatório — é o que o painel exibe no de-para.',
      { status: 400, code: 'missing_complete_path' }
    )
  }

  const suggestionAccepted = source === 'suggestion'
  const d = resolveDeps(clientId, deps)
  // Escrita da §1.5 é toda no painel: token do painel, não o de API.
  const panelToken = await d.resolvePanelToken(clientId)

  const lockId = bindingDocId(categoryId, mp)
  const lock = await acquireLock(clientId, lockId, userId)
  if (!lock.acquired) {
    throw new ChannelBindError(
      `Outro processo já está vinculando esta categoria em ${mp} (${lock.heldBy}). Tente novamente em instantes.`,
      { status: 409, code: 'locked' }
    )
  }

  const intentId = lockId

  try {
    const intent = await readIntent(clientId, intentId)
    const skipClean = canSkipClean(intent, { marketplace: mp, codeInMarketPlace: code })

    if (skipClean) {
      console.warn(
        `[ChannelBindService] Retry de ${intentId}: atributos já limpos em tentativa anterior — pulando cleanBoundAttributes.`
      )
    } else {
      await writeIntent(clientId, intentId, {
        anymarketCategoryId: categoryId,
        marketplace: mp,
        codeInMarketPlace: code,
        completePath: bindPath,
        source,
        phase: 'cleaning',
        startedBy: userId,
        startedAtMs: Date.now(),
      })

      try {
        await d.cleanBoundAttributes(panelToken, { marketplace: mp, anymarketCategoryId: categoryId, dryRun })
      } catch (err) {
        // A limpeza NÃO aconteceu: nada a compensar, e deixar a intenção em `cleaning`
        // só sujaria o diário. É o caminho que o painel recusando o token percorre.
        await clearIntent(clientId, intentId)
        throw err
      }

      await writeIntent(clientId, intentId, { phase: 'attributes_cleaned', cleanedAtMs: Date.now() })
    }

    let bindResult
    try {
      bindResult = await d.putCategoryBinding(panelToken, {
        marketplace: mp,
        anymarketCategoryId: categoryId,
        codeInMarketPlace: code,
        completePath: bindPath,
        suggestionAccepted,
        accountIdentifier,
        dryRun,
      })
    } catch (err) {
      // O cenário da §5. O estado intermediário FICA registrado de propósito: é o que
      // torna o retry seguro. E o erro tem que dizer o que sobrou pela metade — não
      // dá para responder "falhou" e deixar o operador achando que nada mudou.
      await writeIntent(clientId, intentId, { phase: 'attributes_cleaned', lastError: err.message, lastErrorAtMs: Date.now() })

      throw new ChannelBindError(
        `Os atributos vinculados de ${mp} foram limpos, mas o novo de-para NÃO foi gravado (${err.message}). ` +
          'A categoria está sem vínculo neste canal e não vai publicar até você tentar de novo — o retry não repete a limpeza.',
        {
          status: err instanceof AnymarketApiError && err.status >= 400 && err.status < 500 ? err.status : 502,
          code: 'bind_failed_after_clean',
          detail: { retrySafe: true, marketplace: mp, anymarketCategoryId: categoryId, cause: err.message },
        }
      )
    }

    const record = {
      anymarketCategoryId: categoryId,
      marketplace: mp,
      codeInMarketPlace: code,
      completePath: bindPath,
      suggestionAccepted,
      source,
      accountIdentifier,
      bound: true,
      removed: false,
      boundBy: userId,
      boundAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastTransmissionError: null,
      ...(bindResult?.dryRun ? { dryRun: true } : {}),
    }

    const mirror = isTestClient(clientId)
      ? { ok: true }
      : await tryFirestore('saveBinding', () => bindingsRef(clientId).doc(bindingDocId(categoryId, mp)).set(record, { merge: true }))

    await clearIntent(clientId, intentId)

    return { ...record, degraded: !mirror.ok, lockDegraded: Boolean(lock.degraded), skippedClean: skipClean }
  } finally {
    await lock.release()
  }
}

/** Estado gravado do de-para (espelho), sem ir ao painel — para render rápido de tela. */
export async function getMirroredBindings(clientId, anymarketCategoryId) {
  const categoryId = assertCategoryId(anymarketCategoryId)

  if (isTestClient(clientId)) {
    return { bindings: listMockChannelBindings(clientId, categoryId), degraded: false }
  }

  const resultado = await tryFirestore('getMirroredBindings', () =>
    bindingsRef(clientId).where('anymarketCategoryId', '==', categoryId).get()
  )

  if (!resultado.ok) return { bindings: [], degraded: true }
  return { bindings: resultado.data.docs.map((doc) => doc.data()), degraded: false }
}

// ── §1.2 — sinal em lote pelas transmissões ────────────────────────────────────

/**
 * Classifica a mensagem de erro da transmissão.
 *
 * Heurística de TEXTO LIVRE do marketplace, e o nome da função não esconde isso: é
 * para priorizar o que investigar, nunca para afirmar a causa. Vínculo faltando e
 * atributo obrigatório faltando são as duas famílias que esta feature endereça;
 * qualquer outra coisa cai em `other` em vez de ser forçada numa gaveta.
 */
export function classifyTransmissionIssue(message) {
  const texto = String(message ?? '').toLowerCase()
  if (!texto) return 'unknown'

  if (/categor/.test(texto) && /(vincul|bind|de-para|mapea|não .*mapead|not mapped)/.test(texto)) return 'missing_binding'
  if (/(atributo|caracter|characteristic|attribute|ficha t)/.test(texto) && /(obrigat|required|inform|faltando|missing)/.test(texto)) {
    return 'missing_attribute'
  }
  if (/categor/.test(texto)) return 'category_related'
  return 'other'
}

/**
 * Agrupa as transmissões não publicadas por causa provável.
 *
 * Leitura em lote e cara (paginada, fila lenta) — é diagnóstico sob demanda, nunca
 * automático a cada render.
 */
export async function scanUnpublished(clientId, { deps = null, limit, maxPages } = {}) {
  const d = resolveDeps(clientId, deps)
  const token = await d.resolveToken(clientId)
  const { raw, truncated } = await d.fetchUnpublishedTransmissions(token, { limit, maxPages })

  const issues = raw.map((item) => ({
    productId: item?.product?.id ?? item?.productId ?? null,
    skuId: item?.sku?.id ?? item?.skuId ?? null,
    marketplace: String(item?.marketPlace ?? item?.marketplace ?? '').toUpperCase() || null,
    message: item?.transmissionMessage ?? item?.message ?? null,
    kind: classifyTransmissionIssue(item?.transmissionMessage ?? item?.message),
  }))

  const byKind = issues.reduce((acc, issue) => {
    acc[issue.kind] = (acc[issue.kind] ?? 0) + 1
    return acc
  }, {})

  return { total: issues.length, byKind, issues, truncated }
}

// ── Vínculo AUTOMÁTICO: propor tudo, confirmar uma vez ─────────────────────────
//
// É o fluxo principal da feature. Navegar a árvore do canal à mão já existe no painel
// do AnyMarket; o que o CRIA acrescenta é DECIDIR o destino em cada canal e pedir uma
// confirmação só. O drill-down manual continua disponível como ajuste pontual.

/**
 * Cache dos níveis da árvore do canal, por processo.
 *
 * A descida revisita a raiz do mesmo canal para cada categoria proposta, e a árvore
 * nativa de um marketplace é praticamente estática. Sem isso, propor 5 canais para 10
 * categorias seriam centenas de chamadas ao painel.
 */
const NIVEL_TTL_MS = 60 * 60 * 1000
const nivelCache = new Map()

export const channelTreeCache = {
  // A chave inclui a conta quando houver: canais diferentes na mesma conta têm árvores
  // diferentes, e a mesma marca com duas contas também pode ter.
  key: (escopo, code) => `${escopo}:${code ?? '#root'}`,
  get(marketplace, code) {
    const entry = nivelCache.get(this.key(marketplace, code))
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      nivelCache.delete(this.key(marketplace, code))
      return null
    }
    return entry.data
  },
  set(marketplace, code, data) {
    nivelCache.set(this.key(marketplace, code), { data, expiresAt: Date.now() + NIVEL_TTL_MS })
  },
  clear() {
    nivelCache.clear()
  },
  size: () => nivelCache.size,
}

/** Caminho da categoria no hub, para o resolvedor comparar. */
export function hubPathFromPayload(raw) {
  if (Array.isArray(raw?.pathFromRoot) && raw.pathFromRoot.length) {
    const nomes = raw.pathFromRoot.map((n) => n?.name).filter(Boolean)
    if (nomes.length) return nomes
  }
  if (typeof raw?.path === 'string' && raw.path.trim()) {
    return raw.path.split(/[/>]/).map((p) => p.trim()).filter(Boolean)
  }
  return [raw?.name].filter(Boolean)
}

/**
 * Propõe o de-para de TODOS os canais de uma vez. Não escreve nada.
 *
 * Por canal: tenta a sugestão da AnyMarket; se ela não vem (medido: costuma vir vazia),
 * desce a árvore nativa com o matcher + LLM para desempate. Canal já vinculado é
 * ignorado por padrão — repropor o que está pronto convida a mexer no que funciona.
 */
export async function proposeBindings(
  clientId,
  { anymarketCategoryId, marketplaces = null, includeBound = false, options = {}, useLlm = true },
  { deps = null } = {}
) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const d = resolveDeps(clientId, deps)
  const panelToken = await d.resolvePanelToken(clientId)

  const { bindings, raw } = await d.fetchCategoryBindings(panelToken, categoryId)
  const hubPath = hubPathFromPayload(raw ?? {})

  const jaVinculado = new Set(bindings.filter((b) => b.codeInMarketPlace && !b.removed).map((b) => b.marketplace))
  const alvo = (marketplaces?.length ? marketplaces : await getClientMarketplaces(clientId, { deps })).map((mp) =>
    assertMarketplace(mp)
  )
  const pendentes = includeBound ? alvo : alvo.filter((mp) => !jaVinculado.has(mp))

  // Contas por canal, uma vez por proposta: é a conta que decide QUAL árvore a AnyMarket
  // devolve, e canal com integração por conta (Shopee, Nuvemshop) recusa a chamada sem ela.
  let contas = []
  try {
    contas = await d.fetchMarketplaceAccounts(panelToken)
  } catch (err) {
    console.warn(`[ChannelBindService] Contas por canal indisponíveis (${err.code ?? err.message}) — seguindo sem accountIdentifier.`)
  }

  const fetchLevelDoCanal = (marketplace) => {
    const conta = pickAccountFor(contas, marketplace)

    return async (code) => {
      const chave = conta?.id ? `${marketplace}#${conta.id}` : marketplace
      const emCache = channelTreeCache.get(chave, code)
      if (emCache) return emCache

      const nivel = await d.fetchMarketplaceCategories(panelToken, {
        marketplace,
        codeInMarketPlace: code,
        accountIdentifier: conta?.id ?? null,
      })
      channelTreeCache.set(chave, code, nivel)
      return nivel
    }
  }

  // Sequencial de propósito: as chamadas ao painel já compartilham o limitador, e
  // paralelizar canais só empilharia espera enquanto multiplica risco de 429.
  const proposals = []

  for (const marketplace of pendentes) {
    try {
      let resultado = null

      try {
        const { suggestions } = await d.fetchBindSuggestions(panelToken, { marketplace, anymarketCategoryId: categoryId })
        resultado = pickSuggestion(suggestions, options)
      } catch (err) {
        // Sugestão é atalho, não requisito: se ela falhar (inclusive por lentidão), a
        // descida na árvore ainda resolve.
        console.warn(`[ChannelBindService] Sugestões de ${marketplace} indisponíveis (${err.message}) — indo pela árvore.`)
      }

      if (!resultado) {
        resultado = await resolveByDescent({
          hubPath,
          marketplace,
          fetchLevel: fetchLevelDoCanal(marketplace),
          options,
          useLlm,
        })
      }

      proposals.push({
        marketplace,
        alreadyBound: jaVinculado.has(marketplace),
        accountIdentifier: pickAccountFor(contas, marketplace)?.id ?? null,
        ...resultado,
      })
    } catch (err) {
      proposals.push({
        marketplace,
        resolved: false,
        error: err.message,
        code: err.code ?? null,
        // Erro de token/painel vale para todos os canais: a UI não deve sugerir
        // "tente outro canal" quando o problema é a credencial.
        clientLevel: isPanelUnavailable(err),
      })
    }
  }

  return {
    anymarketCategoryId: categoryId,
    hubPath,
    marketplaces: alvo,
    skipped: alvo.filter((mp) => !pendentes.includes(mp)),
    proposals,
    resolvedCount: proposals.filter((p) => p.resolved).length,
    // Proposta de confiança baixa NÃO deve vir pré-marcada na tela: é exatamente onde a
    // conferência humana importa.
    needsAttention: proposals.filter((p) => p.resolved && p.lowConfidence).map((p) => p.marketplace),
  }
}

/**
 * Aplica as propostas confirmadas — uma confirmação, N canais.
 *
 * Cada canal é uma transação independente (lock e diário próprios): um que falhe não
 * desfaz nem impede os outros, e o resultado diz canal por canal o que aconteceu. Meio
 * lote aplicado precisa ser VISÍVEL, não engolido num "erro ao vincular".
 */
export async function applyBindingsBatch(clientId, { bindings }, { userId = 'desconhecido', deps = null, dryRun = false } = {}) {
  if (!Array.isArray(bindings) || !bindings.length) {
    throw new ChannelBindError('Nenhum vínculo confirmado para aplicar.', { status: 400, code: 'empty_batch' })
  }

  const applied = []
  const failed = []

  for (const item of bindings) {
    try {
      const resultado = await applyBinding(
        clientId,
        {
          anymarketCategoryId: item.anymarketCategoryId,
          marketplace: item.marketplace,
          codeInMarketPlace: item.codeInMarketPlace,
          completePath: item.completePath,
          source: item.source === 'suggestion' ? 'suggestion' : 'manual',
          accountIdentifier: item.accountIdentifier ?? null,
        },
        { userId, deps, dryRun }
      )
      applied.push(resultado)
    } catch (err) {
      failed.push({
        marketplace: item.marketplace,
        anymarketCategoryId: item.anymarketCategoryId,
        error: err.message,
        code: err.code ?? null,
        retrySafe: Boolean(err.detail?.retrySafe),
      })

      // Token do painel caiu no meio do lote: os canais seguintes vão falhar igual.
      // Parar e reportar é melhor que insistir cinco vezes no mesmo erro.
      if (isPanelUnavailable(err)) {
        failed.push(
          ...bindings
            .slice(bindings.indexOf(item) + 1)
            .map((restante) => ({ marketplace: restante.marketplace, skipped: true, error: 'interrompido: o painel do AnyMarket não está acessível' }))
        )
        break
      }
    }
  }

  return { applied, failed, appliedCount: applied.length, failedCount: failed.length, ok: failed.length === 0 }
}
