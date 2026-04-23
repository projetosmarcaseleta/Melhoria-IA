import axios from 'axios'
import useStore from '../store/useStore'

/**
 * Envia produtos ao backend para processamento com IA.
 * `fields`: array com os campos a gerar — ['title'], ['description'] ou ['title','description'] (padrão).
 * O provedor (OpenAI ou Gemini) é lido automaticamente das configurações.
 * Retorna: [{id, newTitle?, newDescription?, error?}]
 */
export async function processProductsWithAI(products, fields = ['title', 'description']) {
  const { aiProvider, geminiApiKey } = useStore.getState().config

  const payload = products.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    characteristics: p.characteristics,
  }))

  const response = await axios.post(
    '/edit/api/process',
    {
      products: payload,
      fields,
      provider: aiProvider ?? 'openai',
      ...(aiProvider === 'gemini' && geminiApiKey ? { geminiApiKey } : {}),
    },
    { timeout: 120_000 }
  )

  return response.data.results
}
