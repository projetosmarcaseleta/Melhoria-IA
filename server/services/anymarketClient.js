/**
 * Cliente HTTP direto da API v2 do AnyMarket.
 *
 * Decisão D2 (docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md §4): o fluxo de
 * categorias fala direto com `api.anymarket.com.br`, sem passar pelo n8n. O funil
 * de dedup precisa de leitura síncrona da árvore, de checagem por `partnerId`
 * imediatamente antes do POST e de criação sequencial nível a nível reusando o id
 * do pai — empacotar isso em webhook esconderia erro parcial e deixaria a
 * idempotência fora do processo que detém o lock.
 *
 * O n8n continua dono do caminho legado de PATCH de título/descrição
 * (server/routes/anymarket.js → ANYMARKET_WEBHOOK_URL). Este módulo não o toca.
 *
 * Segurança: o token NUNCA vem do corpo da requisição HTTP nas rotas novas. É
 * resolvido aqui, no servidor, a partir do clientId (§3).
 */

import axios from 'axios'
import { db } from './firebaseAdmin.js'
import { isTestClient, getMockClient } from './mockStorage.js'

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const anymarketConfig = {
  baseUrl: (process.env.ANYMARKET_API_URL || 'https://api.anymarket.com.br/v2').replace(/\/+$/, ''),
  timeoutMs: num(process.env.ANYMARKET_TIMEOUT_MS, 30_000),
  maxRetries: num(process.env.ANYMARKET_MAX_RETRIES, 3),
  // Conservador de propósito: não há número público confiável de limite por token,
  // e estourar cota numa conta de cliente é pior que sincronizar meio minuto mais devagar.
  maxConcurrent: Math.max(1, num(process.env.ANYMARKET_MAX_CONCURRENT, 4)),
  minIntervalMs: num(process.env.ANYMARKET_MIN_INTERVAL_MS, 120),
  // Varredura de árvore inteira é dezenas de chamadas seguidas. Numa conta com
  // 4.700 categorias são 47+ páginas, e a API respondeu 429 pedindo 53s de pausa —
  // sinal de cota por janela de ~60s. Paginação anda em fila separada e lenta,
  // para não competir com as leituras interativas nem queimar a cota do cliente.
  bulkMinIntervalMs: num(process.env.ANYMARKET_BULK_INTERVAL_MS, 900),
  pageSize: Math.max(1, num(process.env.ANYMARKET_PAGE_SIZE, 100)),
  maxPages: Math.max(1, num(process.env.ANYMARKET_MAX_PAGES, 500)),
  // Espera máxima honrada de um Retry-After. Acima disso, a chamada falha e o
  // chamador decide — 3 minutos preso num request HTTP é pior que erro explícito.
  maxRetryWaitMs: num(process.env.ANYMARKET_MAX_RETRY_WAIT_MS, 60_000),
}

/**
 * Media type do corpo por método.
 *
 * PATCH no AnyMarket exige merge-patch (RFC 7396): com `application/json` a API
 * responde 415 "O Content Type application/json não é suportado". Não é dedução — é o
 * header que o workflow n8n 02 deste repo já sobrescrevia, e que eu deixei de
 * replicar ao trocar o webhook por HTTP direto.
 */
export function defaultContentTypeFor(method) {
  return String(method ?? 'GET').toUpperCase() === 'PATCH' ? 'application/merge-patch+json' : 'application/json'
}

export class AnymarketApiError extends Error {
  constructor(message, { status = null, data = null, method = null, path = null, cause = null } = {}) {
    super(message)
    this.name = 'AnymarketApiError'
    this.status = status
    this.data = data
    this.method = method
    this.path = path
    this.cause = cause
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Limitador com duas travas: concorrência máxima e intervalo mínimo entre inícios.
 *
 * A checagem e o incremento de `active` acontecem no mesmo tick, sem await entre
 * eles — é o que garante que dois chamadores não passem pela mesma vaga.
 */
export class RateLimiter {
  constructor({ maxConcurrent = 4, minIntervalMs = 0 } = {}) {
    this.maxConcurrent = Math.max(1, maxConcurrent)
    this.minIntervalMs = Math.max(0, minIntervalMs)
    this.active = 0
    this.lastStartAt = 0
    this.waiters = []
  }

  async run(task) {
    await this._acquire()
    try {
      return await task()
    } finally {
      this._release()
    }
  }

  async _acquire() {
    if (this.active >= this.maxConcurrent) {
      await new Promise((resolve) => this.waiters.push(resolve))
    }
    this.active++

    // A janela de tempo é RESERVADA antes de dormir, não depois de acordar. Se o
    // cálculo dependesse de `lastStartAt` só na volta do sleep, N chamadores
    // concorrentes leriam todos o mesmo valor e disparariam juntos — o intervalo
    // mínimo não se acumulava e o limitador virava enfeite.
    const now = Date.now()
    const scheduledAt = Math.max(now, this.lastStartAt + this.minIntervalMs)
    this.lastStartAt = scheduledAt

    const wait = scheduledAt - now
    if (wait > 0) await sleep(wait)
  }

  _release() {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}

/** Fila das leituras interativas (categoria atual do produto, checagem de partnerId). */
const limiter = new RateLimiter({
  maxConcurrent: anymarketConfig.maxConcurrent,
  minIntervalMs: anymarketConfig.minIntervalMs,
})

/** Fila lenta e serial da paginação de árvore. */
const bulkLimiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: anymarketConfig.bulkMinIntervalMs })

/**
 * Desaceleração adaptativa: um 429 significa que o ritmo configurado não serve para
 * ESTA conta. Em vez de repetir o mesmo ritmo até o fim da sincronização, os dois
 * limitadores ficam mais lentos pelo resto do processo — a cota é por token, então
 * a leitura interativa também precisa recuar.
 */
export function slowDownAfterThrottle(retryAfterMs) {
  const suggested = Math.min(5_000, Math.max(1_200, Math.round((retryAfterMs ?? 1_000) / 20)))

  if (suggested > bulkLimiter.minIntervalMs) {
    console.warn(
      `[AnymarketClient] 429 recebido — intervalo da paginação: ${bulkLimiter.minIntervalMs}ms → ${suggested}ms pelo resto do processo.`
    )
    bulkLimiter.minIntervalMs = suggested
  }
  limiter.minIntervalMs = Math.max(limiter.minIntervalMs, Math.round(suggested / 3))
}

export function getPacing() {
  return { interactiveMs: limiter.minIntervalMs, bulkMs: bulkLimiter.minIntervalMs }
}

/**
 * Só segue link de paginação em HTTPS e no mesmo host configurado.
 *
 * A API devolve `_links.next.href` em **http://** — seguir como veio manda o
 * gumgaToken em texto claro pela rede. E aceitar host arbitrário de um campo de
 * resposta é entregar o token para onde o payload apontar.
 */
export function normalizeFollowUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(String(rawUrl))
  } catch {
    throw new AnymarketApiError(`Link de paginação inválido devolvido pela API: ${rawUrl}`, { status: 502 })
  }

  if (parsed.protocol === 'http:') parsed.protocol = 'https:'

  const expectedHost = new URL(anymarketConfig.baseUrl).host
  if (parsed.host !== expectedHost) {
    throw new AnymarketApiError(
      `Link de paginação aponta para host inesperado (${parsed.host}); esperado ${expectedHost}. Chamada recusada para não expor o token.`,
      { status: 502 }
    )
  }

  return parsed.toString()
}

/** Converte o header Retry-After (segundos ou data HTTP) em ms. */
export function parseRetryAfter(header) {
  if (!header) return null

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())

  return null
}

function isRetryable(status) {
  return status === null || status === 408 || status === 429 || status >= 500
}

/**
 * Executa uma chamada à API do AnyMarket com rate limit e retry.
 *
 * Retry apenas em 429/5xx/timeout/rede. 4xx (fora de 408/429) é erro de contrato —
 * repetir só multiplica a chamada errada.
 */
export async function anymarketRequest({
  method = 'GET',
  path = '',
  url = null,
  token,
  params = undefined,
  data = undefined,
  timeoutMs = anymarketConfig.timeoutMs,
  bulk = false,
  contentType = null,
}) {
  if (!token) {
    throw new AnymarketApiError('Token AnyMarket (gumgaToken) ausente na chamada.', { method, path })
  }

  // O PATCH do AnyMarket recusa `application/json` com HTTP 415: exige merge-patch
  // (RFC 7396). Não é dedução — é o que o workflow n8n 02 deste repo já fazia, e foi
  // o header que eu deixei de replicar quando troquei o webhook por HTTP direto.
  let mediaType = contentType ?? defaultContentTypeFor(method)

  const target = url ? normalizeFollowUrl(url) : `${anymarketConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const queue = bulk ? bulkLimiter : limiter
  let lastError = null

  for (let attempt = 0; attempt <= anymarketConfig.maxRetries; attempt++) {
    try {
      const response = await queue.run(() =>
        axios({
          method,
          url: target,
          params,
          data,
          timeout: timeoutMs,
          headers: {
            gumgaToken: token,
            Accept: 'application/json',
            // Sem corpo, sem Content-Type: servidor estrito responde 415 a um GET que
            // declara mídia e não manda nada.
            ...(data === undefined ? {} : { 'Content-Type': mediaType }),
          },
        })
      )
      return response.data
    } catch (err) {
      const status = err.response?.status ?? null
      const body = err.response?.data ?? null
      lastError = new AnymarketApiError(
        status ? `AnyMarket respondeu HTTP ${status} em ${method} ${path || target}` : `Falha de rede em ${method} ${path || target}: ${err.message}`,
        { status, data: body, method, path: path || target, cause: err }
      )

      // 415 é erro de contrato, não de carga: tentar o outro media type uma vez
      // resolve sem depender de eu ter acertado o padrão de cada endpoint.
      if (status === 415 && data !== undefined) {
        const alternativa = mediaType === 'application/merge-patch+json' ? 'application/json' : 'application/merge-patch+json'
        if (mediaType !== alternativa && attempt < anymarketConfig.maxRetries) {
          console.warn(`[AnymarketClient] ${method} ${path || target} → 415 com "${mediaType}"; tentando "${alternativa}".`)
          mediaType = alternativa
          continue
        }
      }

      if (!isRetryable(status) || attempt === anymarketConfig.maxRetries) break

      const retryAfter = parseRetryAfter(err.response?.headers?.['retry-after'])

      if (status === 429) {
        lastError.throttled = true
        lastError.retryAfterMs = retryAfter
        slowDownAfterThrottle(retryAfter)
      }

      const backoff = retryAfter ?? Math.round(500 * 2 ** attempt + Math.random() * 250)

      // Retry-After maior que o teto vira erro explícito: deixar o operador olhando
      // uma tela travada por minutos é pior que devolver "cota estourada, retome depois".
      if (backoff > anymarketConfig.maxRetryWaitMs) {
        console.error(
          `[AnymarketClient] ${method} ${path || target} → ${status}; API pediu ${Math.round(backoff / 1000)}s de espera, acima do teto de ${Math.round(anymarketConfig.maxRetryWaitMs / 1000)}s. Abortando.`
        )
        break
      }

      console.warn(
        `[AnymarketClient] ${method} ${path || target} → ${status ?? 'rede'}; aguardando ${Math.round(backoff / 1000)}s (tentativa ${attempt + 1}/${anymarketConfig.maxRetries})`
      )
      await sleep(backoff)
    }
  }

  throw lastError
}

/** Extrai a lista de itens de um payload paginado, aceitando as formas conhecidas. */
export function extractItems(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.content)) return payload.content
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.categories)) return payload.categories
  if (Array.isArray(payload.items)) return payload.items
  return []
}

/** Descobre o link da próxima página (HAL `_links.next` ou variações). */
export function extractNextUrl(payload) {
  if (!payload || Array.isArray(payload)) return null

  const halNext = payload._links?.next?.href ?? payload.links?.next?.href
  if (typeof halNext === 'string' && halNext) return halNext

  if (Array.isArray(payload.links)) {
    const next = payload.links.find((link) => link?.rel === 'next' && link?.href)
    if (next) return next.href
  }

  if (typeof payload.next === 'string' && payload.next) return payload.next

  return null
}

/**
 * Percorre todas as páginas de um endpoint de listagem.
 *
 * Segue `_links.next` quando a API oferece; senão avança por offset/limit até vir
 * página incompleta. `maxPages` é um freio contra laço infinito por resposta
 * inesperada — e quando ele atua, `truncated` volta true para o chamador poder
 * avisar em vez de fingir que leu tudo.
 *
 * @param {(args: {offset: number, limit: number, nextUrl: string|null}) => Promise<any>} fetchPage
 */
export async function paginate(
  fetchPage,
  { limit = anymarketConfig.pageSize, maxPages = anymarketConfig.maxPages, resumeFrom = null, onProgress = null } = {}
) {
  const items = resumeFrom?.items ? [...resumeFrom.items] : []
  let offset = resumeFrom?.offset ?? 0
  let pages = 0
  let nextUrl = resumeFrom?.nextUrl ?? null
  let hasMore = true

  while (hasMore && pages < maxPages) {
    let payload
    try {
      payload = await fetchPage({ offset, limit, nextUrl })
    } catch (err) {
      // Falhar na página 47 e perder as 46 anteriores é desperdício de cota — o
      // checkpoint volta junto com o erro para a próxima chamada continuar daqui.
      err.checkpoint = { items, offset, nextUrl, pagesDone: pages }
      err.partialItems = items
      throw err
    }

    const batch = extractItems(payload)
    items.push(...batch)
    pages++
    onProgress?.({ pages, itemCount: items.length })

    nextUrl = extractNextUrl(payload)
    if (nextUrl) {
      hasMore = true
    } else {
      hasMore = batch.length >= limit
      offset += limit
    }
  }

  return { items, pages, truncated: hasMore && pages >= maxPages, nextUrl, offset }
}

/**
 * Resolve o token do AnyMarket a partir do clientId — sempre no servidor.
 *
 * Regra da §3: as rotas de categoria não aceitam `gumgaToken` no corpo. O caminho
 * legado (/api/anymarket/patch) ainda aceita por retrocompatibilidade; o código
 * novo não repete o padrão.
 */
export async function resolveAnymarketToken(clientId) {
  if (!clientId) {
    throw new AnymarketApiError('clientId é obrigatório para resolver o token do AnyMarket.', { status: 400 })
  }

  if (isTestClient(clientId)) {
    return getMockClient(clientId)?.anymarket_token ?? 'test-token'
  }

  let token = null
  try {
    const doc = await db.collection('clients').doc(clientId).get()
    if (doc.exists) token = doc.data()?.anymarket_token ?? null
  } catch (err) {
    console.warn('[AnymarketClient] Aviso ao ler token do cliente no Firestore:', err.message)
  }

  if (!token) {
    // Atenção à diferença: o fluxo legado de publicar título/descrição aceita o token
    // digitado na tela (guardado no localStorage). As rotas de categoria só usam o
    // token GRAVADO NO CLIENTE, porque nunca recebem token pelo corpo da requisição.
    // Operador sem permissão de editar cliente consegue publicar texto mas não usar
    // categorias até um admin salvar o token no cadastro.
    throw new AnymarketApiError(
      'Token AnyMarket não gravado no cadastro deste cliente. Abra ⚙️ Configurações → Token AnyMarket e salve (requer perfil admin), ou cadastre em Admin → Clientes.',
      { status: 400, code: 'token_missing' }
    )
  }

  return token
}

/**
 * Lê a árvore de categorias inteira (lista plana e paginada).
 *
 * Endpoint confirmado no SDK oficial (anymarket-sdk-java, CategoryService):
 * `GET /categories` paginado com navegação por link `next` e filtro `?partnerId=`.
 */
export async function fetchCategories(token, { limit, maxPages, resumeFrom = null, onProgress = null } = {}) {
  const { items, pages, truncated, nextUrl, offset } = await paginate(
    ({ offset: pageOffset, limit: pageLimit, nextUrl: next }) =>
      next
        ? anymarketRequest({ method: 'GET', url: next, token, bulk: true })
        : anymarketRequest({ method: 'GET', path: '/categories', token, params: { offset: pageOffset, limit: pageLimit }, bulk: true }),
    { limit, maxPages, resumeFrom, onProgress }
  )

  if (truncated) {
    console.warn(`[AnymarketClient] Paginação de categorias interrompida em ${pages} páginas (limite maxPages). A árvore pode estar incompleta.`)
  }

  return { raw: items, pages, truncated, nextUrl, offset }
}

/**
 * Achata o payload de `/categories/fullPath`, que pode vir em três formas:
 * árvore aninhada com `children`, lista plana com `path`, ou lista plana com `parent`.
 *
 * Devolve sempre nós no formato `{ id, name, parent: { id } }` — o mesmo que
 * `buildTree` consome do endpoint paginado, para os dois caminhos convergirem.
 */
export function flattenFullPathPayload(payload) {
  const out = []

  const walk = (node, parentId) => {
    if (!node || typeof node !== 'object') return

    const id = node.id ?? node.categoryId ?? null
    const name = node.name ?? node.description ?? null
    if (id !== null && name) {
      out.push({
        id,
        name,
        parent: parentId !== null && parentId !== undefined ? { id: parentId } : node.parent ?? null,
        partnerId: node.partnerId ?? null,
        definitionPriceScope: node.definitionPriceScope ?? null,
        priceFactor: node.priceFactor ?? null,
      })
    }

    const children = node.children ?? node.childs ?? node.subCategories ?? null
    if (Array.isArray(children)) {
      for (const child of children) walk(child, id)
    }
  }

  const roots = extractItems(payload)
  for (const node of roots) walk(node, null)

  return out
}

/**
 * Lê a árvore inteira em UMA chamada (`GET /categories/fullPath`).
 *
 * É o caminho preferido: a varredura paginada de uma conta com 4.700 categorias são
 * 47+ requisições e já rendeu 429 em produção. Este endpoint está documentado na
 * especificação da API do cliente; se não estiver disponível na conta, o chamador
 * cai para a paginação.
 */
export async function fetchCategoriesFullPath(token) {
  const payload = await anymarketRequest({ method: 'GET', path: '/categories/fullPath', token, bulk: true })
  const raw = flattenFullPathPayload(payload)

  if (!raw.length) {
    throw new AnymarketApiError('Endpoint /categories/fullPath respondeu sem categorias reconhecíveis.', {
      status: 502,
      path: '/categories/fullPath',
    })
  }

  return { raw, pages: 1, truncated: false, strategy: 'fullPath' }
}

/**
 * Filhos diretos de uma categoria (`GET /categories/{id}` → `children`).
 *
 * Permite conferir UM nível contra a fonte da verdade sem varrer a árvore: é a
 * checagem barata de "esse filho já existe aqui?" imediatamente antes de criar.
 */
export async function fetchCategoryChildren(token, categoryId) {
  const payload = await anymarketRequest({ method: 'GET', path: `/categories/${encodeURIComponent(categoryId)}`, token })
  const children = payload?.children ?? payload?.childs ?? payload?.subCategories ?? []

  return Array.isArray(children)
    ? children.map((child) => ({
        anymarketId: String(child.id ?? ''),
        name: String(child.name ?? child.description ?? '').trim(),
        partnerId: child.partnerId ?? null,
      })).filter((child) => child.anymarketId && child.name)
    : []
}

/** Busca categorias por `partnerId` — chave natural do estágio 0 do funil (§7). */
export async function findCategoriesByPartnerId(token, partnerId) {
  if (!partnerId) return []
  const payload = await anymarketRequest({ method: 'GET', path: '/categories', token, params: { partnerId } })
  return extractItems(payload)
}

/** Lê um produto no AnyMarket — usado para descobrir a categoria ATUAL (o "de" do modal). */
export async function fetchProduct(token, productId) {
  return anymarketRequest({ method: 'GET', path: `/products/${encodeURIComponent(productId)}`, token })
}

/**
 * Cria categoria. ÚNICA escrita irreversível desta feature.
 *
 * `ANYMARKET_DRY_RUN=true` devolve id fictício sem chamar a API — para ensaiar o
 * fluxo inteiro (funil, lock, cauda, vínculo) sem sujar a árvore do cliente.
 */
export async function createCategory(token, { name, partnerId, parentId = null, priceFactor = 1, definitionPriceScope = 'SKU', dryRun = false }) {
  const payload = {
    name,
    partnerId,
    priceFactor,
    definitionPriceScope,
    ...(parentId ? { parent: { id: Number(parentId) || parentId } } : {}),
  }

  console.log(`[AnymarketClient] POST /categories → ${JSON.stringify(payload)}`)

  if (dryRun || process.env.ANYMARKET_DRY_RUN === 'true') {
    const fakeId = `dry-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    console.warn(`[AnymarketClient] ANYMARKET_DRY_RUN ativo — nada foi criado. Id fictício: ${fakeId}`)
    return { id: fakeId, ...payload, dryRun: true }
  }

  return anymarketRequest({ method: 'POST', path: '/categories', token, data: payload })
}

/**
 * Troca a categoria de um produto (PATCH parcial).
 *
 * Reversível: basta chamar de novo com a categoria anterior — é o que sustenta o
 * desfazer de 1 clique. Contraste com createCategory, que é irreversível na prática.
 */
export async function patchProductCategory(token, productId, categoryId, { dryRun = false } = {}) {
  const payload = { category: { id: Number(categoryId) || categoryId } }

  console.log(`[AnymarketClient] PATCH /products/${productId} → ${JSON.stringify(payload)}`)

  if (dryRun || process.env.ANYMARKET_DRY_RUN === 'true') {
    console.warn('[AnymarketClient] Modo simulado — vínculo não aplicado.')
    return { id: productId, ...payload, dryRun: true }
  }

  return anymarketRequest({ method: 'PATCH', path: `/products/${encodeURIComponent(productId)}`, token, data: payload })
}
