import apiClient from './apiClient'
import useStore from '../store/useStore'

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

  const payload = products.map((p) => ({
    id: p._key || (p.idSku ? `${p.id}-${p.idSku}` : p.id),
    title: p.title,
    description: p.description,
    characteristics: p.characteristics,
  }))

  const response = await apiClient.post(
    '/api/generate',
    {
      clientId: activeClient.id,
      products: payload,
      fields,
    },
    {
      timeout: 120_000,
    }
  )

  return response.data.results
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
