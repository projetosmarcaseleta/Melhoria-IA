import 'dotenv/config'
import express from 'express'
import cors from 'cors'

// Rotas
import clientsRouter from './routes/clients.js'
import generateRouter from './routes/generate.js'
import promptsRouter from './routes/prompts.js'
import feedbackRouter from './routes/feedback.js'
import anymarketRouter from './routes/anymarket.js'
import knowledgeRouter from './routes/knowledge.js'
import insightsRouter from './routes/insights.js'
import skillsRouter from './routes/skills.js'
import operatorsRouter from './routes/operators.js'

// Middleware
import { requireAuth } from './middleware/auth.js'

// Manter rota antiga para retrocompatibilidade durante migração
import aiRouter from './routes/ai.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── Rotas públicas ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ── Rota antiga (sem auth) — retrocompatibilidade ──────────────
// Remover após migração completa do frontend
app.use('/api', aiRouter)

// ── Rotas protegidas (requerem autenticação) ───────────────────
app.use('/api/clients', requireAuth, clientsRouter)
app.use('/api/generate', requireAuth, generateRouter)
app.use('/api/prompts', requireAuth, promptsRouter)
app.use('/api/feedback', requireAuth, feedbackRouter)
app.use('/api/anymarket', requireAuth, anymarketRouter)
app.use('/api/knowledge', requireAuth, knowledgeRouter)
app.use('/api/insights', requireAuth, insightsRouter)
app.use('/api/skills', requireAuth, skillsRouter)
app.use('/api/operators', requireAuth, operatorsRouter)

// ── Middleware de erro global ──────────────────────────────────
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
  if (!process.env.SUPABASE_URL) {
    console.warn('[AVISO] SUPABASE_URL não definida no .env — funcionalidades multi-cliente desabilitadas.')
  }
})
