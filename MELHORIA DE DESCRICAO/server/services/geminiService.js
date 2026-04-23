import { GoogleGenAI } from '@google/genai'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const GEMINI_MODEL = 'gemini-1.5-flash'

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

function splitPrompt(template, vars) {
  const systemInstruction = template.replace(/\n\nDADOS DISPONÍVEIS[\s\S]*$/, '').trim()
  const userContent       = applyVars(
    template.replace(/^[\s\S]*?\n\nDADOS DISPONÍVEIS/, 'DADOS DISPONÍVEIS'),
    vars
  )
  return { systemInstruction, userContent }
}

function makeClient(apiKey) {
  if (!apiKey) throw new Error('Gemini API key não configurada. Adicione-a nas configurações (⚙️).')
  return new GoogleGenAI({ apiKey })
}

/** Gera nova descrição HTML usando Gemini */
export async function generateDescricaoGemini({ title, description, characteristics }, apiKey) {
  const ai = makeClient(apiKey)
  const { systemInstruction, userContent } = splitPrompt(
    loadPrompts().descricao,
    { title, description, characteristics }
  )

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userContent,
    config: {
      systemInstruction,
      temperature: 1,
    },
  })

  return response.text
}

/** Gera novo título usando Gemini */
export async function generateTituloGemini({ title, description, characteristics }, apiKey) {
  const ai = makeClient(apiKey)
  const { systemInstruction, userContent } = splitPrompt(
    loadPrompts().titulo,
    { title, description, characteristics }
  )

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userContent,
    config: {
      systemInstruction,
      temperature: 1,
    },
  })

  return response.text
}
