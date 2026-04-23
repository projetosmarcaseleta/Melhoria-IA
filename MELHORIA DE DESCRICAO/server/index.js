import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import aiRouter from './routes/ai.js'
import anymarketRouter from './routes/anymarket.js'
import promptsRouter from './routes/prompts.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.use('/api', aiRouter)
app.use('/api/anymarket', anymarketRouter)
app.use('/api/prompts', promptsRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ── Middleware de erro global ──────────────────────────────────────────────
// Express 4 não captura erros de async handlers automaticamente.
// Este handler recebe qualquer erro repassado via next(err).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500
  const message = err.message ?? 'Erro interno no servidor'
  console.error('[Erro]', status, message, err.stack ?? '')
  res.status(status).json({ error: message })
})

app.listen(PORT, () => {
  console.log(`[Backend] Servidor rodando em http://localhost:${PORT}`)
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[AVISO] OPENAI_API_KEY não definida no .env — chamadas à IA vão falhar.')
  }
})
