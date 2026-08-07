import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MODEL = 'gpt-4o-mini'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROMPTS_PATH = join(__dirname, '../config/prompts.json')

function loadPrompts() {
  return JSON.parse(readFileSync(PROMPTS_PATH, 'utf8'))
}

function applyVars(template, { title, description, characteristics }) {
  return template
    .replace(/\{\{title\}\}/g, title ?? '')
    .replace(/\{\{description\}\}/g, description ?? '')
    .replace(/\{\{characteristics\}\}/g, characteristics ?? '')
}

/** Gera nova descrição HTML usando o prompt configurado */
export async function generateDescricao({ title, description, characteristics }, customPrompt) {
  const template = customPrompt ?? loadPrompts().descricao
  const systemPrompt = template.replace(/\n\nDADOS DISPONÍVEIS[\s\S]*$/, '').trim()
  const userPrompt = applyVars(template.replace(/^[\s\S]*?\n\nDADOS DISPONÍVEIS/, 'DADOS DISPONÍVEIS'), { title, description, characteristics })

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  return response.choices[0].message.content
}

/** Gera novo título usando o prompt configurado */
export async function generateTitulo({ title, description, characteristics }, customPrompt) {
  const template = customPrompt ?? loadPrompts().titulo
  const systemPrompt = template.replace(/\n\nDADOS DISPONÍVEIS[\s\S]*$/, '').trim()
  const userPrompt = applyVars(template.replace(/^[\s\S]*?\n\nDADOS DISPONÍVEIS/, 'DADOS DISPONÍVEIS'), { title, description, characteristics })

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  return response.choices[0].message.content
}
