import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeLLMOutput,
  applyDeterministicRules,
  enforceMaxLength,
  validateOutput,
} from '../services/outputValidator.js'
import { toTitleCase } from '../routes/generate.js'

describe('outputValidator & deterministic transformations', () => {
  it('sanitizeLLMOutput deve remover cercas markdown de código ```html e ```', () => {
    const raw = '```html\n<p>Descrição do produto</p>\n```'
    const sanitized = sanitizeLLMOutput(raw)
    assert.equal(sanitized, '<p>Descrição do produto</p>')
  })

  it('toTitleCase deve capitalizar títulos preservando preposições minúsculas', () => {
    const title = 'açucareiro esmaltado porta açúcar com suporte para café'
    const result = toTitleCase(title)
    assert.equal(result, 'Açucareiro Esmaltado Porta Açúcar com Suporte para Café')
  })

  it('enforceMaxLength deve cortar deterministicamente por palavra inteira sem estourar o limite', () => {
    const longTitle = 'Conjunto Panelas Cerâmica Antiaderente Indução Tramontina Vermelho 5 Peças'
    const truncated = enforceMaxLength(longTitle, 60)
    assert.ok(truncated.length <= 60, `Esperado <= 60 caracteres, obteve ${truncated.length}`)
    assert.ok(!truncated.endsWith(' '), 'Não deve terminar com espaço')
    assert.ok(!truncated.endsWith(','), 'Não deve terminar com pontuação órfã')
  })

  it('applyDeterministicRules deve injetar prepend_exactly sem duplicação', () => {
    const text = '<p>Especificações técnicas da batedeira...</p>'
    const rules = [
      {
        id: 'rule-1',
        name: 'Texto Institucional',
        status: 'approved',
        scopes: ['descricao'],
        application: 'prepend_exactly',
        priority: 'critical',
        content: '<p><strong>Sobre a Marca:</strong> Produtos de alta qualidade.</p>',
      },
    ]

    const res1 = applyDeterministicRules(text, rules, 'descricao')
    assert.ok(res1.finalOutput.startsWith('<p><strong>Sobre a Marca:</strong> Produtos de alta qualidade.</p>'))
    assert.equal(res1.deterministicRulesApplied.length, 1)

    // Testar se não duplica ao passar novamente
    const res2 = applyDeterministicRules(res1.finalOutput, rules, 'descricao')
    assert.equal(res2.finalOutput, res1.finalOutput)
  })

  it('validateOutput deve detectar termos proibidos configurados nas regras', () => {
    const text = 'Compre agora esta super promoção com frete grátis garantido!'
    const rules = [
      {
        id: 'rule-proib',
        name: 'Filtro Comercial',
        status: 'approved',
        scopes: ['descricao'],
        type: 'prohibition',
        content: 'promoção, frete grátis, barato',
      },
    ]

    const validation = validateOutput(text, rules, 'descricao')
    assert.equal(validation.valid, false)
    assert.equal(validation.violations.length, 2) // promoção e frete grátis
    assert.ok(validation.violations.some((v) => v.code === 'PROHIBITED_TERM'))
  })

  it('validateOutput deve emitir warning caso exceda limite de caracteres', () => {
    const longTitle = 'A'.repeat(80)
    const validation = validateOutput(longTitle, [], 'titulo', { maxLength: 60 })
    assert.equal(validation.valid, false)
    assert.ok(validation.violations.some((v) => v.code === 'MAX_LENGTH_EXCEEDED'))
  })
})
