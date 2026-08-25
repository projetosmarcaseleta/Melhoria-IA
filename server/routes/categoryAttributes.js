/**
 * Rotas de atributos (características) de categoria por canal.
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §2 e §4.
 *
 * Tudo aqui usa a API pública v2 — contrato estável. A única escrita é o PATCH de
 * valores no produto, e ela é reversível na prática (basta gravar o valor anterior).
 */

import { Router } from 'express'
import { AnymarketApiError } from '../services/anymarketClient.js'
import {
  CategoryAttributesError,
  getCategoryAttributes,
  validateProductAttributes,
  saveProductAttributes,
  extractProductAttributesWithAI,
} from '../services/categoryAttributesService.js'

const router = Router()

function handleError(err, res, next) {
  if (err instanceof CategoryAttributesError) {
    console.warn(`[CategoryAttributes] ${err.code ?? 'erro'}: ${err.message}`)
    return res.status(err.status).json({ error: err.message, code: err.code, detail: err.detail })
  }
  if (err instanceof AnymarketApiError) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    console.error(`[CategoryAttributes] ${err.message}`, err.data ?? '')
    return res.status(status).json({ error: err.message, code: err.code ?? null, detail: err.data ?? null })
  }
  return next(err)
}

const parseList = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/**
 * POST /api/category-attributes/ai-extract
 * Body: { clientId, productId, title, description, characteristics, attributes }
 */
router.post('/ai-extract', async (req, res, next) => {
  try {
    const { clientId, productId, title, description, characteristics, attributes, scope } = req.body ?? {}
    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório.', code: 'missing_client' })
    }
    const result = await extractProductAttributesWithAI(clientId, {
      productId,
      title,
      description,
      characteristics,
      attributes,
      scope,
    })
    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/category-attributes/product/:clientId/:productId
 * Query: categoryId (opcional — padrão é a categoria atual do produto), marketplaces, refresh
 *
 * Declarada ANTES da rota de categoria: `/product/x` também casa com
 * `/:clientId/:anymarketCategoryId`, e a ordem é o que decide.
 */
router.get('/product/:clientId/:productId', async (req, res, next) => {
  try {
    const { clientId, productId } = req.params
    const result = await validateProductAttributes(clientId, {
      productId,
      anymarketCategoryId: req.query.categoryId ?? null,
      marketplaces: parseList(req.query.marketplaces),
      refresh: req.query.refresh === 'true',
    })
    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * PATCH /api/category-attributes/product/:clientId/:productId
 * Body: { updates: [{ name, value }] }
 */
router.patch('/product/:clientId/:productId', async (req, res, next) => {
  try {
    const { clientId, productId } = req.params
    const result = await saveProductAttributes(
      clientId,
      { productId, updates: req.body?.updates, dryRun: req.body?.dryRun === true },
      { userId: req.user?.id ?? 'desconhecido' }
    )
    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/category-attributes/:clientId/:anymarketCategoryId
 * Query: marketplace, refresh=true, withValues=true
 *
 * Sem `marketplace`, devolve os atributos do hub (os que valem para todo canal) e a
 * lista de canais que têm detalhamento próprio — para a UI pedir canal por canal.
 */
router.get('/:clientId/:anymarketCategoryId', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId } = req.params
    const result = await getCategoryAttributes(clientId, anymarketCategoryId, {
      marketplace: req.query.marketplace ?? null,
      refresh: req.query.refresh === 'true',
      withValues: req.query.withValues === 'true',
    })
    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

export default router
