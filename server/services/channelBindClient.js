/**
 * Cliente isolado do vínculo de categoria por canal (de-para) e dos atributos.
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md.
 *
 * Duas fontes com níveis de confiança MUITO diferentes convivem aqui, e a separação
 * é proposital:
 *
 *   §1  API INTERNA do painel (`app.anymarket.com.br/rest/api`) — obtida por
 *       engenharia reversa, sem contrato público, pode mudar sem aviso. Todo acesso
 *       passa por `panelRequest()`, que marca o erro com `internalApi: true` e loga
 *       em canal próprio — é assim que a gente descobre uma quebra de contrato em
 *       horas, e não pela reclamação do operador.
 *
 *   §2  API PÚBLICA v2 (`api.anymarket.com.br/v2`) — contrato estável, mesmo caminho
 *       que `anymarketClient.js` já usa.
 *
 * ⚠ SÃO DOIS TOKENS DIFERENTES, e não são intercambiáveis (medido em 19/08/2026):
 *
 *   - Token de API (`base64.assinatura`) → v2 pública. No painel dá 500 genérico.
 *   - Token do painel (`259…L…E…C…O….I`) → `/rest/api`. Na v2 dá 401 "User not
 *     registered". **Expira**: quando expira, o painel devolve 403 `TOKEN_EXPIRED`.
 *
 * Os dois vão no MESMO header (`gumgaToken`); `Authorization: Bearer` é rejeitado por
 * ambos. Por isso `panelRequest` recebe o token do painel e as funções da §2 recebem o
 * token de API — trocá-los não dá erro de compilação, só 500/401 em produção, então
 * cada função nomeia qual espera.
 *
 * Regra desta camada: NENHUM outro módulo chama `/rest/api` direto. Se a AnyMarket
 * publicar uma versão oficial da §1, o conserto é neste arquivo e em nenhum outro.
 *
 * Rate limit / retry / desaceleração por 429 são herdados de `anymarketRequest`.
 */

import { anymarketRequest, AnymarketApiError, paginate, extractItems } from './anymarketClient.js'

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const channelBindConfig = {
  panelBaseUrl: (process.env.ANYMARKET_PANEL_API_URL || 'https://app.anymarket.com.br/rest/api').replace(/\/+$/, ''),
  // A listagem de características é varredura paginada: entra na fila lenta (bulk),
  // igual à árvore de categorias, para não competir com leitura interativa.
  attributesPageSize: Math.max(1, num(process.env.ANYMARKET_ATTRS_PAGE_SIZE, 50)),
  attributesMaxPages: Math.max(1, num(process.env.ANYMARKET_ATTRS_MAX_PAGES, 200)),
  transmissionsPageSize: Math.max(1, num(process.env.ANYMARKET_TRANSMISSIONS_PAGE_SIZE, 100)),
  transmissionsMaxPages: Math.max(1, num(process.env.ANYMARKET_TRANSMISSIONS_MAX_PAGES, 20)),
  // Sugestão de vínculo em categoria grande passou de 25s em conta real.
  suggestionsTimeoutMs: num(process.env.ANYMARKET_SUGGESTIONS_TIMEOUT_MS, 90_000),
}

export const isDryRun = (explicit = false) => Boolean(explicit) || process.env.ANYMARKET_DRY_RUN === 'true'

// ── Validação de identificadores ───────────────────────────────────────────────
//
// Os dois identificadores entram na URL. Validar formato aqui não é preciosismo:
// um valor com "/" ou "?" vindo de payload da própria AnyMarket (ex.: `completePath`
// reaproveitado por engano como código) viraria outra rota no host do painel.

const MARKETPLACE_RE = /^[A-Z][A-Z0-9_]{1,39}$/
const CATEGORY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MARKETPLACE_CODE_RE = /^[A-Za-z0-9_.:-]{1,80}$/

export function assertMarketplace(marketplace) {
  const value = String(marketplace ?? '').trim().toUpperCase()
  if (!MARKETPLACE_RE.test(value)) {
    throw new AnymarketApiError(`Canal inválido: "${marketplace}". Esperado o código do marketplace (ex.: MERCADO_LIVRE).`, {
      status: 400,
      code: 'invalid_marketplace',
    })
  }
  return value
}

export function assertCategoryId(anymarketCategoryId) {
  const value = String(anymarketCategoryId ?? '').trim()
  if (!CATEGORY_ID_RE.test(value)) {
    throw new AnymarketApiError(`Id de categoria do AnyMarket inválido: "${anymarketCategoryId}".`, {
      status: 400,
      code: 'invalid_category_id',
    })
  }
  // Id fictício de ensaio (ANYMARKET_DRY_RUN) nunca existe no hub: vincular canal a
  // ele responderia 404 do painel e pareceria quebra de contrato.
  if (value.startsWith('dry-')) {
    throw new AnymarketApiError(
      `A categoria ${value} foi criada em modo simulado (ANYMARKET_DRY_RUN) e não existe no AnyMarket — não é possível vincular canal a ela.`,
      { status: 409, code: 'dry_run_category' }
    )
  }
  return value
}

export function assertMarketplaceCode(codeInMarketPlace) {
  const value = String(codeInMarketPlace ?? '').trim()
  if (!MARKETPLACE_CODE_RE.test(value)) {
    throw new AnymarketApiError(`Código de categoria do marketplace inválido: "${codeInMarketPlace}".`, {
      status: 400,
      code: 'invalid_marketplace_code',
    })
  }
  return value
}

// ── §1 — API interna do painel (contrato frágil) ───────────────────────────────

/**
 * Toda chamada à API interna passa por aqui.
 *
 * O objetivo é o monitoramento pedido na especificação (§0): quando a AnyMarket
 * mudar o contrato, o sintoma é 404/405/415 ou payload irreconhecível — e isso vira
 * log com prefixo próprio (`[ChannelBindClient] ⚠ CONTRATO INTERNO`) e erro marcado
 * com `internalApi: true`, que a rota traduz em "resolva no painel do AnyMarket"
 * em vez de "erro interno do CRIA".
 */
async function panelRequest({ token, method, path, params, data, contentType = null, timeoutMs = undefined }) {
  if (!token) {
    throw new AnymarketApiError(
      'Token do painel do AnyMarket ausente. O de-para de categoria por canal usa a API interna do painel, que exige um token DIFERENTE do token de API: salve em ⚙️ Configurações → Token do painel.',
      { status: 400, code: 'panel_token_missing' }
    )
  }

  try {
    return await anymarketRequest({
      method,
      path,
      params,
      data,
      contentType,
      token,
      ...(timeoutMs ? { timeoutMs } : {}),
      baseUrl: channelBindConfig.panelBaseUrl,
      // Uma tentativa extra, não três: o 500 do painel é SISTEMÁTICO quando o token
      // não dá acesso (ver `isPanelRejectingToken`), e insistir só faz o operador
      // esperar por um erro que já é certo.
      maxRetries: 1,
    })
  } catch (err) {
    if (err instanceof AnymarketApiError) {
      err.internalApi = true

      if (isPanelTokenExpired(err)) {
        console.warn(`[ChannelBindClient] Token do painel expirado em ${method} ${path}.`)
        err.code = 'panel_token_expired'
        err.status = 401
        err.message =
          'O token do painel do AnyMarket expirou. Ele é de sessão e tem validade curta: capture um novo no painel ' +
          '(DevTools → Network → header gumgaToken) e salve em ⚙️ Configurações → Token do painel.'
      } else if (isPanelRejectingToken(err)) {
        console.error(
          `[ChannelBindClient] ⚠ PAINEL RECUSA O TOKEN — ${method} ${path} respondeu ${err.status}. ` +
            'Provável token de API onde o painel espera token de painel.'
        )
        err.code = 'panel_token_unsupported'
        err.message =
          'A API interna do painel do AnyMarket recusou o token. Confira se o valor salvo em "Token do painel" é o do ' +
          'painel (formato 259…L…E…C…O….I) e não o token de API — os dois não são intercambiáveis. Enquanto isso, o ' +
          'de-para pode ser feito na tela "Vínculo de Categorias" do painel do AnyMarket.'
      } else if (isMarketplaceIntegrationError(err)) {
        // Falha na integração do CANAL, não no CRIA nem no contrato do painel: a AnyMarket
        // conseguiu processar a chamada e o marketplace (ou o conector dele) recusou.
        // Medido: MAGAZINE_LUIZA responde "Ocorreu um erro interno no sistema" enquanto os
        // outros quatro canais da mesma conta funcionam.
        console.warn(`[ChannelBindClient] Canal recusou a operação em ${method} ${path}: ${err.data?.details ?? err.data?.message}`)
        err.code = 'marketplace_integration_error'
        err.message = `O canal recusou a operação: ${err.data?.details ?? err.data?.message ?? 'erro na integração do marketplace'}`
      } else if ([400, 404, 405, 410, 415].includes(err.status)) {
        // Endpoint que já funcionava respondendo assim = contrato mudou. Rede e 429
        // não são disso; não poluir o canal de alerta com falha transitória.
        console.error(
          `[ChannelBindClient] ⚠ CONTRATO INTERNO — ${method} ${path} respondeu ${err.status}. ` +
            'A AnyMarket pode ter mudado a API não documentada do painel; o vínculo de canal precisa ser revalidado.',
          err.data ?? ''
        )
        err.code = 'internal_contract_changed'
      }
    }
    throw err
  }
}

/**
 * Token do painel expirado — o caso ROTINEIRO, não um defeito.
 *
 * Medido: `403 {"response":"TOKEN_EXPIRED","operation":"geral"}`. O token do painel é
 * de sessão e vence; distinguir isso de "token errado" é a diferença entre "pegue um
 * novo" e "você colou o token errado".
 */
export function isPanelTokenExpired(err) {
  if (err?.status !== 403) return false
  return /TOKEN_EXPIRED/i.test(String(err?.data?.response ?? err?.data?.message ?? ''))
}

/**
 * O erro veio da integração do CANAL, não do painel?
 *
 * Medido: `500 { code: "MarketPlaceIntegrationException", details: "..." }`. Nada a ver com
 * token nem com contrato: aquele canal específico falhou, e os outros da mesma conta
 * continuam funcionando — então a proposta dos demais não deve ser abortada.
 */
export function isMarketplaceIntegrationError(err) {
  const code = String(err?.data?.code ?? '')
  return /MarketPlaceIntegrationException/i.test(code)
}

/**
 * O painel está recusando o token (formato errado) em vez de falhar de verdade?
 *
 * Medido contra conta real em 19/08/2026, em `app.anymarket.com.br/rest/api`:
 *   - sem header algum          → 401 "Invalid authentication credentials"
 *   - com token de API (v2)     → 500 "An unexpected error occurred" em TODO caminho,
 *                                 inclusive um path inexistente
 *   - com token do PAINEL       → 200 (é o que funciona)
 *
 * O 500 genérico em qualquer rota é a assinatura de credencial do tipo errado: o token
 * passa pelo portão mas não abre sessão de painel. Distinguir isso de um 500 real
 * importa — um é "esse token nunca vai servir", o outro é "tente de novo".
 */
export function isPanelRejectingToken(err) {
  if (err?.status === 401) return true
  if (err?.status !== 500) return false

  const message = String(err?.data?.message ?? '')
  return /unexpected error occurred|invalid authentication credentials/i.test(message)
}

/** Tela do painel onde o de-para é feito à mão — o plano B, quando a §1 não responde. */
export const panelCategoryScreenUrl = () => channelBindConfig.panelBaseUrl.replace(/\/rest\/api$/, '/')

/**
 * §1.1 — De-para atual de uma categoria em todos os canais.
 *
 * É a checagem determinística de "está vinculada?" — a pergunta que originou a
 * feature. `GET /rest/api/categories/{id}` → `marketPlaces[]`.
 */
export async function fetchCategoryBindings(token, anymarketCategoryId) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const payload = await panelRequest({
    token,
    method: 'GET',
    path: `/categories/${encodeURIComponent(categoryId)}`,
  })
  return { anymarketCategoryId: categoryId, bindings: normalizeBindings(payload), raw: payload }
}

/** Canais ATIVOS da conta (§1.4 bis) — `GET /rest/api/marketplaces`. */
export async function fetchAccountMarketplaces(token) {
  return normalizeAccountMarketplaces(await panelRequest({ token, method: 'GET', path: '/marketplaces' }))
}

/**
 * §1.3 — Sugestões automáticas de de-para, com percentual de confiança.
 *
 * Timeout folgado de propósito: numa categoria com milhares de produtos a sugestão
 * passou de 25s (a AnyMarket parece calcular na hora). Com o timeout padrão isso
 * apareceria como "erro de rede" numa chamada que só estava demorando.
 */
export async function fetchBindSuggestions(token, { marketplace, anymarketCategoryId }) {
  const mp = assertMarketplace(marketplace)
  const categoryId = assertCategoryId(anymarketCategoryId)

  const payload = await panelRequest({
    token,
    method: 'GET',
    timeoutMs: channelBindConfig.suggestionsTimeoutMs,
    path: `/categories/bind/${encodeURIComponent(mp)}/suggestions/${encodeURIComponent(categoryId)}`,
  })

  return { marketplace: mp, anymarketCategoryId: categoryId, suggestions: normalizeSuggestions(payload) }
}

/**
 * §1.4 — Um nível da árvore nativa do canal. Sem `code`, devolve a raiz.
 *
 * `canBeSelected` marca a folha vinculável. `completePath` deste endpoint vem com
 * "/" — converter com `toBindCompletePath` antes de mandar no PUT (§1.5).
 */
export async function fetchMarketplaceCategories(token, { marketplace, codeInMarketPlace = null, accountIdentifier = null }) {
  const mp = assertMarketplace(marketplace)
  const code = codeInMarketPlace ? assertMarketplaceCode(codeInMarketPlace) : null

  const payload = await panelRequest({
    token,
    method: 'GET',
    path: code
      ? `/marketplaces/${encodeURIComponent(mp)}/categories/${encodeURIComponent(code)}`
      : `/marketplaces/${encodeURIComponent(mp)}/categories`,
    // Canal com integração por conta (Shopee, Nuvemshop) EXIGE a conta: sem ela a
    // AnyMarket responde 500 "Cannot parse null string". Mercado Livre e Amazon aceitam
    // com ou sem, então mandar sempre que souber é o comportamento uniforme.
    ...(accountIdentifier ? { params: { accountIdentifier: String(accountIdentifier) } } : {}),
  })

  return { marketplace: mp, codeInMarketPlace: code, accountIdentifier: accountIdentifier ?? null, ...normalizeMarketplaceLevel(payload) }
}

/**
 * Contas por canal (`GET /rest/api/marketplaces/accounts`).
 *
 * Um canal pode ter mais de uma conta integrada, e é a conta que decide QUAL árvore de
 * categorias a AnyMarket devolve. `accountDefault` marca a principal.
 */
export async function fetchMarketplaceAccounts(token) {
  return normalizeMarketplaceAccounts(await panelRequest({ token, method: 'GET', path: '/marketplaces/accounts' }))
}

/** Payload de contas → `[{ id, name, marketplace, isDefault }]`. */
export function normalizeMarketplaceAccounts(payload) {
  return (Array.isArray(payload) ? payload : extractItems(payload))
    .map((item) => ({
      id: item?.id !== undefined && item?.id !== null ? String(item.id) : null,
      name: item?.name ?? null,
      marketplace: String(item?.marketplace ?? item?.marketPlace ?? '').trim().toUpperCase() || null,
      isDefault: Boolean(item?.accountDefault),
    }))
    .filter((item) => item.id && item.marketplace)
}

/** Conta a usar num canal: a padrão, ou a primeira que existir. */
export function pickAccountFor(accounts, marketplace) {
  const doCanal = (accounts ?? []).filter((a) => a.marketplace === marketplace)
  return doCanal.find((a) => a.isDefault) ?? doCanal[0] ?? null
}

/**
 * §1.5, etapa 1 de 2 — limpa os atributos já vinculados. Corpo vazio.
 *
 * Necessário inclusive em RE-vínculo. É a metade destrutiva da transação: se a
 * etapa 2 falhar, a categoria fica sem atributos vinculados e sem de-para novo.
 * Quem orquestra isso é `channelBindService.applyBinding`, que registra a intenção
 * no Firestore ANTES desta chamada para o retry não repetir a limpeza à toa.
 */
export async function cleanBoundAttributes(token, { marketplace, anymarketCategoryId, dryRun = false }) {
  const mp = assertMarketplace(marketplace)
  const categoryId = assertCategoryId(anymarketCategoryId)
  const path = `/categories/bind/${encodeURIComponent(mp)}/cleanBoundAttributes/${encodeURIComponent(categoryId)}`

  console.log(`[ChannelBindClient] PUT ${path}`)

  if (isDryRun(dryRun)) {
    console.warn('[ChannelBindClient] ANYMARKET_DRY_RUN ativo — atributos NÃO foram limpos.')
    return { dryRun: true }
  }

  // Corpo vazio de propósito: o endpoint não recebe payload. `data: {}` mandaria
  // Content-Type sem necessidade; `undefined` faz `anymarketRequest` omitir o header.
  return panelRequest({ token, method: 'PUT', path })
}

/**
 * §1.5, etapa 2 de 2 — grava o de-para.
 *
 * `suggestionAccepted` registra a ORIGEM (sugestão da §1.3 vs escolha manual da
 * §1.4). Não é enfeite: é o que permite medir depois se as sugestões da AnyMarket
 * valem a pena, do mesmo jeito que a feature de categoria mede via Insights.
 */
export async function putCategoryBinding(
  token,
  { marketplace, anymarketCategoryId, codeInMarketPlace, completePath, suggestionAccepted = false, bindIndex = '0', removed = false, accountIdentifier = null, dryRun = false }
) {
  const mp = assertMarketplace(marketplace)
  const categoryId = assertCategoryId(anymarketCategoryId)
  const code = assertMarketplaceCode(codeInMarketPlace)

  const body = {
    marketPlace: mp,
    codeInMarketPlace: code,
    completePath: toBindCompletePath(completePath),
    removed: Boolean(removed),
    properties: { bindIndex: String(bindIndex) },
    // Observado nos vínculos reais: canal com múltiplas contas (Nuvemshop, Shopee) traz
    // `accountIdentifier` no de-para. Omitir em canal de conta única é o que a própria
    // API faz (Mercado Livre veio com null).
    ...(accountIdentifier ? { accountIdentifier: String(accountIdentifier) } : {}),
  }

  const path = `/categories/${encodeURIComponent(categoryId)}/marketplaces/${encodeURIComponent(mp)}`
  console.log(`[ChannelBindClient] PUT ${path}?suggestionAccepted=${Boolean(suggestionAccepted)} → ${JSON.stringify(body)}`)

  if (isDryRun(dryRun)) {
    console.warn('[ChannelBindClient] ANYMARKET_DRY_RUN ativo — vínculo de canal NÃO foi gravado.')
    return { ...body, dryRun: true }
  }

  return panelRequest({
    token,
    method: 'PUT',
    path,
    params: { suggestionAccepted: Boolean(suggestionAccepted) },
    data: body,
  })
}

// ── Normalizadores puros (§1) ──────────────────────────────────────────────────
//
// Separados das chamadas HTTP porque são a parte testável sem rede — e porque um
// contrato não documentado exige leitura defensiva: campo que muda de nome não pode
// virar `undefined` silencioso espalhado pela UI.

/** `marketPlaces[]` → lista normalizada de de-para. */
export function normalizeBindings(payload) {
  const list = payload?.marketPlaces ?? payload?.marketplaces ?? payload?.marketPlace ?? []
  if (!Array.isArray(list)) return []

  return list
    .map((item) => ({
      marketplace: String(item?.marketPlace ?? item?.marketplace ?? '').trim().toUpperCase() || null,
      codeInMarketPlace: item?.codeInMarketPlace ? String(item.codeInMarketPlace) : null,
      completePath: item?.completePath ?? item?.path ?? null,
      // `removed: true` é vínculo DESFEITO que o painel mantém no array. Tratar como
      // vinculado seria dizer "está tudo certo" para uma categoria que não publica.
      // Medido: vem `null` (não `false`) quando o vínculo está ativo.
      removed: Boolean(item?.removed),
      bindIndex: item?.properties?.bindIndex ?? null,
      // Canal com múltiplas contas (NUVEMSHOP, SHOPEE) identifica a conta aqui.
      accountIdentifier: item?.accountIdentifier ?? null,
    }))
    .filter((item) => item.marketplace)
}

/**
 * Candidatos da §1.3, do mais confiante para o menos.
 *
 * Medido: o corpo vem embrulhado em `{ suggestions: [...] }` (vazio em categoria sem
 * histórico). `extractItems` não conhece essa chave, daí o desembrulho explícito.
 */
export function normalizeSuggestions(payload) {
  const list = payload?.suggestions ?? payload

  return extractItems(list)
    .map((item) => ({
      codeInMarketPlace: item?.codeInMarketPlace ? String(item.codeInMarketPlace) : item?.code ? String(item.code) : null,
      name: item?.name ?? item?.description ?? null,
      completePath: item?.completePath ?? item?.path ?? null,
      // Vem em escala 0–100 (ex.: 66.67). Manter a escala da origem e deixar a
      // conversão para a UI evita dois lugares dividindo por 100.
      percentage: Number.isFinite(Number(item?.percentage)) ? Number(item.percentage) : null,
    }))
    .filter((item) => item.codeInMarketPlace)
    .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1))
}

/**
 * Um nível da árvore do canal (§1.4): breadcrumb + filhos + se é folha.
 *
 * Ponto medido que muda a implementação: os FILHOS vêm com `completePath: null` —
 * só o nível atual e o breadcrumb trazem o caminho preenchido. Como o PUT de vínculo
 * (§1.5) exige `completePath`, vincular um filho direto da lista mandaria string
 * vazia. Aqui o caminho do filho é DERIVADO do breadcrumb + nome do filho.
 */
export function normalizeMarketplaceLevel(payload) {
  const children = payload?.childs ?? payload?.children ?? payload?.categories ?? (Array.isArray(payload) ? payload : [])

  const toNode = (node) => ({
    codeInMarketPlace: node?.codeInMarketPlace ? String(node.codeInMarketPlace) : node?.code ? String(node.code) : node?.id ? String(node.id) : null,
    name: node?.name ?? node?.description ?? null,
    completePath: node?.completePath ?? null,
    canBeSelected: Boolean(node?.canBeSelected),
    // Folha que não está recebendo itens é destino ruim para vínculo: o marketplace
    // aceita o de-para e recusa o anúncio depois.
    isReceivingItens: node?.isReceivingItens ?? null,
    variationsMandatory: node?.variationsMandatory ?? null,
  })

  const path = Array.isArray(payload?.path) ? payload.path.map(toNode).filter((n) => n.codeInMarketPlace || n.name) : []
  const prefixo = path.map((n) => n.name).filter(Boolean)

  return {
    name: payload?.name ?? payload?.description ?? null,
    completePath: payload?.completePath ?? null,
    canBeSelected: Boolean(payload?.canBeSelected),
    isReceivingItens: payload?.isReceivingItens ?? null,
    path,
    childs: (Array.isArray(children) ? children : [])
      .map(toNode)
      .filter((n) => n.codeInMarketPlace)
      .map((child) => ({
        ...child,
        completePath: child.completePath ?? (child.name ? [...prefixo, child.name].join('/') : null),
      })),
  }
}

/**
 * Canais ATIVOS da conta (`GET /rest/api/marketplaces`).
 *
 * Medido: array de strings — `["AMAZON_GLOBAL_API","MAGAZINE_LUIZA","MERCADO_LIVRE",
 * "NUVEMSHOP","SHOPEE"]`. É a resposta que faltava para "quais canais checar" e é
 * melhor que a lista configurada à mão: vem da conta, não de um campo que alguém
 * esqueceu de atualizar. Aceita também `[{ code }]` por segurança.
 */
export function normalizeAccountMarketplaces(payload) {
  const list = Array.isArray(payload) ? payload : payload?.marketPlaces ?? payload?.marketplaces ?? extractItems(payload)

  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(typeof item === 'object' ? item?.code ?? item?.marketPlace ?? '' : item).trim().toUpperCase())
        .filter(Boolean)
    ),
  ].sort()
}

/**
 * Converte o `completePath` do drill-down (§1.4, separador "/") no formato que o PUT
 * de vínculo espera (§1.5, separador " > ").
 *
 * Ponto de atenção explícito da especificação: reaproveitar a string como veio manda
 * "A/B/C" num campo que o painel lê como um único nome de nível. Aceita array (o
 * breadcrumb já quebrado) e string já no formato ">" — idempotente de propósito,
 * porque o valor chega de três origens diferentes (sugestão, drill-down, re-vínculo).
 */
export function toBindCompletePath(rawPath) {
  if (Array.isArray(rawPath)) {
    return rawPath
      .map((part) => String(typeof part === 'object' ? part?.name ?? '' : part).trim())
      .filter(Boolean)
      .join(' > ')
  }

  const text = String(rawPath ?? '').trim()
  if (!text) return ''
  if (text.includes('>')) {
    // Já está no formato do PUT — só normaliza o espaçamento em volta da seta.
    return text
      .split('>')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' > ')
  }

  return text
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' > ')
}

// ── §2 — API pública v2 (contrato estável) ─────────────────────────────────────

/**
 * Catálogo de canais que a AnyMarket suporta (`GET /v2/marketplaces`).
 *
 * Confirmado contra conta real: devolve `{ marketplaces: [{ code, name }] }` — 148
 * canais. É o catálogo da plataforma, NÃO a lista de canais ativos da conta (essa
 * não tem endpoint público conhecido). Serve para validar o código digitado e para
 * mostrar nome legível no lugar de `MERCADO_LIVRE`.
 *
 * Cuidado medido: `GET /v2/marketplaces/{code}` responde 500 "This method is
 * restricted for ANYMARKET use." — só a listagem é liberada.
 */
export async function fetchMarketplaceCatalog(token) {
  return normalizeMarketplaceCatalog(await anymarketRequest({ method: 'GET', path: '/marketplaces', token }))
}

/** `{ marketplaces: [{ code, name }] }` → lista normalizada. Puro, testável sem rede. */
export function normalizeMarketplaceCatalog(payload) {
  const list = payload?.marketplaces ?? extractItems(payload)

  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      code: String(item?.code ?? '').trim().toUpperCase() || null,
      name: item?.name ?? item?.description ?? null,
    }))
    .filter((item) => item.code)
}
/**
 * §2b — Atributos de UMA categoria num canal específico via painel (endpoint direto).
 *
 * `GET /rest/api/marketplace_category_attributes/categories/{id}/marketplaces/{mp}/attributes/`
 *
 * Descoberto por engenharia reversa em 21/08/2026. Muito mais eficiente que varrer
 * `/v2/categories/characteristics/groups` da conta inteira:
 *   - 1 chamada vs. N páginas paginadas
 *   - Resposta imediata vs. 10+ minutos
 *   - Atributos já filtrados pelo canal correto
 *
 * Usa o token do PAINEL (não o de API). Lança se o token estiver ausente/expirado —
 * quem chama deve capturar e cair no fallback via `fetchCharacteristicGroups`.
 *
 * Campos da resposta:
 *   - `description`       → nome legível do atributo
 *   - `codeInMarketPlace` → código do atributo no marketplace (ex: "BRAND")
 *   - `required`          → obrigatório para publicar?
 *   - `recommended`       → recomendado pelo marketplace?
 *   - `requireValueBind`  → precisa de vínculo de valor (de-para de valor)?
 *   - `valueCount`        → quantos valores possíveis existem
 *   - `hidden`            → atributo interno, não mostrar ao operador
 */
export async function fetchCategoryMarketplaceAttributes(panelToken, anymarketCategoryId, marketplace) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const mp = assertMarketplace(marketplace)

  const payload = await panelRequest({
    token: panelToken,
    method: 'GET',
    path: `/marketplace_category_attributes/categories/${encodeURIComponent(categoryId)}/marketplaces/${encodeURIComponent(mp)}/attributes/`,
  })

  const items = Array.isArray(payload) ? payload : (payload?.attributes ?? payload?.items ?? [])

  return items
    .filter((item) => item && !item.hidden)
    .map((item) => ({
      id: item.id ?? null,
      name: String(item.description ?? item.name ?? '').trim(),
      codeInMarketPlace: String(item.codeInMarketPlace ?? '').trim(),
      required: Boolean(item.required),
      recommended: Boolean(item.recommended),
      requireValueBind: Boolean(item.requireValueBind),
      valueCount: Number(item.valueCount ?? 0),
      valueType: item.valueType ? String(item.valueType).toUpperCase() : (item.requireValueBind || Number(item.valueCount) > 0) ? 'LIST' : 'TEXT',
      allowedValues: Array.isArray(item.values) ? item.values : Array.isArray(item.allowedValues) ? item.allowedValues : null,
      marketplace: mp,
    }))
    .filter((item) => item.name && item.codeInMarketPlace)
}


/**
 * Grupos de características do hub, paginado (fallback quando o token do painel
 * não está disponível para `fetchCategoryMarketplaceAttributes`).
 *
 * Varre TODA a conta — usar só quando necessário.
 */
export async function fetchCharacteristicGroups(token, { limit, maxPages, onProgress = null } = {}) {
  const { items, pages, truncated } = await paginate(
    ({ offset, limit: pageLimit, nextUrl }) =>
      nextUrl
        ? anymarketRequest({ method: 'GET', url: nextUrl, token, bulk: true })
        : anymarketRequest({
            method: 'GET',
            path: '/categories/characteristics/groups',
            token,
            params: { offset, limit: pageLimit },
            bulk: true,
          }),
    {
      limit: limit ?? channelBindConfig.attributesPageSize,
      maxPages: maxPages ?? channelBindConfig.attributesMaxPages,
      onProgress,
    }
  )

  if (truncated) {
    console.warn(
      `[ChannelBindClient] Paginação de características interrompida em ${pages} páginas (maxPages). A lista de atributos pode estar incompleta.`
    )
  }

  return { raw: items, pages, truncated }
}

/** Valores possíveis de um atributo do tipo LIST. */
export async function fetchVariationValues(token, typeId) {
  const payload = await anymarketRequest({
    method: 'GET',
    path: `/variations/${encodeURIComponent(typeId)}/values`,
    token,
  })
  return extractItems(payload)
    .map((item) => ({ id: item?.id ?? null, value: item?.value ?? item?.name ?? item?.description ?? null }))
    .filter((item) => item.value)
}

/**
 * Grava valores de atributo no produto.
 *
 * PATCH parcial: manda só `characteristics`. `anymarketRequest` já cuida do
 * merge-patch (RFC 7396) que o PATCH da AnyMarket exige.
 */
export async function patchProductCharacteristics(token, productId, characteristics, { dryRun = false } = {}) {
  const data = { characteristics }
  console.log(`[ChannelBindClient] PATCH /products/${productId} → ${characteristics.length} atributo(s)`)

  if (isDryRun(dryRun)) {
    console.warn('[ChannelBindClient] ANYMARKET_DRY_RUN ativo — atributos do produto NÃO foram gravados.')
    return { id: productId, ...data, dryRun: true }
  }

  return anymarketRequest({ method: 'PATCH', path: `/products/${encodeURIComponent(productId)}`, token, data })
}

/**
 * Transmissões não publicadas — sinal EM LOTE de problema de publicação (§1.2/§2).
 *
 * Não diz sozinho que a causa é de-para faltando: `transmissionMessage` é texto
 * livre do marketplace. Serve para priorizar o que checar, não como veredito.
 */
export async function fetchUnpublishedTransmissions(token, { limit, maxPages } = {}) {
  const { items, pages, truncated } = await paginate(
    ({ offset, limit: pageLimit, nextUrl }) =>
      nextUrl
        ? anymarketRequest({ method: 'GET', url: nextUrl, token, bulk: true })
        : anymarketRequest({
            method: 'GET',
            path: '/transmissions',
            token,
            params: { statusFilter: 'UNPUBLISHED', offset, limit: pageLimit },
            bulk: true,
          }),
    {
      limit: limit ?? channelBindConfig.transmissionsPageSize,
      maxPages: maxPages ?? channelBindConfig.transmissionsMaxPages,
    }
  )

  return { raw: items, pages, truncated }
}
