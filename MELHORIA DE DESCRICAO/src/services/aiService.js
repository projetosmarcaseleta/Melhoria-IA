import axios from 'axios'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * Retorna headers de autenticação com o token do Supabase.
 */
function getAuthHeaders() {
  const session = useStore.getState().auth.session
  if (!session?.access_token) {
    throw new Error('Usuário não autenticado.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

/**
 * Envia produtos ao backend para processamento com IA.
 * Usa a nova rota /api/generate que requer clientId e autenticação.
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
    id: p.id,
    title: p.title,
    description: p.description,
    characteristics: p.characteristics,
  }))

  const response = await axios.post(
    `${API_BASE}/api/generate`,
    {
      clientId: activeClient.id,
      products: payload,
      fields,
    },
    {
      timeout: 120_000,
      headers: getAuthHeaders(),
    }
  )

  return response.data.results
}

/**
 * Envia feedback para uma geração específica.
 */
export async function submitFeedback(generationId, status, editedText, reason) {
  const response = await axios.patch(
    `${API_BASE}/api/feedback/${generationId}`,
    { status, editedText, reason },
    { headers: getAuthHeaders() }
  )
  return response.data
}

/**
 * Envia feedback em lote.
 */
export async function submitBatchFeedback(generationIds, status) {
  const response = await axios.post(
    `${API_BASE}/api/feedback/batch`,
    { generationIds, status },
    { headers: getAuthHeaders() }
  )
  return response.data
}

/**
 * Busca métricas de feedback de um cliente.
 */
export async function fetchFeedbackStats(clientId) {
  const response = await axios.get(
    `${API_BASE}/api/feedback/stats/${clientId}`,
    { headers: getAuthHeaders() }
  )
  return response.data
}
