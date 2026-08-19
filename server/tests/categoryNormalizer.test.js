import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeName,
  slugKey,
  tokenSetKey,
  pathKey,
  splitCompositeName,
  normalizePath,
  formatDisplayName,
  buildPartnerId,
  truncateAtWord,
  validateNodeName,
  MAX_NAME_LENGTH,
} from '../services/categoryNormalizer.js'

describe('categoryNormalizer — chaves canônicas', () => {
  it('deve colapsar caixa, acento e plural na mesma slugKey', () => {
    const esperado = slugKey('Automotivo')

    for (const variante of ['AUTOMOTIVO', 'automotivo', 'automotivos', 'Automotívo ', '  Automotivo  ']) {
      assert.equal(slugKey(variante), esperado, `variante "${variante}" deveria colidir com "Automotivo"`)
    }
  })

  it('deve colidir singular e plural em pares reais de categoria', () => {
    // Regressão: a regra antiga tratava "-es" como sufixo único e fazia
    // Tapetes (tapet) e Tapete (tapete) NÃO colidirem — duplicata garantida.
    const pares = [
      ['Tapetes', 'Tapete'],
      ['Cores', 'Cor'],
      ['Acessórios', 'Acessório'],
      ['Automóveis', 'Automóvel'],
      ['Televisões', 'Televisão'],
      ['Pneus', 'Pneu'],
      ['Homens', 'Homem'],
      ['Luzes', 'Luz'],
      ['Panelas', 'Panela'],
    ]

    for (const [plural, singular] of pares) {
      assert.equal(slugKey(plural), slugKey(singular), `"${plural}" e "${singular}" deveriam ter a mesma chave`)
    }
  })

  it('não deve colidir categorias genuinamente diferentes', () => {
    assert.notEqual(slugKey('Camisas'), slugKey('Camisetas'))
    assert.notEqual(slugKey('Cozinha'), slugKey('Cozimento'))
    assert.notEqual(slugKey('Pneus'), slugKey('Peças'))
  })

  it('tokenSetKey deve ignorar a ordem das palavras; slugKey não', () => {
    assert.equal(tokenSetKey('Acessórios Automotivos'), tokenSetKey('Automotivos Acessórios'))
    assert.notEqual(slugKey('Acessórios Automotivos'), slugKey('Automotivos Acessórios'))
  })

  it('deve descartar stopwords na chave, preservando o nome de exibição', () => {
    assert.equal(normalizeName('Tapetes de Borracha para Carro'), normalizeName('Tapetes Borracha Carro'))
    assert.equal(formatDisplayName('TAPETES DE BORRACHA PARA CARRO'), 'Tapetes de Borracha para Carro')
  })

  it('pathKey deve compor a hierarquia inteira', () => {
    assert.equal(pathKey(['Automotivo', 'Acessórios', 'Tapetes']), 'automotivo/acessorio/tapet')
    assert.equal(pathKey(['Automotivo']), 'automotivo')
    assert.equal(pathKey([]), '')
  })
})

describe('categoryNormalizer — nomes compostos', () => {
  it('deve dividir por vírgula, barra e seta', () => {
    assert.deepEqual(splitCompositeName('Automotivo, Carros'), ['Automotivo', 'Carros'])
    assert.deepEqual(splitCompositeName('Casa > Cozinha > Panelas'), ['Casa', 'Cozinha', 'Panelas'])
    assert.deepEqual(splitCompositeName('Casa / Cozinha'), ['Casa', 'Cozinha'])
    assert.deepEqual(splitCompositeName('Casa | Cozinha'), ['Casa', 'Cozinha'])
  })

  it('NÃO deve dividir nome legítimo com "e"', () => {
    assert.deepEqual(splitCompositeName('Tapetes e Carpetes'), ['Tapetes e Carpetes'])
    assert.deepEqual(splitCompositeName('Casa e Decoração'), ['Casa e Decoração'])
  })

  it('normalizePath deve achatar caminho com nível composto', () => {
    assert.deepEqual(normalizePath(['Automotivo, Carros', 'Tapetes']), ['Automotivo', 'Carros', 'Tapetes'])
  })
})

describe('categoryNormalizer — partnerId', () => {
  it('deve ser determinístico e sem barra (viaja em query string)', () => {
    const id = buildPartnerId(['Automotivo', 'Acessórios', 'Tapetes'])

    assert.equal(id, buildPartnerId(['Automotivo', 'Acessórios', 'Tapetes']))
    assert.ok(!id.includes('/'), `partnerId não pode conter barra: ${id}`)
    assert.ok(id.startsWith('CRIA-'))
  })

  it('deve respeitar o limite de 80 caracteres com hash de desambiguação', () => {
    const caminhoLongo = [
      'Eletrodomésticos e Portáteis',
      'Refrigeração Comercial Industrial',
      'Freezers Horizontais Dupla Ação Premium',
    ]
    const id = buildPartnerId(caminhoLongo)

    assert.ok(id.length <= MAX_NAME_LENGTH, `partnerId ficou com ${id.length} caracteres`)
    assert.equal(id, buildPartnerId(caminhoLongo), 'truncamento deve permanecer determinístico')
  })

  it('deve aceitar prefixo customizado', () => {
    assert.ok(buildPartnerId(['Automotivo'], 'ACME').startsWith('ACME-'))
  })
})

describe('categoryNormalizer — validateNodeName', () => {
  const codigos = (raw, options) => validateNodeName(raw, options).violations.map((v) => v.code)

  it('deve aprovar nome no padrão marketplace', () => {
    const resultado = validateNodeName('Tapetes Automotivos')
    assert.equal(resultado.valid, true)
    assert.equal(resultado.name, 'Tapetes Automotivos')
  })

  it('deve normalizar CAIXA ALTA para Title Case sem reprovar', () => {
    const resultado = validateNodeName('AUTOMOTIVO')
    assert.equal(resultado.name, 'Automotivo')
    assert.equal(resultado.valid, true)
  })

  it('deve recusar nome composto, genérico, numérico, com emoji, HTML ou medida', () => {
    assert.ok(codigos('Automotivo, Carros').includes('composite'))
    assert.ok(codigos('Outros').includes('generic'))
    assert.ok(codigos('12345').includes('numeric_only'))
    assert.ok(codigos('Tapetes 🚗').includes('emoji'))
    assert.ok(codigos('<b>Tapetes</b>').includes('html'))
    assert.ok(codigos('Tapete 205/55 R16').includes('measure'))
    assert.ok(codigos('Cabo 20cm').includes('measure'))
  })

  it('deve recusar nome de marca quando a lista de marcas é conhecida', () => {
    assert.ok(codigos('Michelin', { brands: ['Michelin', 'Pirelli'] }).includes('brand'))
    assert.ok(!codigos('Michelin').includes('brand'), 'sem lista de marcas não há como acusar')
  })

  it('deve truncar nome acima de 80 caracteres sem quebrar palavra', () => {
    const longo = 'Categoria Absurdamente Extensa Que Ninguem Deveria Cadastrar Em Marketplace Nenhum Jamais'
    const resultado = validateNodeName(longo)

    assert.ok(resultado.violations.some((v) => v.code === 'too_long'))
    assert.ok(resultado.name.length <= MAX_NAME_LENGTH)
    assert.ok(!resultado.name.endsWith(' '))
    assert.equal(truncateAtWord('abc def ghi', 7), 'abc def')
  })
})
