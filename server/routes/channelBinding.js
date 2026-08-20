/**
 * Rotas do vínculo de categoria por canal (de-para).
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §1 e §4.
 *
 * Só `POST /apply` escreve, e escreve no AnyMarket via a API interna do painel —
 * caminho frágil de propósito isolado em `channelBindClient.js`. Quando o painel
 * recusa o token (`panel_token_unsupported`) ou muda o contrato
 * (`internal_contract_changed`), a resposta carrega o código e a UI manda o operador
 * concluir na tela do AnyMarket, em vez de mostrar "erro interno".
 *
 * Medido contra conta real em 19/08/2026: o gumgaToken NÃO abre a API interna do
 * painel — `/status` continua respondendo (degradado, pelo espelho local) e `/pending`
 * segue funcionando (v2 pública), mas `/apply`, `/suggestions` e `/tree` dependem do
 * painel. Ver §7 da especificação.
 *
 * O token do AnyMarket nunca vem do corpo da requisição — é resolvido no servidor a
 * partir do clientId, mesma regra das rotas de categoria.
 */

import { Router } from 'express'
import { AnymarketApiError } from '../services/anymarketClient.js'
import {
  ChannelBindError,
  getBindingStatus,
  suggestBinding,
  browseChannelTree,
  applyBinding,
  getMirroredBindings,
  scanUnpublished,
  getClientMarketplaces,
  getMarketplaceCatalog,
  proposeBindings,
  applyBindingsBatch,
} from '../services/channelBindService.js'

const router = Router()

/**
 * Tradução de erro para a UI.
 *
 * O caso que merece atenção é `bind_failed_after_clean`: HTTP de erro, mas com
 * `retrySafe` no corpo, porque o operador PRECISA saber que ficou pela metade e que
 * tentar de novo é seguro. Responder um 502 pelado aqui deixaria a categoria sem
 * de-para sem ninguém sabendo.
 */
export function handleError(err, res, next) {
  if (err instanceof ChannelBindError) {
    console.warn(`[ChannelBinding] ${err.code ?? 'erro'}: ${err.message}`)
    return res.status(err.status).json({ error: err.message, code: err.code, detail: err.detail })
  }

  if (err instanceof AnymarketApiError) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    console.error(`[ChannelBinding] ${err.message}`, err.data ?? '')
    return res.status(status).json({
      error: err.message,
      code: err.code ?? (err.internalApi ? 'internal_api_error' : null),
      internalApi: Boolean(err.internalApi),
      detail: err.data ?? null,
    })
  }

  return next(err)
}

const parseList = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/** GET /api/channel-bindings/marketplaces/:clientId — canais configurados do cliente. */
router.get('/marketplaces/:clientId', async (req, res, next) => {
  try {
    const marketplaces = await getClientMarketplaces(req.params.clientId)
    return res.json({ clientId: req.params.clientId, marketplaces, configured: marketplaces.length > 0 })
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/channel-bindings/status/:clientId/:anymarketCategoryId
 * Query: marketplaces=MERCADO_LIVRE,MAGAZINE_LUIZA
 *
 * Fonte da verdade é o hub (§1.1), não o espelho — é a checagem determinística de
 * "está vinculada?" antes de aprovar ou exibir badge.
 */
router.get('/status/:clientId/:anymarketCategoryId', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId } = req.params
    const status = await getBindingStatus(clientId, anymarketCategoryId, {
      marketplaces: parseList(req.query.marketplaces),
    })
    return res.json(status)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/channel-bindings/catalog/:clientId
 *
 * Catálogo de canais da plataforma (`GET /v2/marketplaces`, público e confirmado
 * contra conta real). Não é a lista de canais ATIVOS da conta — serve para validar o
 * código digitado e mostrar nome legível no lugar de `MERCADO_LIVRE`.
 */
router.get('/catalog/:clientId', async (req, res, next) => {
  try {
    return res.json(await getMarketplaceCatalog(req.params.clientId))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** GET /api/channel-bindings/mirror/:clientId/:anymarketCategoryId — só o espelho local. */
router.get('/mirror/:clientId/:anymarketCategoryId', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId } = req.params
    return res.json(await getMirroredBindings(clientId, anymarketCategoryId))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/** GET /api/channel-bindings/suggestions/:clientId/:anymarketCategoryId/:marketplace (§1.3) */
router.get('/suggestions/:clientId/:anymarketCategoryId/:marketplace', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId, marketplace } = req.params
    return res.json(await suggestBinding(clientId, { anymarketCategoryId, marketplace }))
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/channel-bindings/tree/:clientId/:marketplace?code=MLB1010 (§1.4)
 *
 * Um nível por chamada. `canBeSelected` marca a folha vinculável — a UI não deve
 * permitir salvar um nó intermediário.
 */
router.get('/tree/:clientId/:marketplace', async (req, res, next) => {
  try {
    const { clientId, marketplace } = req.params
    const level = await browseChannelTree(clientId, {
      marketplace,
      codeInMarketPlace: req.query.code ?? null,
      accountIdentifier: req.query.account ?? null,
    })
    return res.json(level)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/channel-bindings/apply (§1.5)
 * Body: { clientId, anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source }
 *
 * Duas chamadas em sequência ao painel, sob lock por categoria+canal, com a intenção
 * registrada antes da metade destrutiva. `source` ('suggestion' | 'manual') vira o
 * `suggestionAccepted` da API e fica gravado para medir a qualidade das sugestões.
 */
router.post('/apply', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source = 'manual' } = req.body ?? {}

    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório.', code: 'missing_client' })
    }

    const result = await applyBinding(
      clientId,
      { anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source },
      { userId: req.user?.id ?? 'desconhecido' }
    )

    return res.json(result)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/channel-bindings/propose
 * Body: { clientId, anymarketCategoryId, marketplaces?, includeBound?, useLlm? }
 *
 * O caminho principal: o CRIA resolve o de-para de TODOS os canais e devolve as propostas
 * com confiança, origem e o rastro das decisões. Não escreve nada — a escrita é o
 * /apply-batch, depois da confirmação.
 *
 * Demora: são chamadas ao painel por nível de árvore, mais desempate pelo LLM. O timeout
 * do cliente precisa ser generoso.
 */
router.post('/propose', async (req, res, next) => {
  try {
    const { clientId, anymarketCategoryId, marketplaces = null, includeBound = false, useLlm = true } = req.body ?? {}

    if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório.', code: 'missing_client' })

    const resultado = await proposeBindings(clientId, {
      anymarketCategoryId,
      marketplaces: Array.isArray(marketplaces) ? marketplaces : null,
      includeBound: includeBound === true,
      useLlm: useLlm !== false,
    })

    return res.json(resultado)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * POST /api/channel-bindings/apply-batch
 * Body: { clientId, bindings: [{ anymarketCategoryId, marketplace, codeInMarketPlace, completePath, source }] }
 *
 * Uma confirmação, N canais. Responde 207 quando parte aplicou e parte falhou — meio lote
 * gravado precisa ser visível, não escondido atrás de 200 ou de 500.
 */
router.post('/apply-batch', async (req, res, next) => {
  try {
    const { clientId, bindings } = req.body ?? {}

    if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório.', code: 'missing_client' })

    const resultado = await applyBindingsBatch(clientId, { bindings }, { userId: req.user?.id ?? 'desconhecido' })

    return res.status(resultado.ok ? 200 : 207).json(resultado)
  } catch (err) {
    return handleError(err, res, next)
  }
})

/**
 * GET /api/channel-bindings/pending/:clientId (§1.2)
 *
 * Diagnóstico em lote pelas transmissões não publicadas. Sinal, não veredito: a
 * classificação é heurística sobre texto livre do marketplace.
 */
router.get('/pending/:clientId', async (req, res, next) => {
  try {
    return res.json(await scanUnpublished(req.params.clientId))
  } catch (err) {
    return handleError(err, res, next)
  }
})

export default router
