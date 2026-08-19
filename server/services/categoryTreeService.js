/**
 * Sincronização e leitura da árvore de categorias do AnyMarket (Fase 1 — só leitura).
 *
 * Responsabilidades:
 *   1. buscar a lista de categorias na API (paginada);
 *   2. montar a hierarquia (parentId → depth, fullPath, pathKey) com guarda de ciclo;
 *   3. calcular as chaves canônicas de cada nó (é o que o funil de dedup compara);
 *   4. espelhar no Firestore e no cache em memória.
 *
 * Nada aqui escreve no AnyMarket. Criação de categoria é Fase 4.
 *
 * Embeddings (estágio 3 do funil) NÃO são gerados nesta fase: custam chamada por nó
 * e só passam a ser usados quando o matcher existir. Quando entrarem, virão em
 * chamada batelada — não uma por nó.
 *
 * Ver docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md §5.1 e §14 (Fase 1).
 */

import { db, FieldValue } from './firebaseAdmin.js'
import { isTestClient, getMockCategoryTree } from './mockStorage.js'
import { fetchCategories, fetchCategoriesFullPath, fetchCategoryChildren, resolveAnymarketToken } from './anymarketClient.js'
import { categoryTreeCache } from './categoryTreeCache.js'
import { slugKey, tokenSetKey, pathKey, shortHash } from './categoryNormalizer.js'
import { bulkSet, bulkDelete } from '../utils/firestoreBulk.js'

const COLLECTION = 'anymarket_categories'
const META_DOC = 'categories_sync'

/**
 * Checkpoints de paginação em memória, por cliente.
 *
 * Guardam as páginas já lidas quando a sincronização morre no meio (429, timeout).
 * Em memória basta: se o processo reiniciar, a próxima sincronização recomeça —
 * o que se perde é tempo, nunca dado, porque o espelho anterior no Firestore
 * continua servindo as leituras.
 */
const syncCheckpoints = new Map()

export function getSyncCheckpoint(clientId) {
  const checkpoint = syncCheckpoints.get(clientId)
  return checkpoint ? { itemCount: checkpoint.items.length, offset: checkpoint.offset, pagesDone: checkpoint.pagesDone } : null
}

export function clearSyncCheckpoint(clientId) {
  return syncCheckpoints.delete(clientId)
}

/** Impressão digital da árvore — evita regravar milhares de docs quando nada mudou. */
export function treeFingerprint(nodes) {
  const signature = nodes
    .map((node) => `${node.anymarketId}|${node.name}|${node.parentId ?? ''}`)
    .sort()
    .join(';')

  return `${nodes.length}:${shortHash(signature)}`
}

/** Achata as formas possíveis de um nó cru da API num shape único. */
export function normalizeRawCategory(raw) {
  const anymarketId = raw?.id ?? raw?.categoryId ?? null
  const parentId = raw?.parent?.id ?? raw?.parentId ?? raw?.idParent ?? null

  return {
    anymarketId: anymarketId === null ? null : String(anymarketId),
    name: String(raw?.name ?? raw?.description ?? '').trim(),
    parentId: parentId === null || parentId === undefined ? null : String(parentId),
    partnerId: raw?.partnerId ?? null,
    definitionPriceScope: raw?.definitionPriceScope ?? null,
    priceFactor: raw?.priceFactor ?? null,
  }
}

/**
 * Monta a hierarquia a partir da lista plana.
 *
 * `fullPath` e `pathKey` são calculados aqui a partir da cadeia de pais, nunca lidos
 * do payload: precisam ser coerentes com as MESMAS chaves canônicas que o matcher
 * usa. Aceitar o `path` que a API devolver abriria divergência entre o que
 * comparamos e o que exibimos.
 */
export function buildTree(rawNodes, { partnerIdPrefix = 'CRIA' } = {}) {
  const nodes = rawNodes.map(normalizeRawCategory).filter((n) => n.anymarketId && n.name)

  const byId = new Map(nodes.map((n) => [n.anymarketId, n]))
  const childCount = new Map()
  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1)
    }
  }

  const ancestorsOf = (node) => {
    const chain = []
    const seen = new Set([node.anymarketId])
    let current = node

    while (current.parentId) {
      // Pai fora da lista: nó órfão. Trata como raiz em vez de descartar — categoria
      // órfã ainda recebe produto no hub, e sumir com ela criaria duplicata na Fase 4.
      if (!byId.has(current.parentId) || seen.has(current.parentId)) break
      current = byId.get(current.parentId)
      seen.add(current.anymarketId)
      chain.unshift(current)
    }

    return chain
  }

  return nodes.map((node) => {
    const ancestors = ancestorsOf(node)
    const path = [...ancestors.map((a) => a.name), node.name]
    const isOrphan = Boolean(node.parentId) && !byId.has(node.parentId)

    return {
      anymarketId: node.anymarketId,
      name: node.name,
      parentId: isOrphan ? null : node.parentId,
      depth: ancestors.length,
      fullPath: path.join(' > '),
      slugKey: slugKey(node.name),
      tokenSetKey: tokenSetKey(node.name),
      pathKey: pathKey(path),
      partnerId: node.partnerId ?? null,
      hasChildren: (childCount.get(node.anymarketId) ?? 0) > 0,
      childCount: childCount.get(node.anymarketId) ?? 0,
      createdByCria: typeof node.partnerId === 'string' && node.partnerId.startsWith(`${partnerIdPrefix}-`),
      isOrphan,
      definitionPriceScope: node.definitionPriceScope,
      priceFactor: node.priceFactor,
    }
  })
}

/** Índices usados pelo funil de dedup (§7, estágios 1 e 2). Construídos sob demanda. */
export function buildIndexes(nodes) {
  const byId = new Map()
  const childrenOf = new Map()
  const bySiblingSlug = new Map()
  const bySiblingTokenSet = new Map()
  const roots = []

  const siblingKey = (parentId, key) => `${parentId ?? 'root'}|${key}`

  for (const node of nodes) {
    byId.set(node.anymarketId, node)

    if (node.parentId) {
      if (!childrenOf.has(node.parentId)) childrenOf.set(node.parentId, [])
      childrenOf.get(node.parentId).push(node)
    } else {
      roots.push(node)
    }

    if (node.slugKey) {
      const key = siblingKey(node.parentId, node.slugKey)
      if (!bySiblingSlug.has(key)) bySiblingSlug.set(key, [])
      bySiblingSlug.get(key).push(node)
    }

    if (node.tokenSetKey) {
      const key = siblingKey(node.parentId, node.tokenSetKey)
      if (!bySiblingTokenSet.has(key)) bySiblingTokenSet.set(key, [])
      bySiblingTokenSet.get(key).push(node)
    }
  }

  return { byId, childrenOf, roots, bySiblingSlug, bySiblingTokenSet, siblingKey }
}

/**
 * Duplicatas que JÁ existem na conta: nós irmãos que colidem na chave canônica.
 *
 * Só colisão exata de chave (estágio 1). O relatório completo — fuzzy e semântico —
 * chega com o matcher na Fase 2. Mesmo assim isto já responde "quantas duplicatas
 * temos hoje", que é o diagnóstico que motivou a feature.
 */
export function findExactDuplicates(nodes) {
  const { bySiblingSlug, bySiblingTokenSet } = buildIndexes(nodes)
  const groups = []
  const seen = new Set()

  const collect = (index, matchedBy) => {
    for (const [key, siblings] of index) {
      if (siblings.length < 2) continue

      const ids = siblings.map((n) => n.anymarketId).sort()
      const signature = ids.join(',')
      if (seen.has(signature)) continue
      seen.add(signature)

      groups.push({
        matchedBy,
        key: key.split('|')[1],
        parentId: siblings[0].parentId,
        parentPath: siblings[0].fullPath.split(' > ').slice(0, -1).join(' > ') || null,
        nodes: siblings.map((n) => ({
          anymarketId: n.anymarketId,
          name: n.name,
          fullPath: n.fullPath,
          childCount: n.childCount,
        })),
      })
    }
  }

  collect(bySiblingSlug, 'slugKey')
  collect(bySiblingTokenSet, 'tokenSetKey')

  return groups.sort((a, b) => b.nodes.length - a.nodes.length)
}

/** Grava o espelho no Firestore, removendo nós que não existem mais na API. */
async function persistTree(clientId, nodes, syncedAt) {
  const collectionRef = db.collection('clients').doc(clientId).collection(COLLECTION)
  const metaRef = db.collection('clients').doc(clientId).collection('meta').doc(META_DOC)
  const fingerprint = treeFingerprint(nodes)

  // Árvore de milhares de nós custaria milhares de ESCRITAS a cada sincronização, e
  // este projeto já convive com estouro de cota do Firestore. Se a impressão digital
  // não mudou, uma leitura de doc resolve e nenhuma escrita é feita.
  try {
    const meta = await metaRef.get()
    if (meta.exists && meta.data()?.fingerprint === fingerprint) {
      await metaRef.set({ lastSyncAt: FieldValue.serverTimestamp(), lastSyncAtIso: syncedAt, unchanged: true }, { merge: true })
      console.log(`[CategoryTree] ${clientId}: árvore inalterada (${nodes.length} nós) — espelho preservado, zero escritas.`)
      return { written: 0, removed: 0, unchanged: true }
    }
  } catch (err) {
    console.warn('[CategoryTree] Aviso ao comparar impressão digital (seguindo com regravação):', err.message)
  }

  const existingIds = new Set()
  try {
    const snapshot = await collectionRef.select().get()
    snapshot.docs.forEach((doc) => existingIds.add(doc.id))
  } catch (err) {
    console.warn('[CategoryTree] Aviso ao listar espelho atual (seguindo sem remoção de obsoletos):', err.message)
  }

  const incomingIds = new Set(nodes.map((n) => n.anymarketId))
  const staleIds = [...existingIds].filter((id) => !incomingIds.has(id))

  // BulkWriter em vez de batch loteado por contagem: o commit também tem limite de
  // TAMANHO (~10 MiB), e lotear só por operação já rendeu
  // "INVALID_ARGUMENT: Transaction too big" na exclusão de documentos RAG.
  await bulkSet(
    db,
    nodes.map((node) => ({ ref: collectionRef.doc(node.anymarketId), data: { ...node, syncedAt } }))
  )

  if (staleIds.length) {
    await bulkDelete(
      db,
      staleIds.map((id) => collectionRef.doc(id))
    )
  }

  await metaRef.set(
    {
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncAtIso: syncedAt,
      nodeCount: nodes.length,
      removedCount: staleIds.length,
      fingerprint,
      unchanged: false,
    },
    { merge: true }
  )

  return { written: nodes.length, removed: staleIds.length, unchanged: false }
}

/** Lê o espelho do Firestore (sem tocar a API). */
async function readMirror(clientId) {
  const snapshot = await db.collection('clients').doc(clientId).collection(COLLECTION).get()
  if (snapshot.empty) return null

  const nodes = snapshot.docs.map((doc) => ({ anymarketId: doc.id, ...doc.data() }))
  const syncedAt = nodes.reduce((latest, n) => (n.syncedAt && n.syncedAt > latest ? n.syncedAt : latest), '')

  return { nodes, syncedAt: syncedAt || null }
}

/**
 * Ressincroniza a árvore a partir da API do AnyMarket.
 * Só leitura no AnyMarket; escreve no Firestore e no cache.
 */
export async function syncCategoryTree(clientId, { persist = true } = {}) {
  const startedAt = Date.now()
  const syncedAt = new Date().toISOString()

  if (isTestClient(clientId)) {
    const nodes = buildTree(getMockCategoryTree())
    const tree = { nodes, nodeCount: nodes.length, syncedAt, source: 'mock', truncated: false }
    categoryTreeCache.set(clientId, tree)
    return { ...tree, persisted: false, durationMs: Date.now() - startedAt }
  }

  const token = await resolveAnymarketToken(clientId)

  // Retoma de onde a última tentativa parou. Numa conta com milhares de categorias,
  // um 429 na página 47 não pode custar as 46 páginas já lidas — cota gasta é cota
  // gasta, e repetir tudo aumenta a chance de estourar de novo.
  const resumeFrom = syncCheckpoints.get(clientId) ?? null
  if (resumeFrom) {
    console.log(
      `[CategoryTree] Retomando sincronização do cliente ${clientId}: ${resumeFrom.items.length} categoria(s) já lidas, seguindo do offset ${resumeFrom.offset}.`
    )
  }

  let raw
  let pages
  let truncated
  let strategy = 'paginado'

  // Caminho preferido: UMA chamada em /categories/fullPath. A varredura paginada da
  // mesma conta são 47+ requisições e já tomou 429 — só entra como plano B, se a
  // conta não expuser o endpoint hierárquico.
  if (!resumeFrom) {
    try {
      const full = await fetchCategoriesFullPath(token)
      const nodes = buildTree(full.raw)
      const tree = { nodes, nodeCount: nodes.length, syncedAt, source: 'anymarket', truncated: false, strategy: 'fullPath' }
      categoryTreeCache.set(clientId, tree)

      let persistResult = null
      if (persist) {
        try {
          persistResult = await persistTree(clientId, nodes, syncedAt)
        } catch (err) {
          console.warn('[CategoryTree] Aviso ao gravar espelho no Firestore (árvore mantida em cache):', err.message)
        }
      }

      console.log(
        `[CategoryTree] Cliente ${clientId} → ${nodes.length} categoria(s) em 1 chamada (fullPath), ${Date.now() - startedAt}ms`
      )

      return {
        ...tree,
        pages: 1,
        persisted: Boolean(persistResult),
        written: persistResult?.written ?? 0,
        removed: persistResult?.removed ?? 0,
        unchanged: persistResult?.unchanged ?? false,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      console.warn(
        `[CategoryTree] /categories/fullPath indisponível (${err.status ?? 'erro'}: ${err.message}). Caindo para varredura paginada.`
      )
    }
  }

  try {
    const result = await fetchCategories(token, {
      resumeFrom,
      onProgress: ({ pages: done, itemCount }) => {
        if (done % 10 === 0) console.log(`[CategoryTree] ${clientId}: ${done} página(s), ${itemCount} categoria(s)…`)
      },
    })
    raw = result.raw
    pages = result.pages
    truncated = result.truncated
    syncCheckpoints.delete(clientId)
  } catch (err) {
    if (err.checkpoint?.items?.length) {
      syncCheckpoints.set(clientId, err.checkpoint)
      err.message = `${err.message} — ${err.checkpoint.items.length} categoria(s) já lidas ficaram salvas; chame a sincronização de novo para continuar de onde parou.`
      err.resumable = true
    }
    throw err
  }

  const nodes = buildTree(raw)

  const tree = { nodes, nodeCount: nodes.length, syncedAt, source: 'anymarket', truncated, strategy }
  categoryTreeCache.set(clientId, tree)

  let persistResult = null
  if (persist) {
    try {
      persistResult = await persistTree(clientId, nodes, syncedAt)
    } catch (err) {
      // Firestore fora do ar ou em cota estourada não invalida a sincronização:
      // a árvore já está em memória e o fluxo de leitura segue funcionando.
      console.warn('[CategoryTree] Aviso ao gravar espelho no Firestore (árvore mantida em cache):', err.message)
    }
  }

  console.log(
    `[CategoryTree] Cliente ${clientId} → ${nodes.length} categoria(s) em ${pages} página(s), ${Date.now() - startedAt}ms${truncated ? ' (PAGINAÇÃO TRUNCADA)' : ''}`
  )

  return {
    ...tree,
    pages,
    persisted: Boolean(persistResult),
    written: persistResult?.written ?? 0,
    removed: persistResult?.removed ?? 0,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * Carrega a árvore pela via mais barata disponível:
 * cache em memória → espelho no Firestore → API do AnyMarket.
 */
export async function loadCategoryTree(clientId, { forceSync = false, allowSync = true } = {}) {
  if (!forceSync) {
    const cached = categoryTreeCache.get(clientId)
    if (cached) return { ...cached, source: 'cache' }

    if (!isTestClient(clientId)) {
      try {
        const mirror = await readMirror(clientId)
        if (mirror?.nodes?.length) {
          const tree = {
            nodes: mirror.nodes,
            nodeCount: mirror.nodes.length,
            syncedAt: mirror.syncedAt,
            source: 'firestore',
            truncated: false,
          }
          categoryTreeCache.set(clientId, tree)
          return tree
        }
      } catch (err) {
        console.warn('[CategoryTree] Aviso ao ler espelho do Firestore (indo à API):', err.message)
      }
    }
  }

  // Sem espelho e sem permissão de sincronizar: erro explícito em vez de disparar
  // dezenas de páginas dentro de um clique do operador. Uma conta com milhares de
  // categorias leva ~1 minuto para varrer — isso é operação deliberada, não efeito
  // colateral de abrir um modal.
  // Cliente de teste não tem custo de sincronização: a árvore é a falsa, em memória,
  // sem uma chamada de API. O guarda existe por causa da cota da API real.
  if (!allowSync && !isTestClient(clientId)) {
    const err = new Error(
      'A árvore de categorias deste cliente ainda não foi sincronizada. Rode a sincronização (POST /api/categories/sync/:clientId) antes de usar a sugestão de categorias.'
    )
    err.code = 'tree_not_synced'
    err.status = 409
    throw err
  }

  return syncCategoryTree(clientId)
}
