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

    // Resoluções em andamento, para o single-flight de getOrCreate().
    this.inFlight = new Map()
    this.coalesced = 0

    // Contador de invalidações. Serve para descartar o resultado de uma resolução que
    // começou ANTES de uma invalidação e terminou depois — sem isso, ela repovoaria o
    // cache com dado velho e a regra recém-aprovada só valeria 10 minutos depois.
    this.version = 0
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
   * Resolve com single-flight: N chamadores concorrentes para a mesma chave executam
   * `factory` UMA vez e compartilham o resultado.
   *
   * Motivo: resolver um prompt custa 5 consultas ao Firestore (prompt, regras, chunks,
   * few-shots, skills) e o resultado não depende do produto. No começo de um lote, as
   * requisições chegam praticamente juntas, todas erram o cache no mesmo instante e cada
   * uma refazia o fan-out completo — dezenas de vezes o mesmo trabalho, e a latência
   * disso entrava no tempo do primeiro produto.
   */
  async getOrCreate(clientId, promptType, factory) {
    const cached = this.get(clientId, promptType)
    if (cached) return cached

    const key = this._makeKey(clientId, promptType)

    const flying = this.inFlight.get(key)
    if (flying) {
      this.coalesced++
      return flying
    }

    const versionAoIniciar = this.version

    const promise = (async () => factory())()
      .then((data) => {
        // Só popula o cache se nada foi invalidado no meio do caminho. O chamador recebe
        // o dado de qualquer forma — é o mesmo que ele obteria hoje, resolvendo sozinho.
        if (this.version === versionAoIniciar) this.set(clientId, promptType, data)
        return data
      })
      .finally(() => {
        this.inFlight.delete(key)
      })

    this.inFlight.set(key, promise)
    return promise
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

    // Sobe a versão global, não só a do cliente: descartar por engano uma resolução em voo
    // de OUTRO cliente custa uma recomputação, enquanto deixar passar uma stale custa 10
    // minutos de prompt errado. O lado conservador aqui é o barato.
    this.version++
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(`${clientId}:`)) this.inFlight.delete(key)
    }

    return deletedCount
  }

  clear() {
    const count = this.cache.size
    this.cache.clear()
    this.inFlight.clear()
    this.version++
    return count
  }

  stats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)).toFixed(3) : 0,
      // Resoluções que não aconteceram porque outra igual já estava em voo.
      resolucoesEconomizadas: this.coalesced,
      emVoo: this.inFlight.size,
    }
  }
}

export const promptCache = new PromptCache()
export default promptCache
