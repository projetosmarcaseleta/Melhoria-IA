import apiClient from './apiClient'

/**
 * Consulta os produtos via backend proxy → n8n webhook PostgreSQL.
 * A URL do webhook é definida no .env do servidor (N8N_CONSULTA_WEBHOOK_URL).
 *
 * O webhook deve retornar: [{ID, TITULO, DESCRIÇÃO, CARACTERISTICAS}, ...]
 */
export async function fetchProductsFromWebhook(ids) {
  const response = await apiClient.post(
    '/api/anymarket/fetch-products',
    { ids },
    {
      headers: {
        'Content-Type': 'application/json',
      },
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

  return raw.map((item, index) => {
    const id = String(item.ID ?? item.id ?? '')
    const idSku = String(item.ID_SKU ?? item.idSku ?? '')
    return {
      _key: idSku ? `${id}-${idSku}` : id,
      id,
      idSku,
      sku: String(item.SKU ?? item.sku ?? ''),
      title: item.TITULO ?? item.title ?? '',
      description: item['DESCRIÇÃO'] ?? item.DESCRICAO ?? item.description ?? '',
      characteristics: normalizeCharacteristics(item.CARACTERISTICAS ?? item.characteristics ?? ''),
      productType: item.TIPO ?? item.productType ?? 'SIMPLE',
      priceCalculation: item['CÁLCULO DE PREÇO'] ?? item.CALCULO_DE_PRECO ?? item.priceCalculation ?? '',
      status: 'idle',
    }
  })
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
