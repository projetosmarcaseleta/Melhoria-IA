import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Aplica variáveis de template no prompt.
 */
function applyVars(template, { title, description, characteristics }) {
  return template
    .replace(/\{\{title\}\}/g, title ?? '')
    .replace(/\{\{description\}\}/g, description ?? '')
    .replace(/\{\{characteristics\}\}/g, characteristics ?? '')
}

/**
 * Gera conteúdo usando o LLM.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Prompt completo já resolvido (com few-shot + skills)
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
  // Separar system instructions do bloco de dados do produto
  const systemPart = systemPrompt
    .replace(/\n\nDADOS DISPONÍVEIS[\s\S]*$/, '')
    .replace(/\n\nEXEMPLOS DE RESULTADOS APROVADOS[\s\S]*?(\n\n[A-Z]|$)/, (match, after) => after || '')
    .trim()

  // Extrair o bloco de dados disponíveis e aplicar variáveis
  const dataPart = systemPrompt.match(/DADOS DISPONÍVEIS[\s\S]*$/)
  const userContent = dataPart
    ? applyVars(dataPart[0], productData)
    : `Título: ${productData.title ?? ''}\nDescrição: ${productData.description ?? ''}\nCaracterísticas: ${productData.characteristics ?? ''}`

  // Reconstruir system prompt completo (sem o bloco de dados, que vai para o user)
  // Incluir few-shot e skills que estão no systemPrompt
  const fewShotMatch = systemPrompt.match(/\n\nEXEMPLOS DE RESULTADOS APROVADOS[\s\S]*?---\n/)
  const skillsMatch = systemPrompt.match(/\n\nINSTRUÇÃO ADICIONAL[\s\S]*/g)

  let finalSystem = systemPart
  if (fewShotMatch) finalSystem += fewShotMatch[0]
  if (skillsMatch) finalSystem += skillsMatch.join('')

  const response = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: 'system', content: finalSystem.trim() },
      { role: 'user', content: userContent },
    ],
  })

  return response.choices[0].message.content
}
