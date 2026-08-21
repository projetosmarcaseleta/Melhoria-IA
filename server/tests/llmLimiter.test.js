import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AdaptiveLimiter, remainingFraction, isRateLimitError } from '../services/llmLimiter.js'

const novoLimiter = (over = {}) =>
  new AdaptiveLimiter({ start: 4, min: 2, max: 12, rampAfter: 3, rampStep: 2, headroomFloor: 0.2, ...over })

const folgaDe = (remaining, limit) => ({
  'x-ratelimit-remaining-requests': String(remaining),
  'x-ratelimit-limit-requests': String(limit),
})

describe('llmLimiter — teto de concorrência', () => {
  it('não deixa passar mais chamadas que o limite atual', async () => {
    const limiter = novoLimiter({ start: 2 })

    await limiter.acquire()
    await limiter.acquire()
    assert.equal(limiter.active, 2)

    let terceiroEntrou = false
    const terceiro = limiter.acquire().then(() => { terceiroEntrou = true })

    // Uma volta na fila de microtasks: se o teto não valesse, o terceiro já teria entrado.
    await new Promise((r) => setImmediate(r))
    assert.equal(terceiroEntrou, false)
    assert.equal(limiter.waiters.length, 1)

    limiter.release()
    await terceiro

    assert.equal(terceiroEntrou, true)
    assert.equal(limiter.active, 2)
  })

  it('libera vagas na hora quando o teto sobe, sem esperar release', async () => {
    const limiter = novoLimiter({ start: 1, max: 4 })

    await limiter.acquire()
    let entrou = false
    const segundo = limiter.acquire().then(() => { entrou = true })

    await new Promise((r) => setImmediate(r))
    assert.equal(entrou, false)

    limiter._setLimit(2)
    await segundo
    assert.equal(entrou, true)
  })
})

describe('llmLimiter — adaptação (AIMD)', () => {
  it('sobe o teto após uma sequência de sucessos com folga de cota', () => {
    const limiter = novoLimiter()
    const folga = folgaDe(900, 1000)

    limiter.reportSuccess(folga)
    limiter.reportSuccess(folga)
    assert.equal(limiter.limit, 4, 'não deve subir antes de completar rampAfter')

    limiter.reportSuccess(folga)
    assert.equal(limiter.limit, 6)
  })

  it('recua preventivamente quando a cota está encostando no limite', () => {
    const limiter = novoLimiter({ start: 8 })

    // 5% de folga, abaixo de metade do headroomFloor (0.2) → corta pela metade.
    limiter.reportSuccess(folgaDe(50, 1000))
    assert.equal(limiter.limit, 4)
  })

  it('segura o teto (sem subir nem descer) na faixa intermediária de folga', () => {
    const limiter = novoLimiter()
    const apertado = folgaDe(150, 1000) // 15%: abaixo do floor, acima da metade dele

    limiter.reportSuccess(apertado)
    limiter.reportSuccess(apertado)
    limiter.reportSuccess(apertado)
    limiter.reportSuccess(apertado)

    assert.equal(limiter.limit, 4)
  })

  it('corta o teto pela metade no 429 e nunca abaixo do mínimo', () => {
    const limiter = novoLimiter({ start: 8, min: 3 })

    limiter.reportThrottle()
    assert.equal(limiter.limit, 4)

    limiter.reportThrottle()
    assert.equal(limiter.limit, 3, 'deve parar no mínimo')

    limiter.reportThrottle()
    assert.equal(limiter.limit, 3)
    assert.equal(limiter.throttles, 3)
  })

  it('não sobe além do máximo', () => {
    const limiter = novoLimiter({ start: 10, max: 12, rampAfter: 1, rampStep: 5 })

    limiter.reportSuccess(folgaDe(1000, 1000))
    assert.equal(limiter.limit, 12)
  })

  it('sem headers de cota, mantém o teto configurado', () => {
    const limiter = novoLimiter({ rampAfter: 1 })

    limiter.reportSuccess({})
    limiter.reportSuccess({})
    assert.equal(limiter.limit, 4)
    assert.equal(limiter.lastHeadroom, null)
  })
})

describe('llmLimiter — leitura dos headers de cota', () => {
  it('usa a MENOR folga entre requisições e tokens', () => {
    // Com prompt grande, tokens esgota muito antes de requests: olhar só requisições daria
    // folga que não existe.
    const fraction = remainingFraction({
      'x-ratelimit-remaining-requests': '900',
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-tokens': '20000',
      'x-ratelimit-limit-tokens': '1000000',
    })

    assert.equal(fraction, 0.02)
  })

  it('aceita objeto Headers do fetch', () => {
    const headers = new Headers({
      'x-ratelimit-remaining-requests': '250',
      'x-ratelimit-limit-requests': '1000',
    })

    assert.equal(remainingFraction(headers), 0.25)
  })

  it('devolve null quando a conta não manda os headers', () => {
    assert.equal(remainingFraction({}), null)
    assert.equal(remainingFraction(null), null)
    // Limite zerado não vira divisão por zero.
    assert.equal(remainingFraction({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-limit-requests': '0' }), null)
  })

  it('reconhece 429 vindo do SDK ou de um erro HTTP cru', () => {
    assert.equal(isRateLimitError({ status: 429 }), true)
    assert.equal(isRateLimitError({ response: { status: 429 } }), true)
    assert.equal(isRateLimitError({ code: 'rate_limit_exceeded' }), true)
    assert.equal(isRateLimitError({ status: 500 }), false)
    assert.equal(isRateLimitError(new Error('timeout')), false)
  })
})
