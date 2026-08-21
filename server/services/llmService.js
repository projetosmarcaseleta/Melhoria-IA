import OpenAI from 'openai'
import { llmLimiter, isRateLimitError } from './llmLimiter.js'

let client = null
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'test-key' })
  }
  return client
}

/**
 * Único ponto de saída para a API de chat da OpenAI.
 *
 * Toda chamada passa pelo `llmLimiter`, que é global ao processo: o teto de concorrência
 * vale para o conjunto das requisições HTTP em andamento, não por requisição. É isso que
 * permite o navegador mandar lotes sem precisar adivinhar o limite da conta.
 *
 * `withResponse()` é usado em vez do retorno direto porque os headers de rate limit só
 * existem na resposta crua — e é deles que sai a decisão de subir ou descer o teto.
 */
async function createChatCompletion(params) {
  await llmLimiter.acquire()

  try {
    const { data, response } = await getClient().chat.completions.create(params).withResponse()
    llmLimiter.reportSuccess(response.headers)
    return data
  } catch (err) {
    if (isRateLimitError(err)) llmLimiter.reportThrottle()
    throw err
  } finally {
    llmLimiter.release()
  }
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

  const response = await createChatCompletion({
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
  // Mesmo limitador do caminho de título/descrição: a cota é da MESMA conta, então
  // classificar categoria e gerar anúncio competem pelo mesmo teto.
  const response = await createChatCompletion({
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
