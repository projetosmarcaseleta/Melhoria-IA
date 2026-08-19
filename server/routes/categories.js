/**
 * Rotas de categorias do AnyMarket.
 *
 * A feature é OPCIONAL e acionada por produto: nada aqui roda em lote automático.
 * `/suggest` só analisa; `/approve` é o único ponto que cria categoria; `/attach`
 * substitui a categoria do produto e é reversível por `/attach/undo`.
 *
 * O token do AnyMarket nunca vem do corpo da requisição — é resolvido no servidor
 * a partir do clientId (§3 da especificação).
 *
 * Ver docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md §3, §9 e §9.1.
 */

import { Router } from 'express'
import { AnymarketApiError, getPacing } from '../services/anymarketClient.js'
import { categoryTreeCache } from '../services/categoryTreeCache.js'
import { loadCategoryTree, syncCategoryTree, findExactDuplicates, getSyncCheckpoint } from '../services/categoryTreeService.js'
import { profileTree, suggestMaxDepth } from '../services/categoryTreeProfiler.js'
import {
  CategoryServiceError,
  suggestCategory,
  approveProposal,
  rejectProposal,
  listProposals,
  attachCategory,
  attachCategoryBatch,
  undoAttachment,
  listAttachments,
  getProductCategory,
  getCategoryConfig,
} from '../services/categoryService.js'

const router = Router()

/** Projeção enxuta para a UI — `embedding` nunca vai na resposta (payload de MBs). */
function serializeNode(node, { full = false } = {}) {
  const base = {
    anymarketId: node.anymarketId,
    name: node.name,
    parentId: node.parentId ?? null,
    depth: node.depth ?? 0,
    fullPath: node.fullPath ?? node.name,
    hasChildren: Boolean(node.hasChildren),
  }

  if (!full) return base

  const { embedding, ...rest } = node
  return { ...rest, ...base }
}

/**
 * Condições que valem para o CLIENTE inteiro, não para um produto específico.
 * Precisam interromper o lote e chegar à UI com o código preservado.
 */
const CLIENT_LEVEL_CODES = new Set(['skill_inactive', 'tree_not_synced', 'sync_interrupted'])

export function isClientLevelError(err) {
  if (CLIENT_LEVEL_CODES.has(err?.code)) return true
  if (err?.resumable) return true
  // Token ausente/ inválido: nenhum produto do lote vai funcionar.
  if (err instanceof AnymarketApiError && [400, 401, 403].includes(err.status)) return true
  return false
}

function handleError(err, res, next) {
  // Árvore não sincronizada e sincronização interrompida no meio são condições
  // operacionais previsíveis, não bugs: viram resposta acionável com o código que a
  // UI usa para oferecer o botão certo.
  if (err.code === 'tree_not_synced' || err.resumable) {
    return res.status(err.status ?? 503).json({
      error: err.message,
      code: err.code ?? 'sync_interrupted',
      resumable: Boolean(err.resumable),
      partialCount: err.checkpoint?.items?.length ?? null,
    })
  }
  if (err instanceof CategoryServiceError) {
    console.warn(`[Categories] ${err.code ?? 'erro'}: ${err.message}`)
    return res.status(err.status).json({ error: err.message, code: err.code, detail: err.detail })
  }
  if (err instanceof AnymarketApiError) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    console.error(`[Categories] ${err.message}`, err.data ?? '')
    return res.status(status).json({ error: err.message, detail: err.data ?? null })
  }
  return next(err)
}

/**
 * GET /api/categories/tree/:clientId
 * Query: refresh=true (força ida à API), full=true (todos os campos), duplicates=true
 */
router.get('/tree/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const forceSync = req.query.refresh === 'true'
    const full = req.query.full === 'true'
    const withDuplicates = req.query.duplicates === 'true'

    const tree = await loadCategoryTree(clientId, { forceSync })

    return res.json({
      clientId,
      nodeCount: tree.nodeCount ?? tree.nodes.length,
      syncedAt: tree.syncedAt ?? null,
      source: tree.source,
      truncated: Boolean(tree.truncated),
      nodes: tree.nodes.map((node) => serializeNode(node, { full })),
      ...(withDuplicates ? { duplicates: findExactDuplicates(tree.nodes) } : {}),
    })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/categories/duplicates/:clientId
 *
 * Diagnóstico do que JÁ está duplicado na conta hoje — nós irmãos que colidem na
 * chave canônica. Só colisão exata; fuzzy e semântico chegam com o matcher (Fase 2).
 */
router.get('/duplicates/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const tree = await loadCategoryTree(clientId, { forceSync: req.query.refresh === 'true' })
    const duplicates = findExactDuplicates(tree.nodes)

    return res.json({
      clientId,
      nodeCount: tree.nodeCount ?? tree.nodes.length,
      syncedAt: tree.syncedAt ?? null,
      source: tree.source,
      groupCount: duplicates.length,
      affectedNodeCount: duplicates.reduce((sum, group) => sum + group.nodes.length, 0),
      duplicates,
    })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/categories/sync/:clientId
 * Relê a árvore na API do AnyMarket e regrava o espelho no Firestore.
 * Leitura no AnyMarket; escrita apenas no Firestore.
 */
router.post('/sync/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const result = await syncCategoryTree(clientId)

    return res.json({
      ok: true,
      clientId,
      nodeCount: result.nodeCount,
      pages: result.pages ?? null,
      truncated: Boolean(result.truncated),
      persisted: result.persisted,
      written: result.written,
      removed: result.removed,
      durationMs: result.durationMs,
      syncedAt: result.syncedAt,
      source: result.source,
      unchanged: result.unchanged ?? false,
      pacing: getPacing(),
    })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** GET /api/categories/cache/stats — cache, ritmo atual e checkpoint de sincronização. */
router.get('/cache/stats', (req, res) =>
  res.json({
    cache: categoryTreeCache.stats(),
    pacing: getPacing(),
    checkpoint: req.query.clientId ? getSyncCheckpoint(req.query.clientId) : null,
  })
)


/**
 * GET /api/categories/config/:clientId
 * A UI usa isto para decidir se mostra o botão de categoria no card do produto.
 */
router.get('/config/:clientId', async (req, res, next) => {
  try {
    const { isActive, config } = await getCategoryConfig(req.params.clientId, { requireActive: false })
    return res.json({ clientId: req.params.clientId, isActive, config })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/categories/profile/:clientId
 * Perfil da árvore (decisão D3): raízes reais, profundidade típica, vocabulário.
 */
router.get('/profile/:clientId', async (req, res, next) => {
  try {
    const tree = await loadCategoryTree(req.params.clientId)
    const profile = profileTree(tree.nodes)
    return res.json({ ...profile, suggestedMaxDepth: suggestMaxDepth(profile), syncedAt: tree.syncedAt, source: tree.source })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/categories/product/:clientId/:productId
 * Categoria ATUAL do produto — é o "de" da substituição.
 */
router.get('/product/:clientId/:productId', async (req, res, next) => {
  try {
    const current = await getProductCategory(req.params.clientId, req.params.productId)
    return res.json({ productId: req.params.productId, currentCategory: current })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/categories/suggest
 * Body: { clientId, product: { id, title, description?, characteristics? } }
 *        ou { clientId, products: [...] }
 *
 * NÃO escreve no AnyMarket. Só analisa, deduplica e grava a proposta.
 */
router.post('/suggest', async (req, res, next) => {
  try {
    const { clientId, product, products } = req.body ?? {}
    if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório.' })

    const targets = Array.isArray(products) ? products : product ? [product] : []
    if (!targets.length) return res.status(400).json({ error: 'Informe product ou products.' })

    const userId = req.user?.id ?? 'system'
    const results = []

    for (const item of targets) {
      try {
        results.push({ productId: item.id, proposal: await suggestCategory(clientId, item, { userId }) })
      } catch (err) {
        // Erro de CLIENTE (skill desligada, árvore não sincronizada, token ausente)
        // não é falha daquele produto: precisa subir com o `code` intacto, senão a UI
        // recebe só a mensagem e não sabe qual botão oferecer.
        if (isClientLevelError(err)) throw err

        console.error(`[Categories] Falha ao sugerir categoria do produto ${item?.id}:`, err.message)
        results.push({ productId: item?.id, error: err.message })
      }
    }

    // Chamada de um produto (o caminho do botão no card) devolve a proposta direto.
    if (results.length === 1 && !Array.isArray(products)) {
      const only = results[0]
      if (only.error) return res.status(502).json({ error: only.error })
      return res.json(only.proposal)
    }

    return res.json({ results })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** GET /api/categories/proposals/:clientId — fila agrupada por caminho. */
router.get('/proposals/:clientId', async (req, res, next) => {
  try {
    const proposals = await listProposals(req.params.clientId, { status: req.query.status ?? null })
    return res.json({ clientId: req.params.clientId, total: proposals.length, proposals })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/categories/approve
 * Body: { clientId, proposalId, confirmNewRoot?: boolean }
 *
 * ÚNICO ponto de escrita irreversível. A confirmação do operador no modal é a
 * aprovação humana exigida pelo princípio P1.
 */
router.post('/approve', async (req, res, next) => {
  try {
    const { clientId, proposalId, confirmNewRoot } = req.body ?? {}
    if (!clientId || !proposalId) {
      return res.status(400).json({ error: 'clientId e proposalId são obrigatórios.' })
    }

    const result = await approveProposal(clientId, proposalId, {
      userId: req.user?.id ?? 'system',
      confirmNewRoot: Boolean(confirmNewRoot),
    })

    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** POST /api/categories/reject — rejeita a proposta e grava o aprendizado. */
router.post('/reject', async (req, res, next) => {
  try {
    const { clientId, proposalId, reason } = req.body ?? {}
    if (!clientId || !proposalId) {
      return res.status(400).json({ error: 'clientId e proposalId são obrigatórios.' })
    }

    return res.json(await rejectProposal(clientId, proposalId, { userId: req.user?.id ?? 'system', reason }))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/categories/attach
 * Body: { clientId, productId, categoryId, proposalId? }
 *        ou { clientId, productIds: [...], categoryId } para lote
 *
 * SUBSTITUI a categoria atual do produto. Reversível via /attach/undo.
 */
router.post('/attach', async (req, res, next) => {
  try {
    const { clientId, productId, productIds, categoryId, proposalId } = req.body ?? {}
    if (!clientId || !categoryId) {
      return res.status(400).json({ error: 'clientId e categoryId são obrigatórios.' })
    }

    const userId = req.user?.id ?? 'system'

    if (Array.isArray(productIds) && productIds.length) {
      return res.json(await attachCategoryBatch(clientId, { productIds, categoryId, proposalId, userId }))
    }

    if (!productId) return res.status(400).json({ error: 'Informe productId ou productIds.' })

    return res.json(await attachCategory(clientId, { productId, categoryId, proposalId, userId }))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** POST /api/categories/attach/undo — devolve o produto à categoria anterior. */
router.post('/attach/undo', async (req, res, next) => {
  try {
    const { clientId, attachmentId } = req.body ?? {}
    if (!clientId || !attachmentId) {
      return res.status(400).json({ error: 'clientId e attachmentId são obrigatórios.' })
    }

    return res.json(await undoAttachment(clientId, attachmentId, { userId: req.user?.id ?? 'system' }))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** GET /api/categories/attachments/:clientId — histórico de vínculos (auditoria). */
router.get('/attachments/:clientId', async (req, res, next) => {
  try {
    const attachments = await listAttachments(req.params.clientId, { productId: req.query.productId ?? null })
    return res.json({ clientId: req.params.clientId, total: attachments.length, attachments })
  } catch (err) {
    return handleError(err, res, next)
  }
})

export default router
