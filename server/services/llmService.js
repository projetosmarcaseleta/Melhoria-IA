import OpenAI from 'openai'

let client = null
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'test-key' })
  }
  return client
}

/**
 * Gera conteúdo usando o LLM.
 *
 * O systemPrompt já vem totalmente resolvido pelo promptResolver
 * (RAG + few-shot + skills + instruções). NÃO fazer parsing ou splitting aqui.
 *
 * Os dados do produto são enviados separadamente como mensagem do usuário
 * para que o LLM tenha clareza sobre o que é instrução vs. o que é input.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Prompt completo já resolvido pelo promptResolver
 * @param {object} params.productData  - { title, description, characteristics }
 * @param {string} params.model        - Modelo a usar (ex: 'gpt-4o-mini')
 * @param {number} params.temperature  - Temperatura
 * @returns {string} Texto gerado
 */
export async function generateWithLLM({
  systemPrompt,
  productData,
  model = 'gpt-4o-mini',
  temperature = 1,
}) {
  // Dados do produto como mensagem do usuário — separados das instruções do sistema
  const userMessage = [
    productData.title           ? `Título original: ${productData.title}`          : null,
    productData.description     ? `Descrição original: ${productData.description}` : null,
    productData.characteristics ? `Características: ${productData.characteristics}`: null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const openai = getClient()
  const response = await openai.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt.trim() },
      { role: 'user',   content: userMessage },
    ],
  })

  return response.choices[0].message.content
}


/**
 * Gera JSON validado por schema (Structured Outputs).
 *
 * Usado pelo classificador de categorias, onde a saída alimenta código (funil de
 * dedup, criação na API) e não um humano — texto livre ali significaria parsing
 * frágil. `strict: true` faz a própria API rejeitar saída fora do schema.
 *
 * NÃO altera generateWithLLM: o caminho de título/descrição continua idêntico.
 *
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {string} params.userMessage
 * @param {{name: string, schema: object}} params.jsonSchema
 * @returns {Promise<object>} objeto já parseado
 */
export async function generateStructured({
  systemPrompt,
  userMessage,
  jsonSchema,
  model = 'gpt-4o-mini',
  temperature = 0.1,
}) {
  const openai = getClient()

  const response = await openai.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: 'system', content: String(systemPrompt ?? '').trim() },
      { role: 'user', content: String(userMessage ?? '').trim() },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true },
    },
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('LLM retornou resposta estruturada vazia.')

  try {
    return JSON.parse(content)
  } catch (err) {
    throw new Error(`LLM retornou JSON inválido: ${err.message}`)
  }
}
