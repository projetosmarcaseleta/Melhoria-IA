import OpenAI from 'openai'
import { observeOpenAI } from '@langfuse/openai'

const baseClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** Cria um proxy do cliente OpenAI com atributos seguros específicos da chamada. */
export function getOpenAIClient({
  traceName = 'cria-openai',
  generationName,
  clientId,
  operatorId,
  productId,
  metadata = {},
  tags = [],
} = {}) {
  return observeOpenAI(baseClient, {
    traceName,
    generationName,
    userId: operatorId ? String(operatorId) : undefined,
    sessionId: clientId ? String(clientId) : undefined,
    tags: ['cria', ...tags],
    generationMetadata: {
      ...metadata,
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(productId !== undefined && productId !== null ? { productId: String(productId) } : {}),
    },
  })
}
