import apiClient from './apiClient'

/**
 * Chamadas do vínculo de categoria por canal (de-para) e dos atributos.
 *
 * O token do AnyMarket NÃO é enviado daqui: o backend resolve pelo clientId, mesma
 * regra do categoryService. Só `applyChannelBinding` e `saveProductAttributes`
 * escrevem — e as duas exigem clique explícito do operador.
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md.
 */

/** Canais configurados para o cliente. `configured: false` = ninguém cadastrou ainda. */
export async function fetchClientMarketplaces(clientId) {
  const { data } = await apiClient.get(`/api/channel-bindings/marketplaces/${clientId}`)
  return data
}

/** Status do de-para canal por canal, checado no hub (não no espelho local). */
export async function fetchBindingStatus(clientId, anymarketCategoryId, { marketplaces = null } = {}) {
  const query = marketplaces?.length ? `?marketplaces=${encodeURIComponent(marketplaces.join(','))}` : ''
  const { data } = await apiClient.get(`/api/channel-bindings/status/${clientId}/${anymarketCategoryId}${query}`, {
    timeout: 60_000,
  })
  return data
}

/** Catálogo de canais da plataforma (`/v2/marketplaces`) — códigos e nomes legíveis. */
export async function fetchMarketplaceCatalog(clientId) {
  const { data } = await apiClient.get(`/api/channel-bindings/catalog/${clientId}`, { timeout: 60_000 })
  return data
}

/** Sugestões automáticas de de-para, com percentual de confiança. */
export async function fetchBindSuggestions(clientId, anymarketCategoryId, marketplace) {
  const { data } = await apiClient.get(
    `/api/channel-bindings/suggestions/${clientId}/${anymarketCategoryId}/${marketplace}`,
    { timeout: 60_000 }
  )
  return data
}

/** Um nível da árvore nativa do canal. Sem `code`, devolve a raiz. */
export async function fetchChannelTree(clientId, marketplace, code = null) {
  const query = code ? `?code=${encodeURIComponent(code)}` : ''
  const { data } = await apiClient.get(`/api/channel-bindings/tree/${clientId}/${marketplace}${query}`, {
    timeout: 60_000,
  })
  return data
}

/**
 * Grava o de-para. São duas chamadas ao AnyMarket no backend, e a primeira é
 * destrutiva — em caso de falha no meio, a resposta de erro traz
 * `code: 'bind_failed_after_clean'` e `detail.retrySafe`, e tentar de novo é seguro.
 */
export async function applyChannelBinding(clientId, { anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source }) {
  const { data } = await apiClient.post(
    '/api/channel-bindings/apply',
    { clientId, anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source },
    { timeout: 90_000 }
  )
  return data
}

/** Diagnóstico em lote pelas transmissões não publicadas. Demorado: sob demanda. */
export async function fetchPendingTransmissions(clientId) {
  const { data } = await apiClient.get(`/api/channel-bindings/pending/${clientId}`, { timeout: 180_000 })
  return data
}

/** Atributos da categoria, opcionalmente já filtrados por canal. */
export async function fetchCategoryAttributes(clientId, anymarketCategoryId, { marketplace = null, withValues = false, refresh = false } = {}) {
  const params = new URLSearchParams()
  if (marketplace) params.set('marketplace', marketplace)
  if (withValues) params.set('withValues', 'true')
  if (refresh) params.set('refresh', 'true')

  const query = params.toString() ? `?${params}` : ''
  const { data } = await apiClient.get(`/api/category-attributes/${clientId}/${anymarketCategoryId}${query}`, {
    timeout: 120_000,
  })
  return data
}

/** O que falta preencher no produto, canal por canal. */
export async function fetchProductAttributeStatus(clientId, productId, { categoryId = null, marketplaces = null } = {}) {
  const params = new URLSearchParams()
  if (categoryId) params.set('categoryId', categoryId)
  if (marketplaces?.length) params.set('marketplaces', marketplaces.join(','))

  const query = params.toString() ? `?${params}` : ''
  const { data } = await apiClient.get(`/api/category-attributes/product/${clientId}/${productId}${query}`, {
    timeout: 90_000,
  })
  return data
}

/** Grava valores de atributo no produto. `updates` = `[{ name, value }]`. */
export async function saveProductAttributes(clientId, productId, updates) {
  const { data } = await apiClient.patch(
    `/api/category-attributes/product/${clientId}/${productId}`,
    { updates },
    { timeout: 90_000 }
  )
  return data
}

/** Preenche atributos com IA com base no título, descrição e características. */
export async function extractAttributesWithAI(clientId, { productId, title, description, characteristics, attributes, scope = 'all' }) {
  const { data } = await apiClient.post(
    '/api/category-attributes/ai-extract',
    { clientId, productId, title, description, characteristics, attributes, scope },
    { timeout: 120_000 }
  )
  return data
}

/**
 * Pede ao CRIA que RESOLVA o de-para de todos os canais pendentes.
 *
 * É o caminho principal: navegar a árvore do canal à mão já existe no painel do
 * AnyMarket. Demora (uma chamada por nível de árvore, por canal, mais o desempate
 * semântico), daí o timeout longo.
 */
export async function proposeChannelBindings(clientId, { anymarketCategoryId, marketplaces = null, includeBound = false } = {}) {
  const { data } = await apiClient.post(
    '/api/channel-bindings/propose',
    { clientId, anymarketCategoryId, marketplaces, includeBound },
    { timeout: 300_000 }
  )
  return data
}

/**
 * Aplica as propostas confirmadas — uma confirmação, N canais.
 *
 * Resposta 207 significa parcial: `applied` e `failed` vêm preenchidos e a UI tem de
 * mostrar os dois. Axios não trata 207 como erro, então o caminho normal já cobre isso.
 */
export async function applyChannelBindingsBatch(clientId, bindings) {
  const { data } = await apiClient.post('/api/channel-bindings/apply-batch', { clientId, bindings }, { timeout: 300_000 })
  return data
}
