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
import categoriesRouter from './routes/categories.js'
import operatorsRouter from './routes/operators.js'
import diagnosticsRouter from './routes/diagnostics.js'

// Middleware
import { requireAuth } from './middleware/auth.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── Rotas públicas ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Normalizar prefixo /edit/api para /api caso o frontend chame com o subpath de produção
app.use((req, _res, next) => {
  if (req.url.startsWith('/edit/api')) {
    req.url = req.url.replace(/^\/edit\/api/, '/api')
  }
  next()
})

// Servir arquivos estáticos do frontend (dist) para produção
const distPath = path.join(__dirname, '../dist')
app.use('/edit', express.static(distPath))
app.use(express.static(distPath))

// ── Rotas protegidas (requerem autenticação) ───────────────────
app.use('/api/clients', requireAuth, clientsRouter)
app.use('/api/generate', requireAuth, generateRouter)
app.use('/api/prompts', requireAuth, promptsRouter)
app.use('/api/feedback', requireAuth, feedbackRouter)
app.use('/api/anymarket', requireAuth, anymarketRouter)
app.use('/api/knowledge', requireAuth, knowledgeRouter)
app.use('/api/insights', requireAuth, insightsRouter)
app.use('/api/skills', requireAuth, skillsRouter)
app.use('/api/categories', requireAuth, categoriesRouter)
app.use('/api/operators', requireAuth, operatorsRouter)
app.use('/api/diagnostics', requireAuth, diagnosticsRouter)

// Catch-all para SPA Frontend (qualquer rota que não seja /api)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/edit/api') || req.path.startsWith('/health')) {
    return next()
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next()
  })
})

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
})
