import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractItems,
  extractNextUrl,
  paginate,
  parseRetryAfter,
  RateLimiter,
  normalizeFollowUrl,
  slowDownAfterThrottle,
  getPacing,
  flattenFullPathPayload,
  defaultContentTypeFor,
} from '../services/anymarketClient.js'
import { buildTree, treeFingerprint } from '../services/categoryTreeService.js'
import { getMockCategoryTree } from '../services/mockStorage.js'

describe('anymarketClient — leitura defensiva do payload', () => {
  it('extractItems deve aceitar as formas conhecidas de lista', () => {
    assert.deepEqual(extractItems([{ id: 1 }]), [{ id: 1 }])
    assert.deepEqual(extractItems({ content: [{ id: 2 }] }), [{ id: 2 }])
    assert.deepEqual(extractItems({ data: [{ id: 3 }] }), [{ id: 3 }])
    assert.deepEqual(extractItems({ categories: [{ id: 4 }] }), [{ id: 4 }])
    assert.deepEqual(extractItems(null), [])
    assert.deepEqual(extractItems({ page: { total: 0 } }), [])
  })

  it('extractNextUrl deve achar o link da próxima página em qualquer dialeto', () => {
    assert.equal(extractNextUrl({ _links: { next: { href: 'http://a/2' } } }), 'http://a/2')
    assert.equal(extractNextUrl({ links: { next: { href: 'http://b/2' } } }), 'http://b/2')
    assert.equal(extractNextUrl({ links: [{ rel: 'next', href: 'http://c/2' }] }), 'http://c/2')
    assert.equal(extractNextUrl({ next: 'http://d/2' }), 'http://d/2')
    assert.equal(extractNextUrl({ _links: { self: { href: 'http://a/1' } } }), null)
    assert.equal(extractNextUrl([{ id: 1 }]), null)
  })

  it('parseRetryAfter deve entender segundos e data HTTP', () => {
    assert.equal(parseRetryAfter('2'), 2000)
    assert.equal(parseRetryAfter(undefined), null)
    assert.equal(parseRetryAfter('texto-invalido'), null)

    const futuro = parseRetryAfter(new Date(Date.now() + 5000).toUTCString())
    assert.ok(futuro > 3000 && futuro <= 5000, `esperado ~5000ms, veio ${futuro}`)
  })
})

describe('anymarketClient — paginação', () => {
  it('deve seguir o link next até a última página', () => {
    const paginas = [
      { content: [1, 2], _links: { next: { href: 'p2' } } },
      { content: [3, 4], _links: { next: { href: 'p3' } } },
      { content: [5] },
    ]
    const vistos = []

    return paginate(
      async ({ nextUrl }) => {
        vistos.push(nextUrl)
        return paginas.shift()
      },
      { limit: 2 }
    ).then((resultado) => {
      assert.deepEqual(resultado.items, [1, 2, 3, 4, 5])
      assert.equal(resultado.pages, 3)
      assert.equal(resultado.truncated, false)
      assert.deepEqual(vistos, [null, 'p2', 'p3'])
    })
  })

  it('deve avançar por offset quando a API não devolve link next', async () => {
    const offsetsVistos = []

    const resultado = await paginate(
      async ({ offset, limit }) => {
        offsetsVistos.push(offset)
        return offset >= 4 ? { content: ['ultimo'] } : { content: new Array(limit).fill(offset) }
      },
      { limit: 2 }
    )

    assert.deepEqual(offsetsVistos, [0, 2, 4])
    assert.equal(resultado.items.length, 5)
    assert.equal(resultado.truncated, false)
  })

  it('deve parar em maxPages e sinalizar truncamento em vez de fingir leitura completa', async () => {
    const resultado = await paginate(async () => ({ content: [1, 2], _links: { next: { href: 'sempre' } } }), {
      limit: 2,
      maxPages: 3,
    })

    assert.equal(resultado.pages, 3)
    assert.equal(resultado.items.length, 6)
    assert.equal(resultado.truncated, true)
  })

  it('deve encerrar quando a primeira página já vem vazia', async () => {
    const resultado = await paginate(async () => ({ content: [] }), { limit: 100 })

    assert.deepEqual(resultado.items, [])
    assert.equal(resultado.pages, 1)
    assert.equal(resultado.truncated, false)
  })
})

describe('anymarketClient — RateLimiter', () => {
  it('não deve exceder a concorrência máxima', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, minIntervalMs: 0 })
    let ativos = 0
    let picoObservado = 0

    await Promise.all(
      new Array(10).fill(null).map(() =>
        limiter.run(async () => {
          ativos++
          picoObservado = Math.max(picoObservado, ativos)
          await new Promise((r) => setTimeout(r, 5))
          ativos--
        })
      )
    )

    assert.ok(picoObservado <= 2, `pico de concorrência foi ${picoObservado}`)
    assert.equal(ativos, 0)
  })

  it('deve respeitar o intervalo mínimo entre inícios', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 4, minIntervalMs: 30 })
    const inicios = []

    await Promise.all(
      new Array(3).fill(null).map(() =>
        limiter.run(async () => {
          inicios.push(Date.now())
        })
      )
    )

    inicios.sort((a, b) => a - b)
    assert.ok(inicios[2] - inicios[0] >= 55, `intervalos curtos demais: ${inicios[2] - inicios[0]}ms`)
  })

  it('deve liberar a vaga mesmo quando a tarefa falha', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: 0 })

    await assert.rejects(limiter.run(async () => { throw new Error('falhou') }), /falhou/)
    assert.equal(await limiter.run(async () => 'ok'), 'ok')
  })
})

describe('anymarketClient — 429, HTTPS e retomada (regressão do erro em produção)', () => {
  it('deve forçar HTTPS no link de paginação devolvido pela API', () => {
    // A API devolve _links.next em http:// — seguir como veio manda o gumgaToken
    // em texto claro pela rede.
    const upgraded = normalizeFollowUrl('http://api.anymarket.com.br/v2/categories?limit=100&offset=4700')

    assert.ok(upgraded.startsWith('https://'), `não fez upgrade: ${upgraded}`)
    assert.ok(upgraded.includes('offset=4700'), 'query string deve ser preservada')
  })

  it('deve recusar link de paginação para outro host', () => {
    assert.throws(
      () => normalizeFollowUrl('https://atacante.example.com/v2/categories'),
      /host inesperado/,
      'seguir host arbitrário de um campo de resposta entregaria o token'
    )
  })

  it('deve recusar link malformado', () => {
    assert.throws(() => normalizeFollowUrl('nao-e-url'), /inválido/)
  })

  it('deve desacelerar de forma permanente após 429', () => {
    const antes = getPacing()
    slowDownAfterThrottle(53_000)
    const depois = getPacing()

    assert.ok(depois.bulkMs > antes.bulkMs, `ritmo não desacelerou: ${antes.bulkMs} → ${depois.bulkMs}`)

    // Um segundo 429 mais leve não deve acelerar de volta.
    slowDownAfterThrottle(1_000)
    assert.ok(getPacing().bulkMs >= depois.bulkMs, 'desaceleração não pode ser revertida no mesmo processo')
  })

  it('deve devolver checkpoint com as páginas já lidas quando falha no meio', async () => {
    let chamada = 0

    const erro = await paginate(
      async () => {
        chamada++
        if (chamada === 3) {
          const e = new Error('AnyMarket respondeu HTTP 429')
          e.status = 429
          throw e
        }
        return { content: [chamada * 10, chamada * 10 + 1] }
      },
      { limit: 2 }
    ).then(
      () => null,
      (err) => err
    )

    assert.ok(erro, 'a falha precisa propagar')
    assert.equal(erro.checkpoint.pagesDone, 2)
    assert.deepEqual(erro.checkpoint.items, [10, 11, 20, 21], 'as páginas lidas não podem ser perdidas')
    assert.equal(erro.checkpoint.offset, 4)
  })

  it('deve retomar de um checkpoint sem reler o que já foi lido', async () => {
    const offsetsVistos = []

    const resultado = await paginate(
      async ({ offset }) => {
        offsetsVistos.push(offset)
        return { content: ['nova'] }
      },
      { limit: 2, resumeFrom: { items: ['antiga1', 'antiga2'], offset: 4, nextUrl: null, pagesDone: 2 } }
    )

    assert.deepEqual(offsetsVistos, [4], 'deve continuar do offset do checkpoint')
    assert.deepEqual(resultado.items, ['antiga1', 'antiga2', 'nova'], 'itens do checkpoint vêm primeiro')
  })

  it('deve reportar progresso durante a paginação', async () => {
    const progresso = []
    await paginate(
      async ({ offset }) => ({ content: offset >= 4 ? ['fim'] : [1, 2] }),
      { limit: 2, onProgress: (p) => progresso.push(p.pages) }
    )

    assert.deepEqual(progresso, [1, 2, 3], 'sem progresso a sincronização longa parece travada')
  })
})

describe('categoryTreeService — impressão digital da árvore', () => {
  it('deve ser estável para a mesma árvore e mudar quando um nó muda', () => {
    const base = buildTree(getMockCategoryTree())
    const igual = buildTree(getMockCategoryTree())

    assert.equal(treeFingerprint(base), treeFingerprint(igual), 'árvore igual não deve gerar 4.700 escritas de novo')

    const alterada = buildTree([...getMockCategoryTree(), { id: 7777, name: 'Categoria Nova' }])
    assert.notEqual(treeFingerprint(base), treeFingerprint(alterada))
  })

  it('deve ignorar a ordem em que a API devolve as categorias', () => {
    const cru = getMockCategoryTree()
    const invertido = [...cru].reverse()

    assert.equal(treeFingerprint(buildTree(cru)), treeFingerprint(buildTree(invertido)))
  })
})

describe('anymarketClient — /categories/fullPath em uma chamada', () => {
  it('deve achatar árvore aninhada derivando o pai da travessia', () => {
    const payload = [
      {
        id: 1,
        name: 'Eletronicos',
        children: [
          { id: 2, name: 'Audio', children: [{ id: 3, name: 'Fones de Ouvido' }] },
          { id: 4, name: 'TVs' },
        ],
      },
      { id: 5, name: 'Automotivo' },
    ]

    const flat = flattenFullPathPayload(payload)

    assert.equal(flat.length, 5)
    assert.equal(flat.find((n) => n.id === 3).parent.id, 2, 'o pai vem da travessia, não do payload')
    assert.equal(flat.find((n) => n.id === 1).parent, null)

    // O resultado tem de alimentar buildTree igual ao endpoint paginado.
    const tree = buildTree(flat)
    assert.equal(tree.find((n) => n.anymarketId === '3').fullPath, 'Eletronicos > Audio > Fones de Ouvido')
    assert.equal(tree.find((n) => n.anymarketId === '3').depth, 2)
  })

  it('deve aceitar lista plana com parent e payload embrulhado em content', () => {
    const plano = flattenFullPathPayload({ content: [{ id: 1, name: 'Casa' }, { id: 2, name: 'Cozinha', parent: { id: 1 } }] })

    assert.equal(plano.length, 2)
    assert.equal(buildTree(plano).find((n) => n.anymarketId === '2').fullPath, 'Casa > Cozinha')
  })

  it('deve aceitar as variações de nome do array de filhos', () => {
    for (const chave of ['children', 'childs', 'subCategories']) {
      const flat = flattenFullPathPayload([{ id: 1, name: 'Raiz', [chave]: [{ id: 2, name: 'Filho' }] }])
      assert.equal(flat.length, 2, `variação "${chave}" não foi reconhecida`)
      assert.equal(flat[1].parent.id, 1)
    }
  })

  it('deve ignorar nó sem id ou sem nome sem perder os filhos válidos', () => {
    const flat = flattenFullPathPayload([{ id: null, name: 'Sem id', children: [{ id: 9, name: 'Valido' }] }])
    assert.deepEqual(flat.map((n) => n.id), [9])
  })

  it('deve devolver vazio para payload irreconhecível (dispara o plano B da paginação)', () => {
    assert.deepEqual(flattenFullPathPayload({ mensagem: 'endpoint nao disponivel' }), [])
    assert.deepEqual(flattenFullPathPayload(null), [])
  })
})

describe('anymarketClient — media type do PATCH (regressão do 415)', () => {
  it('PATCH deve usar merge-patch; os outros métodos, json', () => {
    // O AnyMarket responde 415 "O Content Type application/json não é suportado"
    // no PATCH de produto. O workflow n8n 02 deste repo já mandava merge-patch.
    assert.equal(defaultContentTypeFor('PATCH'), 'application/merge-patch+json')
    assert.equal(defaultContentTypeFor('patch'), 'application/merge-patch+json')
    assert.equal(defaultContentTypeFor('POST'), 'application/json')
    assert.equal(defaultContentTypeFor('PUT'), 'application/json')
    assert.equal(defaultContentTypeFor('GET'), 'application/json')
    assert.equal(defaultContentTypeFor(undefined), 'application/json')
  })
})
