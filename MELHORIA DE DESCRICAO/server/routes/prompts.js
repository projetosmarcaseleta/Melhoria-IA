import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROMPTS_PATH = join(__dirname, '../config/prompts.json')

/** GET /api/prompts — retorna os prompts atuais */
router.get('/', async (_req, res, next) => {
  try {
    const raw = await readFile(PROMPTS_PATH, 'utf8')
    res.json(JSON.parse(raw))
  } catch (err) {
    next(err)
  }
})

/** PUT /api/prompts — salva novos prompts no arquivo */
router.put('/', async (req, res, next) => {
  try {
    const { descricao, titulo } = req.body ?? {}
    if (typeof descricao !== 'string' || typeof titulo !== 'string') {
      return res.status(400).json({ error: 'Campos "descricao" e "titulo" são obrigatórios.' })
    }
    const payload = JSON.stringify({ descricao, titulo }, null, 2)
    await writeFile(PROMPTS_PATH, payload, 'utf8')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
