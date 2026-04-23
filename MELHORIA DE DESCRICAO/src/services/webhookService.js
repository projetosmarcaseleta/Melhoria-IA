import axios from 'axios'

/**
 * Envia os IDs ao webhook n8n (que executa a query PostgreSQL)
 * e retorna os dados completos dos produtos.
 *
 * O webhook deve retornar: [{ID, TITULO, DESCRIÇÃO, CARACTERISTICAS}, ...]
 */
export async function fetchProductsFromWebhook(webhookUrl, ids) {
  if (!webhookUrl) {
    throw new Error('URL do webhook n8n não configurada. Acesse as configurações.')
  }

  const response = await axios.post(
    webhookUrl,
    { ids },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60_000,
    }
  )

  const data = response.data

  // Normaliza: aceita array direto ou { products: [...] } ou { data: [...] }
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.products)
    ? data.products
    : Array.isArray(data?.data)
    ? data.data
    : null

  if (!raw) {
    throw new Error(
      'Resposta do webhook em formato inesperado. Esperado: array de produtos.'
    )
  }

  return raw.map((item) => ({
    id: String(item.ID ?? item.id ?? ''),
    title: item.TITULO ?? item.title ?? '',
    description: item['DESCRIÇÃO'] ?? item.DESCRICAO ?? item.description ?? '',
    characteristics: normalizeCharacteristics(item.CARACTERISTICAS ?? item.characteristics ?? ''),
    status: 'idle',
  }))
}

/** Normaliza características: aceita string, array de {index,value} ou array de strings */
function normalizeCharacteristics(raw) {
  if (!raw) return ''
  if (typeof raw === 'string') return raw

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (item?.index && item?.value) return `${item.index}: ${item.value}`
        if (item?.name && item?.value) return `${item.name}: ${item.value}`
        return JSON.stringify(item)
      })
      .join(' | ')
  }

  return JSON.stringify(raw)
}
