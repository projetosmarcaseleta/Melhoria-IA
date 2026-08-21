import apiClient, { API_BASE, getFreshAuthToken } from './apiClient'
import useStore from '../store/useStore'

// Tempo sem NENHUMA linha nova antes de considerar o stream morto.
const STREAM_IDLE_TIMEOUT_MS = 120_000

/**
 * Id que o backend recebe e devolve em cada resultado.
 *
 * É a MESMA chave que o store usa para casar o produto (`_key || id`, ver useStore):
 * webhookService monta `_key` com a mesma fórmula. Exportado porque, com lote por
 * requisição, os componentes precisam casar cada resultado do stream com seu produto —
 * casar por índice seria trocar a descrição de um produto pela de outro.
 */
export function payloadIdOf(p) {
  return p._key || (p.idSku ? `${p.id}-${p.idSku}` : p.id)
}

function buildPayload(products) {
  return products.map((p) => ({
    id: payloadIdOf(p),
    title: p.title,
    description: p.description,
    characteristics: p.characteristics,
  }))
}

/**
 * Envia produtos ao backend para processamento com IA.
 * Usa a rota /api/generate com autenticação dinâmica e multi-cliente.
 *
 * `fields`: array com os campos a gerar — ['title'], ['description'] ou ['title','description'] (padrão).
 * Retorna: [{id, newTitle?, newDescription?, titleGenerationId?, descGenerationId?, error?}]
 */
export async function processProductsWithAI(products, fields = ['title', 'description']) {
  const activeClient = useStore.getState().activeClient

  if (!activeClient?.id) {
    throw new Error('Nenhum cliente selecionado.')
  }

  const response = await apiClient.post(
    '/api/generate',
    {
      clientId: activeClient.id,
      products: buildPayload(products),
      fields,
    },
    {
      timeout: 120_000,
    }
  )

  return response.data.results
}

/**
 * Mesma rota, em stream: manda um LOTE de produtos numa requisição e chama `onResult` a
 * cada produto pronto, em vez de esperar o lote inteiro.
 *
 * Por que existe: o navegador limita ~6 conexões por origem em HTTP/1.1, então mandar um
 * produto por requisição fazia os 50 workers virarem ~6 gerações em voo, com 44 paradas na
 * fila do browser. Mandando lote, a concorrência real passa a ser decidida no servidor — e
 * o stream é o que devolve o progresso produto a produto que o caminho de 1-por-requisição
 * dava de graça.
 *
 * Usa `fetch` porque axios no navegador só entrega a resposta completa. Se o servidor
 * responder JSON normal (versão antiga, sem suporte a stream), cai no caminho de sempre.
 */
export async function processProductsWithAIStream(products, fields, onResult, { signal } = {}) {
  const activeClient = useStore.getState().activeClient

  if (!activeClient?.id) {
    throw new Error('Nenhum cliente selecionado.')
  }

  const token = await getFreshAuthToken()

  // O caminho antigo (axios) tinha timeout de 120s por requisição. Num stream o equivalente
  // correto não é duração total — um lote grande legitimamente passa disso — e sim
  // INATIVIDADE: se nenhuma linha chega em 120s, a conexão morreu e a UI não pode ficar
  // presa em "processando" para sempre.
  const controller = new AbortController()
  const encerrar = () => controller.abort()

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', encerrar, { once: true })
  }

  let expirouPorInatividade = false
  let watchdog = null

  const reiniciarWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      expirouPorInatividade = true
      controller.abort()
    }, STREAM_IDLE_TIMEOUT_MS)
  }

  const limpar = () => {
    if (watchdog) clearTimeout(watchdog)
    signal?.removeEventListener?.('abort', encerrar)
  }

  reiniciarWatchdog()

  let response
  try {
    response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        clientId: activeClient.id,
        products: buildPayload(products),
        fields,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    limpar()
    if (expirouPorInatividade) throw new Error('A geração não respondeu em 120s.')
    throw err
  }

  if (!response.ok) {
    limpar()
    let detalhe = ''
    try {
      detalhe = (await response.json())?.error ?? ''
    } catch {
      detalhe = ''
    }
    throw new Error(detalhe || `Falha na geração (HTTP ${response.status}).`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  // Servidor sem suporte a stream: devolve tudo de uma vez, mesmo formato.
  if (!contentType.includes('application/x-ndjson') || !response.body) {
    try {
      const data = await response.json()
      const results = data?.results ?? []
      results.forEach((r) => onResult?.(r))
      return results
    } finally {
      limpar()
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const results = []
  let buffer = ''
  let erroFinal = null

  const consumirLinha = (linha) => {
    const texto = linha.trim()
    if (!texto) return

    let parsed
    try {
      parsed = JSON.parse(texto)
    } catch {
      // Linha truncada ou ruído de proxy: ignorar é melhor que derrubar o lote inteiro.
      console.warn('[aiService] Linha inválida no stream de geração:', texto.slice(0, 120))
      return
    }

    if (parsed.done) {
      if (parsed.error) erroFinal = parsed.error
      return
    }

    results.push(parsed)
    onResult?.(parsed)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      reiniciarWatchdog()
      buffer += decoder.decode(value, { stream: true })

      let quebra = buffer.indexOf('\n')
      while (quebra !== -1) {
        consumirLinha(buffer.slice(0, quebra))
        buffer = buffer.slice(quebra + 1)
        quebra = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    consumirLinha(buffer)
  } catch (err) {
    // Já entregamos ao chamador, via onResult, tudo que chegou antes da queda. Quem
    // decide o que fazer com os produtos que não voltaram é o componente.
    if (expirouPorInatividade) throw new Error('A geração parou de responder (120s sem retorno).')
    throw err
  } finally {
    limpar()
  }

  if (erroFinal) throw new Error(erroFinal)

  return results
}

/**
 * Envia feedback para uma geração específica.
 */
export async function submitFeedback(generationId, status, editedText, reason) {
  const response = await apiClient.patch(
    `/api/feedback/${generationId}`,
    { status, editedText, reason }
  )
  return response.data
}

/**
 * Envia feedback em lote.
 */
export async function submitBatchFeedback(generationIds, status) {
  const response = await apiClient.post(
    '/api/feedback/batch',
    { generationIds, status }
  )
  return response.data
}
