import apiClient from './apiClient'

/**
 * Chamadas da feature de categorias do AnyMarket.
 *
 * O token do AnyMarket NÃO é enviado daqui: o backend resolve pelo clientId.
 * Só `approve` e `attach` escrevem no AnyMarket — e ambos exigem confirmação
 * explícita do operador no modal.
 */

/** Config da skill — a UI usa para decidir se mostra o botão de categoria. */
export async function fetchCategoryConfig(clientId) {
  const { data } = await apiClient.get(`/api/categories/config/${clientId}`)
  return data
}

/** Categoria atual do produto (o "de" da substituição). */
export async function fetchCurrentCategory(clientId, productId) {
  const { data } = await apiClient.get(`/api/categories/product/${clientId}/${productId}`)
  return data.currentCategory
}

/** Analisa o produto e devolve a proposta. Não escreve nada. */
export async function suggestCategory(clientId, product) {
  const { data } = await apiClient.post('/api/categories/suggest', { clientId, product }, { timeout: 90_000 })
  return data
}

/** Cria no AnyMarket a cauda faltante da proposta. Irreversível. */
export async function approveCategory(clientId, proposalId, { confirmNewRoot = false } = {}) {
  const { data } = await apiClient.post(
    '/api/categories/approve',
    { clientId, proposalId, confirmNewRoot },
    { timeout: 90_000 }
  )
  return data
}

export async function rejectCategory(clientId, proposalId, reason = null) {
  const { data } = await apiClient.post('/api/categories/reject', { clientId, proposalId, reason })
  return data
}

/** Substitui a categoria do produto. Reversível por undoCategoryAttach. */
export async function attachCategory(clientId, { productId, productIds, categoryId, proposalId }) {
  const { data } = await apiClient.post(
    '/api/categories/attach',
    { clientId, productId, productIds, categoryId, proposalId },
    { timeout: 90_000 }
  )
  return data
}

/** Devolve o produto à categoria anterior. */
export async function undoCategoryAttach(clientId, attachmentId) {
  const { data } = await apiClient.post('/api/categories/attach/undo', { clientId, attachmentId })
  return data
}

export async function fetchCategoryTree(clientId, { refresh = false } = {}) {
  const { data } = await apiClient.get(`/api/categories/tree/${clientId}${refresh ? '?refresh=true' : ''}`, {
    timeout: 120_000,
  })
  return data
}

/**
 * Ressincroniza a árvore. Operação deliberada e demorada em contas grandes:
 * dezenas de páginas na API do AnyMarket em ritmo lento, para não estourar a cota.
 * Se falhar no meio, devolve `resumable: true` — chamar de novo continua de onde parou.
 */
export async function syncCategoryTree(clientId) {
  const { data } = await apiClient.post(`/api/categories/sync/${clientId}`, {}, { timeout: 300_000 })
  return data
}

export async function fetchCategoryDuplicates(clientId) {
  const { data } = await apiClient.get(`/api/categories/duplicates/${clientId}`, { timeout: 120_000 })
  return data
}
