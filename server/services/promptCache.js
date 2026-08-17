/**
 * Cache em memória para resolução de prompts (promptResolver).
 *
 * Evita repetição excessiva de leituras no Firestore durante o processamento
 * de lotes de produtos.
 * Invalida automaticamente por TTL (padrão: 10 minutos) ou quando houver
 * alterações explícitas em regras, base de conhecimento ou prompts do cliente.
 */

class PromptCache {
  constructor(defaultTtlMs = 10 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs
    this.cache = new Map()
    this.hits = 0
    this.misses = 0
  }

  _makeKey(clientId, promptType) {
    return `${clientId}:${promptType}`
  }

  get(clientId, promptType) {
    const key = this._makeKey(clientId, promptType)
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    this.hits++
    return entry.data
  }

  set(clientId, promptType, data, ttlMs = this.defaultTtlMs) {
    const key = this._makeKey(clientId, promptType)
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    })
  }

  /**
   * Invalida todas as chaves associadas a um cliente (ex: ao atualizar regras, prompts ou .md)
   */
  invalidateClient(clientId) {
    let deletedCount = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${clientId}:`)) {
        this.cache.delete(key)
        deletedCount++
      }
    }
    return deletedCount
  }

  clear() {
    const count = this.cache.size
    this.cache.clear()
    return count
  }

  stats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)).toFixed(3) : 0,
    }
  }
}

export const promptCache = new PromptCache()
export default promptCache
