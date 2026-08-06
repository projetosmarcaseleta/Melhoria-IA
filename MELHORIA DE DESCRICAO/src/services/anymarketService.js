import axios from 'axios'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function getAuthHeaders() {
  const session = useStore.getState().auth.session
  if (!session?.access_token) {
    throw new Error('Usuário não autenticado.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

/**
 * Envia PATCH ao AnyMarket via backend Express → n8n webhook.
 * `clientId`: ID do cliente ativo no Firestore
 * `generationIds`: IDs das gerações a marcar como 'appliedAt'
 */
export async function patchProduct(productId, title, description, gumgaToken, generationIds = []) {
  const activeClient = useStore.getState().activeClient

  await axios.post(
    `${API_BASE}/api/anymarket/patch`,
    {
      productId,
      title,
      description,
      gumgaToken,
      clientId: activeClient?.id,
      generationIds,
    },
    {
      timeout: 60_000,
      headers: getAuthHeaders(),
    }
  )
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
