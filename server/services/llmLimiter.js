/**
 * Limitador adaptativo de concorrência das chamadas ao LLM.
 *
 * Motivo de existir: a concorrência real da geração era decidida no navegador
 * (`AI_CONCURRENCY = 50` no ProductTable/ReviewPanel) — um número fixo, chutado a partir
 * do tier da conta, que nenhum código conseguia corrigir quando a conta apertava. Pior:
 * como cada worker fazia uma requisição HTTP de um produto, o limite de ~6 conexões por
 * origem do HTTP/1.1 no navegador transformava os 50 em ~6 de verdade.
 *
 * Agora o teto vive aqui, do lado do servidor, onde os headers de rate limit da OpenAI são
 * visíveis, e se ajusta sozinho (AIMD): sobe de pouco em pouco enquanto a conta tem folga,
 * cai pela metade quando aperta.
 *
 * Sobre o sinal usado para recuar: o SDK da OpenAI já retenta 429 internamente
 * (`maxRetries: 2`), então um 429 só chega até aqui depois de todas as tentativas — tarde
 * demais para servir de aviso. Por isso o sinal principal é PREVENTIVO: os headers
 * `x-ratelimit-remaining-*` vêm nas respostas de SUCESSO e mostram a cota encostando no
 * limite antes do primeiro erro. O 429 que escapa continua tratado, como rede de segurança.
 *
 * O estado é em memória e por processo — mesmo critério dos outros caches do projeto.
 * Rodar em pm2 cluster mode multiplicaria este teto pelo número de workers.
 */

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const llmConfig = (() => {
  const maxConcurrent = Math.max(1, num(process.env.LLM_MAX_CONCURRENT, 60))
  const minConcurrent = clamp(Math.max(1, num(process.env.LLM_MIN_CONCURRENT, 4)), 1, maxConcurrent)

  return {
    // A unidade é CHAMADA, não produto: título e descrição do mesmo produto são duas
    // chamadas e ocupam dois slots. 60 chamadas ≈ 30 produtos em voo.
    maxConcurrent,
    minConcurrent,
    // Começa conservador e sobe. O caminho contrário (começar no teto e recuar) gasta o
    // início de cada lote tomando 429, que é justamente o que custa mais tempo.
    startConcurrent: clamp(Math.max(1, num(process.env.LLM_START_CONCURRENT, 16)), minConcurrent, maxConcurrent),
    // Quantas chamadas seguidas com folga de cota antes de abrir mais vagas.
    rampAfter: Math.max(1, num(process.env.LLM_RAMP_AFTER, 24)),
    rampStep: Math.max(1, num(process.env.LLM_RAMP_STEP, 4)),
    // Folga mínima de cota para o teto continuar subindo. Abaixo da metade disso, recua.
    headroomFloor: clamp(num(process.env.LLM_HEADROOM_FLOOR, 0.2), 0, 1),
  }
})()

/** Lê um header aceitando tanto `Headers` (fetch) quanto objeto simples. */
function headerValue(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] ?? headers[String(name).toLowerCase()] ?? null
}

/**
 * Menor folga de cota declarada pela resposta, entre requisições e tokens — de 0 (cota
 * esgotada) a 1 (intacta). Devolve null quando a conta não manda os headers.
 *
 * O mínimo entre os dois é de propósito: numa conta com prompt grande, `tokens` esgota
 * muito antes de `requests`, e olhar só para requisições daria folga que não existe.
 */
export function remainingFraction(headers) {
  const fractions = []

  for (const unit of ['requests', 'tokens']) {
    const remaining = Number(headerValue(headers, `x-ratelimit-remaining-${unit}`))
    const limit = Number(headerValue(headers, `x-ratelimit-limit-${unit}`))
    if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
      fractions.push(clamp(remaining / limit, 0, 1))
    }
  }

  return fractions.length > 0 ? Math.min(...fractions) : null
}

/** 429 da OpenAI, já esgotados os retries do SDK. */
export function isRateLimitError(err) {
  const status = err?.status ?? err?.response?.status ?? null
  return status === 429 || err?.code === 'rate_limit_exceeded'
}

export class AdaptiveLimiter {
  constructor({ start, min, max, rampAfter, rampStep, headroomFloor }) {
    this.limit = start
    this.min = min
    this.max = max
    this.rampAfter = rampAfter
    this.rampStep = rampStep
    this.headroomFloor = headroomFloor

    this.active = 0
    this.waiters = []

    // Observabilidade — lida por /api/diagnostics.
    this.successStreak = 0
    this.throttles = 0
    this.shrinks = 0
    this.expansions = 0
    this.peakActive = 0
    this.lastHeadroom = null
  }

  async acquire() {
    // `while`, não `if`: acordar um waiter não reserva a vaga (o `active++` só acontece no
    // microtask seguinte), então quem acorda precisa reconferir. Sem isso, dois waiters
    // acordados no mesmo tick passariam juntos e o teto viraria enfeite.
    while (this.active >= this.limit) {
      await new Promise((resolve) => this.waiters.push(resolve))
    }

    this.active++
    if (this.active > this.peakActive) this.peakActive = this.active
  }

  release() {
    this.active = Math.max(0, this.active - 1)
    this._wake(1)
  }

  _wake(slots) {
    for (let i = 0; i < slots; i++) {
      const next = this.waiters.shift()
      if (!next) return
      next()
    }
  }

  _setLimit(next) {
    const target = clamp(Math.round(next), this.min, this.max)
    if (target === this.limit) return

    const opened = target - this.limit
    this.limit = target

    if (opened > 0) {
      this.expansions++
      this._wake(opened)
    } else {
      this.shrinks++
    }
  }

  /**
   * Resposta bem-sucedida: usa a folga de cota declarada para decidir subir, segurar ou
   * recuar. Chamada com os headers crus da resposta.
   */
  reportSuccess(headers) {
    const headroom = remainingFraction(headers)
    this.lastHeadroom = headroom

    // Conta que não declara cota (ou proxy que come os headers): não há base para subir,
    // então o teto fica onde o operador configurou em LLM_START_CONCURRENT.
    if (headroom === null) {
      this.successStreak = 0
      return
    }

    if (headroom < this.headroomFloor / 2) {
      this.successStreak = 0
      this._setLimit(this.limit / 2)
      return
    }

    if (headroom < this.headroomFloor) {
      this.successStreak = 0
      return
    }

    this.successStreak++
    if (this.successStreak >= this.rampAfter) {
      this.successStreak = 0
      this._setLimit(this.limit + this.rampStep)
    }
  }

  /**
   * 429 que escapou dos retries do SDK. Corta o teto pela metade — as chamadas já em voo
   * terminam normalmente, e `release()` simplesmente não acorda ninguém enquanto
   * `active >= limit`.
   */
  reportThrottle() {
    this.throttles++
    this.successStreak = 0
    const antes = this.limit
    this._setLimit(this.limit / 2)

    if (this.limit !== antes) {
      console.warn(`[LlmLimiter] 429 recebido — concorrência de chamadas ao LLM: ${antes} → ${this.limit}.`)
    }
  }

  stats() {
    return {
      limiteAtual: this.limit,
      limiteMin: this.min,
      limiteMax: this.max,
      emVoo: this.active,
      naFila: this.waiters.length,
      picoEmVoo: this.peakActive,
      folgaCota: this.lastHeadroom,
      throttles429: this.throttles,
      recuos: this.shrinks,
      expansoes: this.expansions,
    }
  }
}

export const llmLimiter = new AdaptiveLimiter({
  start: llmConfig.startConcurrent,
  min: llmConfig.minConcurrent,
  max: llmConfig.maxConcurrent,
  rampAfter: llmConfig.rampAfter,
  rampStep: llmConfig.rampStep,
  headroomFloor: llmConfig.headroomFloor,
})

/** Espelha `getPacing()` do anymarketClient — consumido por /api/diagnostics. */
export function getLlmPacing() {
  return llmLimiter.stats()
}
