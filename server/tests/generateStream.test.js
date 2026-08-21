/**
 * Teste de ponta a ponta da rota de geração, sem tocar em serviço externo.
 *
 * O SDK da OpenAI é apontado para um servidor falso local (OPENAI_BASE_URL) e o cliente é o
 * de teste (isTestClient), que já desvia do Firestore. Assim dá para exercitar a rota
 * inteira — lote, stream, casamento por id — de graça e sem rede.
 *
 * O que mais importa aqui: o servidor falso responde FORA DE ORDEM de propósito (o primeiro
 * produto é o mais lento). Foi essa a troca que o lote por requisição introduziu — antes,
 * uma requisição carregava um produto e não havia como confundir os resultados. Se algum dia
 * alguém casar resultado com produto por índice em vez de por id, este teste falha.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { TEST_CLIENT_ID } from '../services/mockStorage.js'
import { llmLimiter } from '../services/llmLimiter.js'

const PRODUTOS = [
  { id: 'p-1', title: 'Cadeira 41', description: 'desc 41', characteristics: 'c 41' },
  { id: 'p-2', title: 'Cadeira 42', description: 'desc 42', characteristics: 'c 42' },
  { id: 'p-3', title: 'Cadeira 43', description: 'desc 43', characteristics: 'c 43' },
  { id: 'p-4', title: 'Cadeira 44', description: 'desc 44', characteristics: 'c 44' },
  { id: 'p-5', title: 'Cadeira 45', description: 'desc 45', characteristics: 'c 45' },
]

const escutar = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })

const fechar = (server) => new Promise((resolve) => server.close(resolve))

let fakeOpenAI
let httpServer
let base
let chamadasAoLLM = 0

/**
 * Servidor falso da OpenAI. Devolve o título original de volta com um prefixo, para dar
 * como rastrear de qual produto veio cada resposta — e responde com atraso decrescente,
 * garantindo que a ordem de chegada seja diferente da ordem de envio.
 */
function criarFakeOpenAI() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (pedaco) => { body += pedaco })
    req.on('end', () => {
      chamadasAoLLM++

      const payload = JSON.parse(body || '{}')
      const userMessage = payload.messages?.find((m) => m.role === 'user')?.content ?? ''
      const numero = Number(userMessage.match(/Cadeira (\d+)/)?.[1] ?? 0)

      // Produto enviado primeiro responde por último.
      const atraso = Math.max(0, (50 - (numero - 40)) * 4)

      setTimeout(() => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-ratelimit-limit-requests': '1000',
          'x-ratelimit-remaining-requests': '900',
          'x-ratelimit-limit-tokens': '1000000',
          'x-ratelimit-remaining-tokens': '950000',
        })
        res.end(JSON.stringify({
          id: `chatcmpl-fake-${numero}`,
          object: 'chat.completion',
          model: payload.model ?? 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: `eco ${numero}` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }))
      }, atraso)
    })
  })
}

before(async () => {
  fakeOpenAI = criarFakeOpenAI()
  const portaFake = await escutar(fakeOpenAI)

  process.env.OPENAI_API_KEY = 'chave-de-teste'
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${portaFake}/v1`

  // Import depois das variáveis de ambiente: o cliente da OpenAI é criado na primeira
  // chamada (lazy), mas o baseURL é lido na construção.
  const { default: generateRouter } = await import('../routes/generate.js')

  const servidor = express()
  servidor.use(express.json({ limit: '10mb' }))
  servidor.use((req, _res, next) => {
    req.user = { id: 'operador-teste', role: 'admin' }
    next()
  })
  servidor.use('/api/generate', generateRouter)

  httpServer = http.createServer(servidor)
  const porta = await escutar(httpServer)
  base = `http://127.0.0.1:${porta}`
})

after(async () => {
  if (httpServer) await fechar(httpServer)
  if (fakeOpenAI) await fechar(fakeOpenAI)
})

async function pedirGeracao({ stream, produtos = PRODUTOS, fields = ['title'] }) {
  return fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stream ? { Accept: 'application/x-ndjson' } : {}),
    },
    body: JSON.stringify({ clientId: TEST_CLIENT_ID, products: produtos, fields }),
  })
}

describe('POST /api/generate — lote em stream (NDJSON)', () => {
  it('devolve uma linha por produto, cada resultado casado com o SEU produto', async () => {
    chamadasAoLLM = 0
    const response = await pedirGeracao({ stream: true })

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/)
    // Sem isto o nginx da VPS acumularia a resposta e o stream não existiria na prática.
    assert.equal(response.headers.get('x-accel-buffering'), 'no')

    const texto = await response.text()
    const linhas = texto.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

    const resultados = linhas.filter((l) => !l.done)
    const fim = linhas.find((l) => l.done)

    assert.equal(resultados.length, PRODUTOS.length, 'uma linha por produto')
    assert.deepEqual(fim, { done: true, total: PRODUTOS.length })
    assert.equal(chamadasAoLLM, PRODUTOS.length, 'uma chamada ao LLM por produto (só título)')

    // O ponto do teste: cada id carrega o texto gerado a partir do PRÓPRIO título.
    for (const r of resultados) {
      const original = PRODUTOS.find((p) => p.id === r.id)
      assert.ok(original, `id inesperado no stream: ${r.id}`)
      assert.equal(r.error, undefined)

      const numeroEsperado = original.title.match(/(\d+)/)[1]
      assert.match(
        r.newTitle,
        new RegExp(numeroEsperado),
        `resultado de ${r.id} deveria vir do título "${original.title}", veio "${r.newTitle}"`
      )
      assert.ok(r.titleGenerationId, 'deve devolver o id da geração')
      // Só título foi pedido: descrição não deve aparecer no resultado.
      assert.equal('newDescription' in r, false)
    }

    const ids = resultados.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length, 'nenhum id repetido')
  })

  it('chega fora da ordem de envio — é para isso que o casamento é por id', async () => {
    const response = await pedirGeracao({ stream: true })
    const texto = await response.text()
    const ordemDeChegada = texto
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((l) => !l.done)
      .map((l) => l.id)

    const ordemDeEnvio = PRODUTOS.map((p) => p.id)
    assert.notDeepEqual(ordemDeChegada, ordemDeEnvio, 'o servidor falso responde em ordem inversa de propósito')
    assert.deepEqual([...ordemDeChegada].sort(), [...ordemDeEnvio].sort(), 'mesmo conjunto, ordem diferente')
  })

  it('alimenta o limitador adaptativo com a folga de cota da resposta', async () => {
    await pedirGeracao({ stream: true })
    // 900/1000 requisições e 950k/1M tokens → menor folga = 0.9.
    assert.equal(llmLimiter.stats().folgaCota, 0.9)
  })
})

describe('POST /api/generate — resposta JSON de sempre (sem Accept)', () => {
  it('mantém o formato { results: [...] } intacto', async () => {
    const response = await pedirGeracao({ stream: false })

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/json/)

    const data = await response.json()
    assert.ok(Array.isArray(data.results))
    assert.equal(data.results.length, PRODUTOS.length)

    // Ordem do JSON acompanha a ordem de ENVIO, mesmo com as respostas chegando invertidas.
    assert.deepEqual(data.results.map((r) => r.id), PRODUTOS.map((p) => p.id))
  })

  it('valida a entrada antes de qualquer geração', async () => {
    const semCliente = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: PRODUTOS }),
    })
    assert.equal(semCliente.status, 400)

    const semProdutos = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: TEST_CLIENT_ID, products: [] }),
    })
    assert.equal(semProdutos.status, 400)
  })
})

describe('POST /api/generate — título e descrição juntos', () => {
  it('faz duas chamadas ao LLM por produto e devolve os dois campos', async () => {
    chamadasAoLLM = 0
    const response = await pedirGeracao({
      stream: true,
      produtos: PRODUTOS.slice(0, 2),
      fields: ['title', 'description'],
    })

    const resultados = (await response.text())
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((l) => !l.done)

    assert.equal(resultados.length, 2)
    assert.equal(chamadasAoLLM, 4, 'título + descrição para cada um dos 2 produtos')

    for (const r of resultados) {
      assert.ok(r.newTitle, 'título gerado')
      assert.ok(r.newDescription, 'descrição gerada')
      assert.ok(r.titleGenerationId)
      assert.ok(r.descGenerationId)
    }
  })
})
