import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree, buildIndexes, findExactDuplicates, normalizeRawCategory, loadCategoryTree } from '../services/categoryTreeService.js'
import { getMockCategoryTree, TEST_CLIENT_ID } from '../services/mockStorage.js'

const arvore = () => buildTree(getMockCategoryTree())
const acharPorId = (nodes, id) => nodes.find((n) => n.anymarketId === String(id))

describe('categoryTreeService — normalizeRawCategory', () => {
  it('deve aceitar as formas conhecidas de pai e nome', () => {
    assert.equal(normalizeRawCategory({ id: 7, name: 'Casa', parent: { id: 3 } }).parentId, '3')
    assert.equal(normalizeRawCategory({ id: 7, name: 'Casa', parentId: 3 }).parentId, '3')
    assert.equal(normalizeRawCategory({ id: 7, name: 'Casa' }).parentId, null)
    assert.equal(normalizeRawCategory({ categoryId: 7, description: 'Casa' }).name, 'Casa')
  })

  it('deve normalizar ids para string (a API mistura número e texto)', () => {
    assert.equal(normalizeRawCategory({ id: 1000, name: 'Casa' }).anymarketId, '1000')
  })
})

describe('categoryTreeService — buildTree', () => {
  it('deve calcular profundidade e caminho completo pela cadeia de pais', () => {
    const nodes = arvore()
    const tapetes = acharPorId(nodes, 1003)

    assert.equal(tapetes.depth, 2)
    assert.equal(tapetes.fullPath, 'Automotivo > Acessorios > Tapetes e Carpetes')
    assert.equal(tapetes.pathKey, 'automotivo/acessorio/tapet-carpet')
  })

  it('deve tratar nó órfão como raiz sem descartá-lo', () => {
    const pneus = acharPorId(arvore(), 1030)

    assert.equal(pneus.isOrphan, true)
    assert.equal(pneus.parentId, null)
    assert.equal(pneus.depth, 0)
  })

  it('deve marcar hasChildren e contar filhos', () => {
    const nodes = arvore()

    assert.equal(acharPorId(nodes, 1000).hasChildren, true)
    assert.equal(acharPorId(nodes, 1000).childCount, 4)
    assert.equal(acharPorId(nodes, 1003).hasChildren, false)
    assert.equal(acharPorId(nodes, 1001).hasChildren, false)
  })

  it('deve inferir createdByCria a partir do prefixo do partnerId', () => {
    const nodes = buildTree([
      { id: 1, name: 'Automotivo', partnerId: 'CRIA-automotivo' },
      { id: 2, name: 'Casa', partnerId: 'ERP-4471' },
      { id: 3, name: 'Moda' },
    ])

    assert.equal(acharPorId(nodes, 1).createdByCria, true)
    assert.equal(acharPorId(nodes, 2).createdByCria, false)
    assert.equal(acharPorId(nodes, 3).createdByCria, false)
  })

  it('deve descartar nó sem id ou sem nome', () => {
    const nodes = buildTree([
      { id: 1, name: 'Valido' },
      { id: 2, name: '   ' },
      { name: 'Sem id' },
    ])

    assert.equal(nodes.length, 1)
  })

  it('não deve entrar em laço infinito com ciclo de pais', () => {
    const nodes = buildTree([
      { id: 1, name: 'A', parent: { id: 2 } },
      { id: 2, name: 'B', parent: { id: 1 } },
    ])

    assert.equal(nodes.length, 2)
    for (const node of nodes) assert.ok(node.depth <= 1, `profundidade inesperada: ${node.depth}`)
  })
})

describe('categoryTreeService — buildIndexes', () => {
  it('deve indexar raízes, filhos e irmãos por chave', () => {
    const nodes = arvore()
    const { roots, childrenOf, bySiblingSlug, siblingKey } = buildIndexes(nodes)

    // Automotivo, AUTOMOTIVO, Casa e Decoracao, Outros, Pneus (órfão)
    assert.equal(roots.length, 5)
    assert.equal(childrenOf.get('1000').length, 4)
    assert.equal(bySiblingSlug.get(siblingKey(null, 'automotivo')).length, 2)
  })

  it('deve separar mesmo nome sob pais diferentes', () => {
    const nodes = buildTree([
      { id: 1, name: 'Automotivo' },
      { id: 2, name: 'Moda' },
      { id: 3, name: 'Acessorios', parent: { id: 1 } },
      { id: 4, name: 'Acessorios', parent: { id: 2 } },
    ])
    const { bySiblingSlug, siblingKey } = buildIndexes(nodes)

    assert.equal(bySiblingSlug.get(siblingKey('1', 'acessorio')).length, 1)
    assert.equal(bySiblingSlug.get(siblingKey('2', 'acessorio')).length, 1)
  })
})

describe('categoryTreeService — findExactDuplicates', () => {
  it('deve achar duplicata por caixa alta entre raízes', () => {
    const grupos = findExactDuplicates(arvore())
    const grupo = grupos.find((g) => g.nodes.some((n) => n.name === 'AUTOMOTIVO'))

    assert.ok(grupo, 'Automotivo/AUTOMOTIVO deveria ser reportado')
    assert.equal(grupo.nodes.length, 2)
    assert.equal(grupo.matchedBy, 'slugKey')
  })

  it('deve achar duplicata por singular/plural entre irmãos', () => {
    const grupos = findExactDuplicates(arvore())
    const grupo = grupos.find((g) => g.nodes.some((n) => n.name === 'Panela'))

    assert.ok(grupo, 'Panelas/Panela deveria ser reportado')
    assert.equal(grupo.parentPath, 'Casa e Decoracao > Cozinha')
  })

  it('deve achar duplicata só por inversão de palavras (tokenSetKey)', () => {
    const grupos = findExactDuplicates(arvore())
    const grupo = grupos.find((g) => g.matchedBy === 'tokenSetKey' && g.nodes.some((n) => n.name === 'Acessorios Automotivos'))

    assert.ok(grupo, 'Acessorios Automotivos / Automotivos Acessorios deveria ser reportado')
    assert.equal(grupo.nodes.length, 2)
  })

  it('não deve reportar o mesmo grupo duas vezes quando as duas chaves colidem', () => {
    const grupos = findExactDuplicates(arvore())
    const assinaturas = grupos.map((g) => g.nodes.map((n) => n.anymarketId).sort().join(','))

    assert.equal(new Set(assinaturas).size, assinaturas.length)
  })

  it('deve devolver lista vazia para árvore limpa', () => {
    const nodes = buildTree([
      { id: 1, name: 'Automotivo' },
      { id: 2, name: 'Casa' },
      { id: 3, name: 'Acessorios', parent: { id: 1 } },
    ])

    assert.deepEqual(findExactDuplicates(nodes), [])
  })
})

describe('categoryTreeService — guarda de sincronização a frio', () => {
  it('deve recusar com tree_not_synced em vez de varrer a API dentro de um clique', async () => {
    // Cliente real sem espelho: o clique no card não pode disparar dezenas de
    // páginas na API. Foi assim que a conta com 4.700 categorias tomou 429.
    await assert.rejects(
      () => loadCategoryTree('cliente-sem-espelho-xyz', { allowSync: false }),
      (err) => err.code === 'tree_not_synced' && err.status === 409
    )
  })

  it('cliente de teste deve montar a árvore falsa mesmo com allowSync desligado', async () => {
    const tree = await loadCategoryTree(TEST_CLIENT_ID, { allowSync: false })
    assert.ok(tree.nodes.length > 0, 'árvore falsa não custa chamada de API')
  })
})
