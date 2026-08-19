/**
 * Cache em memória da árvore de categorias do AnyMarket, por cliente.
 *
 * Mesmo padrão do promptCache.js (TTL + invalidação explícita por cliente): um lote
 * de 50 produtos não pode reler a árvore inteira 50 vezes, nem do Firestore nem da
 * API do AnyMarket.
 *
 * O TTL é maior que o do promptCache porque árvore de categorias muda pouco — e
 * toda criação feita pelo próprio CRIA faz upsert aqui na hora (`upsertNode`), sem
 * esperar expiração. O risco de cache velho está coberto pelo estágio 0 do funil,
 * que reconfere na API antes de criar (§7).
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000

class CategoryTreeCache {
  constructor(defaultTtlMs = DEFAULT_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs
    this.cache = new Map()
    this.hits = 0
    this.misses = 0
  }

  get(clientId) {
    const entry = this.cache.get(clientId)

    if (!entry) {
      this.misses++
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(clientId)
      this.misses++
      return null
    }

    this.hits++
    return entry.data
  }

  /** @param {{nodes: Array<object>, syncedAt: string, source: string}} data */
  set(clientId, data, ttlMs = this.defaultTtlMs) {
    this.cache.set(clientId, {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    })
    return data
  }

  /**
   * Insere ou atualiza um nó sem invalidar a árvore inteira — usado depois de criar
   * categoria, para que o nível seguinte da mesma cauda já enxergue o pai novo.
   * Sem isso, criar "Automotivo > Acessórios > Tapetes" de uma vez exigiria três
   * ressincronizações completas.
   */
  upsertNode(clientId, node) {
    const entry = this.cache.get(clientId)
    if (!entry || Date.now() > entry.expiresAt) return null

    const nodes = entry.data.nodes.filter((n) => n.anymarketId !== node.anymarketId)
    nodes.push(node)

    // O pai passou a ter filho — manter a flag coerente evita tratar nó-pai como folha.
    if (node.parentId) {
      const parent = nodes.find((n) => n.anymarketId === node.parentId)
      if (parent) parent.hasChildren = true
    }

    entry.data = { ...entry.data, nodes, nodeCount: nodes.length }
    return entry.data
  }

  invalidateClient(clientId) {
    return this.cache.delete(clientId) ? 1 : 0
  }

  clear() {
    const count = this.cache.size
    this.cache.clear()
    return count
  }

  stats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0,
    }
  }
}

export const categoryTreeCache = new CategoryTreeCache()
export default categoryTreeCache
