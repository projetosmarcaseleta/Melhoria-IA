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
