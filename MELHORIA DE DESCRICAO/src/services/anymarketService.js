import axios from 'axios'

/**
 * Envia PATCH ao AnyMarket via backend Express → n8n webhook.
 * A URL do webhook é definida no .env do servidor.
 */
export async function patchProduct(productId, title, description, gumgaToken) {
  if (!gumgaToken) {
    throw new Error('Token AnyMarket (gumgaToken) não configurado.')
  }

  await axios.post(
    '/edit/api/anymarket/patch',
    { productId, title, description, gumgaToken },
    { timeout: 60_000 }
  )
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
