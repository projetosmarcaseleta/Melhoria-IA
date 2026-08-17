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

