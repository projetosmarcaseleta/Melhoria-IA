import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { levenshtein, similarityRatio, jaccard, containment, scoreNames, matchLevel, matchPath, findGlobalSimilar } from '../services/categoryMatcher.js'
import { buildTree } from '../services/categoryTreeService.js'
import { tokenSet } from '../services/categoryNormalizer.js'

const ARVORE = buildTree([
  { id: 1000, name: 'Automotivo' },
  { id: 1002, name: 'Acessorios', parent: { id: 1000 } },
  { id: 1003, name: 'Tapetes e Carpetes', parent: { id: 1002 } },
  { id: 1004, name: 'Pecas', parent: { id: 1000 } },
  { id: 1010, name: 'Casa e Decoracao' },
  { id: 1011, name: 'Cozinha', parent: { id: 1010 } },
  { id: 1012, name: 'Panelas', parent: { id: 1011 } },
  { id: 1020, name: 'Moda' },
  { id: 1021, name: 'Acessorios', parent: { id: 1020 } },
])

describe('categoryMatcher — métricas', () => {
  it('levenshtein e similaridade', () => {
    assert.equal(levenshtein('tapete', 'tapete'), 0)
    assert.equal(levenshtein('tapete', 'tapetes'), 1)
    assert.equal(levenshtein('', 'abc'), 3)
    assert.equal(similarityRatio('abc', 'abc'), 1)
    assert.ok(similarityRatio('tapete', 'tapetes') > 0.85)
  })

  it('jaccard e containment tratam sobreposição parcial de formas diferentes', () => {
    const a = tokenSet('Automotivo Carros')
    const b = tokenSet('Automotivo')

    assert.equal(jaccard(a, b), 0.5)
    // "Automotivo, Carros" contém inteiramente "Automotivo" — é o caso que o
    // Jaccard subestima por diferença de tamanho e o containment pega.
    assert.equal(containment(a, b), 1)
  })

  it('scoreNames devolve a melhor métrica com rótulo', () => {
    const resultado = scoreNames('Automotivo Carros', 'Automotivo')
    assert.equal(resultado.metric, 'containment')
    assert.equal(resultado.score, 1)
  })
})

describe('categoryMatcher — matchLevel', () => {
  it('deve reusar por chave exata entre irmãos, ignorando caixa e plural', () => {
    for (const variante of ['ACESSORIOS', 'Acessorio', 'acessórios']) {
      const r = matchLevel({ name: variante, parentId: '1000', nodes: ARVORE })
      assert.equal(r.decision, 'reuse', `"${variante}" deveria reusar`)
      assert.equal(r.node.anymarketId, '1002')
      assert.equal(r.matchStage, 'exact_key')
    }
  })

  it('NÃO deve confundir mesmo nome sob pais diferentes', () => {
    const sobAutomotivo = matchLevel({ name: 'Acessorios', parentId: '1000', nodes: ARVORE })
    const sobModa = matchLevel({ name: 'Acessorios', parentId: '1020', nodes: ARVORE })

    assert.equal(sobAutomotivo.node.anymarketId, '1002')
    assert.equal(sobModa.node.anymarketId, '1021')
  })

  it('deve criar quando não há irmão parecido, reportando a banda ambígua', () => {
    const r = matchLevel({ name: 'Tapetes', parentId: '1002', nodes: ARVORE })

    assert.equal(r.decision, 'create')
    // "Tapetes e Carpetes" fica na banda ambígua: não reusa sozinho, mas aparece
    // para o operador como quase-duplicata.
    assert.ok(r.candidates.some((c) => c.anymarketId === '1003'), 'quase-duplicata deveria ser reportada')
  })

  it('deve reusar por fuzzy quando o nome é quase idêntico', () => {
    const r = matchLevel({ name: 'Cozinhas', parentId: '1010', nodes: ARVORE })
    assert.equal(r.decision, 'reuse')
    assert.equal(r.node.anymarketId, '1011')
  })

  it('deve tratar raízes como irmãs quando parentId é nulo', () => {
    const r = matchLevel({ name: 'AUTOMOTIVO', parentId: null, nodes: ARVORE })
    assert.equal(r.decision, 'reuse')
    assert.equal(r.node.anymarketId, '1000')
  })
})

describe('categoryMatcher — matchPath', () => {
  it('deve reusar o prefixo existente e criar só a cauda (caso extend)', () => {
    const r = matchPath({ path: ['Automotivo', 'Acessorios', 'Tapetes'], nodes: ARVORE })

    assert.equal(r.reusedPrefix.length, 2)
    assert.deepEqual(r.reusedPrefix.map((n) => n.anymarketId), ['1000', '1002'])
    assert.equal(r.missingTail.length, 1)
    assert.equal(r.missingTail[0].name, 'Tapetes')
    assert.equal(r.createsNewRoot, false)
    assert.equal(r.fullyExisting, false)
  })

  it('deve marcar fullyExisting quando o caminho inteiro já existe', () => {
    const r = matchPath({ path: ['Automotivo', 'Acessorios'], nodes: ARVORE })

    assert.equal(r.fullyExisting, true)
    assert.equal(r.missingTail.length, 0)
    assert.equal(r.leafCategoryId, '1002')
  })

  it('deve sinalizar createsNewRoot quando o departamento não existe', () => {
    const r = matchPath({ path: ['Petshop', 'Racoes'], nodes: ARVORE })

    assert.equal(r.createsNewRoot, true)
    assert.equal(r.reusedPrefix.length, 0)
    assert.equal(r.missingTail.length, 2)
  })

  it('não deve reusar filho de pai inexistente', () => {
    // "Cozinha" existe, mas sob "Casa e Decoracao" — não sob "Petshop".
    const r = matchPath({ path: ['Petshop', 'Cozinha'], nodes: ARVORE })

    assert.equal(r.missingTail.length, 2)
    assert.ok(!r.reusedPrefix.some((n) => n.anymarketId === '1011'))
  })

  it('deve respeitar maxDepth truncando a cauda', () => {
    const r = matchPath({ path: ['Automotivo', 'Acessorios', 'Tapetes', 'Borracha'], nodes: ARVORE, maxDepth: 3 })
    assert.equal(r.resolvedPath.length, 3)
  })

  it('deve gerar partnerId por nível da cauda, sem barra', () => {
    const r = matchPath({ path: ['Automotivo', 'Acessorios', 'Tapetes'], nodes: ARVORE })
    assert.ok(r.missingTail[0].partnerId.startsWith('CRIA-'))
    assert.ok(!r.missingTail[0].partnerId.includes('/'))
  })

  it('deve avisar sobre caminho parecido em outro galho', () => {
    const r = matchPath({ path: ['Casa e Decoracao', 'Cozinha', 'Panela de Pressao'], nodes: ARVORE })

    assert.ok(r.missingTail.length >= 1)
    assert.ok(r.globalSimilar.some((c) => c.anymarketId === '1012'), 'deveria apontar "Panelas" como parecido')
  })
})

describe('categoryMatcher — findGlobalSimilar', () => {
  it('deve varrer a árvore inteira e respeitar exclusões', () => {
    const todos = findGlobalSimilar({ name: 'Panela', nodes: ARVORE })
    assert.ok(todos.some((c) => c.anymarketId === '1012'))

    const excluindo = findGlobalSimilar({ name: 'Panela', nodes: ARVORE, excludeIds: ['1012'] })
    assert.ok(!excluindo.some((c) => c.anymarketId === '1012'))
  })
})

describe('categoryMatcher — nível que repete um ancestral', () => {
  const ARVORE_CAMERAS = buildTree([
    { id: 4009177, name: 'CAMERAS' },
    { id: 4009184, name: 'CAMERAS FOTOGRAFICAS' },
    { id: 4009251, name: 'Câmeras' },
    { id: 4009252, name: 'Câmeras', parent: { id: 4009251 } },
  ])

  it('NÃO deve criar filho com a mesma chave canônica do pai', () => {
    // Caso real de produção: o LLM devolveu CAMERAS > Câmeras. O estágio 1 não pegava
    // porque compara só IRMÃOS, e "Câmeras" não era filha de "CAMERAS" — o resultado
    // seria um terceiro "Câmeras > Câmeras" na conta.
    const r = matchPath({ path: ['CAMERAS', 'Câmeras'], nodes: ARVORE_CAMERAS })

    assert.equal(r.missingTail.length, 0, 'nada deve ser criado')
    assert.equal(r.fullyExisting, true)
    assert.equal(r.leafCategoryId, '4009177')
    assert.equal(r.redundantLevels.length, 1)
    assert.equal(r.redundantLevels[0].sameAs, 'CAMERAS')
  })

  it('deve ignorar repetição de qualquer ancestral, não só do pai direto', () => {
    const nodes = buildTree([
      { id: 1, name: 'Casa' },
      { id: 2, name: 'Cozinha', parent: { id: 1 } },
    ])
    const r = matchPath({ path: ['Casa', 'Cozinha', 'Casa'], nodes })

    assert.equal(r.missingTail.length, 0)
    assert.equal(r.resolvedPath.join(' > '), 'Casa > Cozinha')
  })

  it('deve valer também dentro da cauda, quando nada existe ainda', () => {
    const r = matchPath({ path: ['Petshop', 'Racoes', 'Racao'], nodes: [] })

    assert.deepEqual(r.missingTail.map((n) => n.name), ['Petshop', 'Racoes'])
    assert.equal(r.redundantLevels.length, 1)
  })

  it('não deve confundir nomes apenas parecidos com o pai', () => {
    // "CAMERAS FOTOGRAFICAS" tem chave própria — é subcategoria legítima, não repetição.
    const r = matchPath({ path: ['CAMERAS', 'Cameras de Seguranca'], nodes: ARVORE_CAMERAS })

    assert.equal(r.redundantLevels.length, 0)
    assert.equal(r.missingTail.length, 1)
    assert.equal(r.missingTail[0].name, 'Cameras de Seguranca')
  })
})
