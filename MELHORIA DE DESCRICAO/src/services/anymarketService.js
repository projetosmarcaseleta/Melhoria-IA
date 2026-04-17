import axios from 'axios'

/**
 * Envia PATCH ao AnyMarket via backend Express.
 * `fields`: array com os campos a atualizar — ['title'], ['description'] ou ['title','description'] (padrão).
 */
export async function patchProduct(
  productId,
  title,
  description,
  gumgaToken,
  anymarketWebhookUrl = '',
) {
  if (!gumgaToken) {
    throw new Error('Token AnyMarket (gumgaToken) não configurado.')
  }

  await axios.post(
    '/api/anymarket/patch',
    {
      productId,
      title,
      description,
      gumgaToken,
      webhookUrl: anymarketWebhookUrl || undefined,
    },
    { timeout: 60_000 }
  )
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
