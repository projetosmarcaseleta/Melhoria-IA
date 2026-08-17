import apiClient from './apiClient'
import useStore from '../store/useStore'

/**
 * Envia PATCH ao AnyMarket via backend Express → n8n webhook.
 * `clientId`: ID do cliente ativo no Firestore
 * `generationIds`: IDs das gerações a marcar como 'appliedAt'
 */
export async function patchProduct(productId, title, description, gumgaToken, generationIds = []) {
  const activeClient = useStore.getState().activeClient

  await apiClient.post(
    '/api/anymarket/patch',
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
    }
  )
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
