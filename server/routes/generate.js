import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { resolvePrompt } from '../services/promptResolver.js'
import { generateWithLLM } from '../services/llmService.js'
import { sanitizeLLMOutput, applyDeterministicRules, validateOutput, enforceMaxLength } from '../services/outputValidator.js'
import { isTestClient, getMockClient, saveMockGeneration, getMockGenerations } from '../services/mockStorage.js'
import { toTitleCase } from '../utils/textCase.js'

const router = Router()

// toTitleCase vive em utils/textCase.js — o normalizador de categorias aplica a mesma regra
// em nome de categoria nova. Re-exportado aqui para não quebrar imports existentes.
export { toTitleCase }

const clientSettingsCache = new Map()
const CLIENT_SETTINGS_TTL_MS = 60_000
const clientSettingsInFlight = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

// Teto de produtos abertos ao mesmo tempo DENTRO de uma requisição. Não é o limite real de
// concorrência da geração — esse é o llmLimiter, global ao processo e adaptativo. Este aqui
// só evita que uma requisição com centenas de produtos instancie tudo de uma vez.
const MAX_PRODUCTS_IN_FLIGHT = Math.max(1, num(process.env.GENERATE_MAX_IN_FLIGHT, 32))

// Tentativas de gravação no Firestore depois que a resposta já saiu.
const PERSIST_MAX_RETRIES = Math.max(0, num(process.env.GENERATE_PERSIST_RETRIES, 2))

/**
 * Escritas que falharam mesmo depois dos retries.
 *
 * Existe porque a perda é INVISÍVEL para o operador: PATCH /api/feedback/:id trata
 * "documento não existe" caindo no mockStore em vez de devolver 404, então o feedback de
 * uma geração não gravada iria para a memória do processo e sumiria no próximo restart do
 * pm2 — e o few-shot pararia de aprender sem ninguém perceber. Exposto em /api/diagnostics.
 */
const persistenceFailures = { total: 0, ultimo: null }

export function getGenerationPersistenceStats() {
  return { falhasDefinitivas: persistenceFailures.total, ultima: persistenceFailures.ultimo }
}

async function getCachedClientSettings(clientId) {
  const hit = clientSettingsCache.get(clientId)
  if (hit && Date.now() < hit.expiresAt) return hit.settings

  // Single-flight, mesmo motivo do promptCache: as requisições de um lote chegam
  // praticamente juntas e erravam o cache no mesmo instante, cada uma lendo o documento do
  // cliente no Firestore para descobrir o mesmo modelo e a mesma temperatura.
  const flying = clientSettingsInFlight.get(clientId)
  if (flying) return flying

  const promise = (async () => {
    let settings = {}

    if (isTestClient(clientId)) {
      const client = getMockClient(clientId)
      settings = client.settings ?? {}
    } else {
      try {
        const clientDoc = await db.collection('clients').doc(clientId).get()
        if (clientDoc.exists) {
          settings = clientDoc.data()?.settings ?? {}
        } else {
          settings = getMockClient(clientId).settings ?? {}
        }
      } catch (err) {
        console.warn('[Generate] Aviso ao buscar cliente no Firestore:', err.message)
        settings = getMockClient(clientId).settings ?? {}
      }
    }

    clientSettingsCache.set(clientId, { settings, expiresAt: Date.now() + CLIENT_SETTINGS_TTL_MS })
    return settings
  })().finally(() => {
    clientSettingsInFlight.delete(clientId)
  })

  clientSettingsInFlight.set(clientId, promise)
  return promise
}

/**
 * Processa `items` com no máximo `concurrency` em andamento, mantendo a ordem no retorno.
 *
 * Espelha `parallelProcess` de src/utils/batchUtils.js, em versão mínima: `fn` aqui nunca
 * lança (generateForProduct devolve `{ id, error }`), então não há posição de erro a tratar.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length)
  let nextIdx = 0

  async function worker() {
    while (true) {
      const i = nextIdx++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

/**
 * Grava a geração no Firestore FORA do caminho crítico da resposta.
 *
 * Os ids dos documentos vêm de `db.collection(...).doc()`, que os gera localmente, sem ida
 * ao servidor — então a resposta pode sair com o id definitivo antes do commit terminar.
 * Antes, cada produto esperava o `batch.commit()` para só depois voltar ao navegador.
 *
 * O batch é reconstruído a cada tentativa porque um WriteBatch já submetido não é
 * reutilizável.
 */
function commitGenerationsInBackground(writes, contexto, fallbackEmMemoria) {
  if (!writes.length) return

  void (async () => {
    for (let tentativa = 0; ; tentativa++) {
      try {
        const batch = db.batch()
        writes.forEach(({ ref, data }) => batch.set(ref, data))
        await batch.commit()
        return
      } catch (err) {
        if (tentativa >= PERSIST_MAX_RETRIES) {
          persistenceFailures.total++
          persistenceFailures.ultimo = {
            ...contexto,
            erro: err.message,
            em: new Date().toISOString(),
          }
          console.error(
            `[Generate] Falha definitiva ao gravar geração do produto ${contexto.productId} após ${tentativa + 1} tentativa(s):`,
            err.message
          )
          try {
            fallbackEmMemoria()
          } catch (fallbackErr) {
            console.error('[Generate] Fallback em memória também falhou:', fallbackErr.message)
          }
          return
        }

        await sleep(300 * 2 ** tentativa)
      }
    }
  })()
}

/**
 * Gera título e/ou descrição de UM produto e devolve o item de `results`.
 *
 * Recebe os prompts já resolvidos: `resolvePrompt` não usa dados do produto, então
 * resolver por produto era repetir a mesma resolução N vezes por requisição.
 */
async function generateForProduct(product, ctx) {
  const {
    clientId, model, titleTemperature, descTemperature,
    doTitle, doDesc, titlePrompt, descPrompt, operatorId,
  } = ctx

  try {
    const tasks = await Promise.all([
      doTitle && titlePrompt
        ? generateWithLLM({
            systemPrompt: titlePrompt.systemPrompt,
            productData: product,
            model,
            temperature: titleTemperature,
          })
        : Promise.resolve(null),
      doDesc && descPrompt
        ? generateWithLLM({
            systemPrompt: descPrompt.systemPrompt,
            productData: product,
            model,
            temperature: descTemperature,
          })
        : Promise.resolve(null),
    ])

    const [rawTitle, rawDesc] = tasks

    if (doTitle && !rawTitle) throw new Error('LLM retornou título vazio.')
    if (doDesc && !rawDesc) throw new Error('LLM retornou descrição vazia.')

    // 1. Sanitizar saídas (remover cercas de código ```html)
    let newTitle = doTitle ? sanitizeLLMOutput(rawTitle) : ''
    let newDescription = doDesc ? sanitizeLLMOutput(rawDesc) : ''

    // 2. Aplicar formatação Title Case no título
    if (newTitle) {
      newTitle = toTitleCase(newTitle)
    }

    // 3. Aplicação Determinística de Regras Finais (Prepend/Append de textos fixos/institucionais)
    let titleDeterministicRules = []
    let descDeterministicRules = []

    if (doTitle && titlePrompt?.approvedRules) {
      const resTitle = applyDeterministicRules(newTitle, titlePrompt.approvedRules, 'titulo')
      newTitle = resTitle.finalOutput
      titleDeterministicRules = resTitle.deterministicRulesApplied
    }

    if (doDesc && descPrompt?.approvedRules) {
      const resDesc = applyDeterministicRules(newDescription, descPrompt.approvedRules, 'descricao')
      newDescription = resDesc.finalOutput
      descDeterministicRules = resDesc.deterministicRulesApplied
    }

    // 3.1 Skill "Limite de Caracteres do Título" — rede de segurança determinística,
    // já que o LLM pode não respeitar o limite mesmo quando instruído no prompt.
    const titleMaxLengthConfig = titlePrompt?.activeSkillsConfig?.title_max_length
    if (doTitle && titleMaxLengthConfig?.maxLength) {
      newTitle = enforceMaxLength(newTitle, Number(titleMaxLengthConfig.maxLength))
    }

    // 4. Validação Pós-Geração contra proibições e regras
    const titleValidation = doTitle
      ? validateOutput(newTitle, titlePrompt?.approvedRules ?? [], 'titulo', {
          maxLength: titleMaxLengthConfig?.maxLength ? Number(titleMaxLengthConfig.maxLength) : undefined,
        })
      : null
    const descValidation = doDesc ? validateOutput(newDescription, descPrompt?.approvedRules ?? [], 'descricao') : null

    let titleGenId = `gen-title-${Date.now()}-${product.id}`
    let descGenId = `gen-desc-${Date.now()}-${product.id}`

    const entrada = {
      clientId,
      operatorId,
      productId: String(product.id),
      inputTitle: product.title ?? '',
      inputDescription: product.description ?? '',
      inputCharacteristics: product.characteristics ?? '',
    }

    // Se for cliente teste, grava na memória
    if (isTestClient(clientId)) {
      if (doTitle && newTitle && titlePrompt) {
        const saved = saveMockGeneration({
          id: titleGenId,
          ...entrada,
          generationType: 'titulo',
          promptVersion: titlePrompt.version,
          modelUsed: model,
          temperatureUsed: titleTemperature,
          skillsApplied: titlePrompt.skillsApplied,
          ragChunksUsed: titlePrompt.ragChunksUsed ?? [],
          deterministicRulesApplied: titleDeterministicRules,
          validationResult: titleValidation,
          generatedText: newTitle.trim(),
          feedbackStatus: 'pending',
        })
        titleGenId = saved.id
      }

      if (doDesc && newDescription && descPrompt) {
        const saved = saveMockGeneration({
          id: descGenId,
          ...entrada,
          generationType: 'descricao',
          promptVersion: descPrompt.version,
          modelUsed: model,
          temperatureUsed: descTemperature,
          skillsApplied: descPrompt.skillsApplied,
          ragChunksUsed: descPrompt.ragChunksUsed ?? [],
          deterministicRulesApplied: descDeterministicRules,
          validationResult: descValidation,
          generatedText: newDescription.trim(),
          feedbackStatus: 'pending',
        })
        descGenId = saved.id
      }
    } else {
      // Fallback compartilhado: usado tanto quando a preparação do batch falha na hora
      // quanto quando o commit em background esgota as tentativas. Payload reduzido, igual
      // ao que o caminho antigo gravava no catch.
      const salvarEmMemoria = () => {
        if (doTitle && newTitle) {
          saveMockGeneration({
            id: titleGenId,
            clientId,
            operatorId,
            productId: String(product.id),
            generationType: 'titulo',
            generatedText: newTitle.trim(),
            feedbackStatus: 'pending',
          })
        }
        if (doDesc && newDescription) {
          saveMockGeneration({
            id: descGenId,
            clientId,
            operatorId,
            productId: String(product.id),
            generationType: 'descricao',
            generatedText: newDescription.trim(),
            feedbackStatus: 'pending',
          })
        }
      }

      try {
        const writes = []

        if (doTitle && newTitle && titlePrompt) {
          const titleRef = db.collection('generations').doc()
          titleGenId = titleRef.id

          writes.push({
            ref: titleRef,
            data: {
              ...entrada,
              generationType: 'titulo',
              promptVersion: titlePrompt.version,
              modelUsed: model,
              temperatureUsed: titleTemperature,
              skillsApplied: titlePrompt.skillsApplied,
              ragChunksUsed: titlePrompt.ragChunksUsed ?? [],
              deterministicRulesApplied: titleDeterministicRules,
              validationResult: titleValidation,
              generatedText: newTitle.trim(),
              feedbackStatus: 'pending',
              createdAt: FieldValue.serverTimestamp(),
            },
          })
        }

        if (doDesc && newDescription && descPrompt) {
          const descRef = db.collection('generations').doc()
          descGenId = descRef.id

          writes.push({
            ref: descRef,
            data: {
              ...entrada,
              generationType: 'descricao',
              promptVersion: descPrompt.version,
              modelUsed: model,
              temperatureUsed: descTemperature,
              skillsApplied: descPrompt.skillsApplied,
              ragChunksUsed: descPrompt.ragChunksUsed ?? [],
              deterministicRulesApplied: descDeterministicRules,
              validationResult: descValidation,
              generatedText: newDescription.trim(),
              feedbackStatus: 'pending',
              createdAt: FieldValue.serverTimestamp(),
            },
          })
        }

        commitGenerationsInBackground(writes, { clientId, productId: String(product.id) }, salvarEmMemoria)
      } catch (prepErr) {
        console.warn('[Generate] Aviso ao preparar gravação no Firestore (salvando em memória temporária):', prepErr.message)
        salvarEmMemoria()
      }
    }

    return {
      id: product.id,
      ...(doTitle
        ? {
            newTitle: newTitle.trim(),
            titleGenerationId: titleGenId,
            titleValidation: titleValidation,
            titleRulesApplied: titleDeterministicRules,
          }
        : {}),
      ...(doDesc
        ? {
            newDescription: newDescription.trim(),
            descGenerationId: descGenId,
            descValidation: descValidation,
            descRulesApplied: descDeterministicRules,
          }
        : {}),
    }
  } catch (err) {
    const msg = err?.message ?? String(err)
    console.error(`[Generate] Erro produto ${product?.id}:`, msg)
    return { id: product?.id, error: msg }
  }
}

/**
 * Modo stream é OPT-IN pelo header Accept. Sem ele, a resposta continua sendo exatamente o
 * `{ results: [...] }` de sempre — nenhum cliente existente muda de comportamento.
 */
function wantsNdjson(req) {
  return String(req.headers.accept ?? '').includes('application/x-ndjson')
}

/**
 * POST /api/generate
 * Body: {
 *   clientId: string,
 *   products: [{ id, title, description, characteristics }],
 *   fields?: ['title', 'description']
 * }
 * Response: { results: [{ id, newTitle?, newDescription?, titleGenerationId?, descGenerationId?, error? }] }
 *
 * Com `Accept: application/x-ndjson`, os mesmos itens de `results` saem um por linha, à
 * medida que ficam prontos, fechando com `{"done":true,"total":N}`. É o que permite mandar
 * um LOTE de produtos por requisição sem perder o progresso produto a produto: o navegador
 * limita ~6 conexões por origem em HTTP/1.1, então 50 requisições de um produto viravam ~6
 * gerações em voo e 44 na fila do browser.
 */
router.post('/', async (req, res, next) => {
  try {
    const { clientId, products, fields } = req.body ?? {}

    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório.' })
    }
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products deve ser um array não vazio.' })
    }

    const settings = await getCachedClientSettings(clientId)
    const model = settings.model ?? 'gpt-4o-mini'
    const titleTemperature = settings.titleTemperature ?? (settings.temperature !== undefined ? Math.min(settings.temperature, 0.4) : 0.2)
    const descTemperature = settings.temperature ?? 0.4

    const doTitle = !fields || fields.includes('title')
    const doDesc = !fields || fields.includes('description')

    // Prompts resolvidos UMA vez por requisição, com busca de contexto RAG e regras
    // estruturadas. Tudo que pode falhar aqui falha ANTES de qualquer header ir embora,
    // então o handler de erro do Express ainda consegue responder um JSON limpo.
    const [titlePrompt, descPrompt] = await Promise.all([
      doTitle ? resolvePrompt(clientId, 'titulo') : null,
      doDesc ? resolvePrompt(clientId, 'descricao') : null,
    ])

    const ctx = {
      clientId,
      model,
      titleTemperature,
      descTemperature,
      doTitle,
      doDesc,
      titlePrompt,
      descPrompt,
      operatorId: req.user?.id ?? 'test-operator-id',
    }

    const stream = wantsNdjson(req)

    if (stream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      // Sem isto o nginx da VPS acumula a resposta inteira antes de repassar, e o stream
      // deixa de existir na prática.
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()
    }

    // Cancelar no navegador (botão "Interromper", aba fechada) aborta o fetch. Sem observar
    // isso, o servidor seguiria queimando cota da OpenAI gerando texto que ninguém recebe.
    let abortado = false
    res.on('close', () => {
      if (!res.writableEnded) abortado = true
    })

    const results = await mapWithConcurrency(products, MAX_PRODUCTS_IN_FLIGHT, async (product) => {
      if (abortado) return { id: product?.id, error: 'Geração interrompida pelo cliente.' }

      const result = await generateForProduct(product, ctx)
      if (stream && !res.writableEnded) res.write(`${JSON.stringify(result)}\n`)
      return result
    })

    if (stream) {
      if (!res.writableEnded) res.write(`${JSON.stringify({ done: true, total: results.length })}\n`)
      return res.end()
    }

    return res.json({ results })
  } catch (err) {
    if (res.headersSent) {
      // Stream já começou: não há como devolver status de erro, então o erro vai na última
      // linha e o cliente decide o que fazer com os produtos que já chegaram.
      if (!res.writableEnded) res.write(`${JSON.stringify({ done: true, error: err?.message ?? 'Erro interno na geração.' })}\n`)
      return res.end()
    }
    next(err)
  }
})

/**
 * GET /api/generate/history/:clientId
 * Lista histórico de gerações de um cliente.
 */
router.get('/history/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { limit = 50, status, type } = req.query

    if (isTestClient(clientId)) {
      const data = getMockGenerations(clientId, Number(limit))
      return res.json({ data, total: data.length })
    }

    try {
      let query = db.collection('generations')
        .where('clientId', '==', clientId)

      if (status) query = query.where('feedbackStatus', '==', status)
      if (type) query = query.where('generationType', '==', type)

      const snapshot = await query
        .limit(Number(limit))
        .get()

      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      return res.json({ data, total: data.length })
    } catch (err) {
      console.warn('[GenerateHistory] Aviso Firestore:', err.message)
      const data = getMockGenerations(clientId, Number(limit))
      return res.json({ data, total: data.length })
    }
  } catch (err) {
    next(err)
  }
})

export default router


