import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promptCache } from '../services/promptCache.js'

describe('promptCache', () => {
  it('deve armazenar e recuperar prompt do cache', () => {
    promptCache.clear()
    const mockData = { systemPrompt: 'Você é um assistente', version: 1 }

    promptCache.set('client-abc', 'titulo', mockData)
    const retrieved = promptCache.get('client-abc', 'titulo')

    assert.deepEqual(retrieved, mockData)
  })

  it('deve retornar null para chaves inexistentes ou expiradas', () => {
    promptCache.clear()
    assert.equal(promptCache.get('inexistente', 'descricao'), null)

    // Inserir com TTL de 1ms
    promptCache.set('client-exp', 'titulo', { test: true }, 1)
    
    // Aguardar 10ms
    const start = Date.now()
    while (Date.now() - start < 10) {}

    assert.equal(promptCache.get('client-exp', 'titulo'), null)
  })

  it('deve invalidar seletivamente apenas as entradas do cliente específico', () => {
    promptCache.clear()
    promptCache.set('client-1', 'titulo', { title: 1 })
    promptCache.set('client-1', 'descricao', { desc: 1 })
    promptCache.set('client-2', 'titulo', { title: 2 })

    const deleted = promptCache.invalidateClient('client-1')
    assert.equal(deleted, 2)
    assert.equal(promptCache.get('client-1', 'titulo'), null)
    assert.equal(promptCache.get('client-1', 'descricao'), null)
    assert.notEqual(promptCache.get('client-2', 'titulo'), null)
  })
})

describe('promptCache — single-flight (getOrCreate)', () => {
  it('resolve UMA vez para N chamadores concorrentes na mesma chave', async () => {
    promptCache.clear()

    let chamadas = 0
    let resolver
    const factory = () => {
      chamadas++
      return new Promise((r) => { resolver = r })
    }

    // As requisições de um lote chegam praticamente juntas: sem single-flight, cada uma
    // refazia as 5 consultas ao Firestore para chegar no mesmo prompt.
    const pendentes = Array.from({ length: 5 }, () => promptCache.getOrCreate('client-lote', 'descricao', factory))

    assert.equal(chamadas, 1)

    resolver({ systemPrompt: 'resolvido' })
    const resultados = await Promise.all(pendentes)

    resultados.forEach((r) => assert.deepEqual(r, { systemPrompt: 'resolvido' }))
    assert.deepEqual(promptCache.get('client-lote', 'descricao'), { systemPrompt: 'resolvido' })
    assert.equal(promptCache.stats().resolucoesEconomizadas, 4)
  })

  it('não chama a factory quando já existe valor em cache', async () => {
    promptCache.clear()
    promptCache.set('client-quente', 'titulo', { systemPrompt: 'do cache' })

    let chamadas = 0
    const resultado = await promptCache.getOrCreate('client-quente', 'titulo', () => {
      chamadas++
      return Promise.resolve({ systemPrompt: 'novo' })
    })

    assert.equal(chamadas, 0)
    assert.deepEqual(resultado, { systemPrompt: 'do cache' })
  })

  it('descarta resolução que terminou depois de uma invalidação', async () => {
    promptCache.clear()

    let resolver
    const pendente = promptCache.getOrCreate('client-inval', 'titulo', () => new Promise((r) => { resolver = r }))

    // Regra aprovada no meio do caminho: o resultado em voo já é velho.
    promptCache.invalidateClient('client-inval')
    resolver({ systemPrompt: 'velho' })

    // O chamador recebe — é o mesmo que ele obteria resolvendo sozinho...
    assert.deepEqual(await pendente, { systemPrompt: 'velho' })
    // ...mas o cache NÃO fica envenenado por 10 minutos com o prompt anterior à regra.
    assert.equal(promptCache.get('client-inval', 'titulo'), null)
  })

  it('libera a chave em voo quando a factory falha, permitindo nova tentativa', async () => {
    promptCache.clear()

    await assert.rejects(
      promptCache.getOrCreate('client-erro', 'titulo', () => Promise.reject(new Error('Firestore fora'))),
      /Firestore fora/
    )

    assert.equal(promptCache.stats().emVoo, 0)

    const resultado = await promptCache.getOrCreate('client-erro', 'titulo', () => Promise.resolve({ systemPrompt: 'ok' }))
    assert.deepEqual(resultado, { systemPrompt: 'ok' })
  })
})
