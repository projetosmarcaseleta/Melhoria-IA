import './env.js'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const hasLangfuseConfig = Boolean(
  process.env.LANGFUSE_SECRET_KEY &&
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_BASE_URL,
)

const redactSecrets = ({ data }) => {
  if (typeof data !== 'string') return data

  return data
    .replace(/sk-(?:proj-|lf-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED_SECRET_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]')
}

export const langfuseSpanProcessor = hasLangfuseConfig
  ? new LangfuseSpanProcessor({
      mask: redactSecrets,
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || process.env.NODE_ENV || 'development',
    })
  : null

export const telemetrySdk = langfuseSpanProcessor
  ? new NodeSDK({ spanProcessors: [langfuseSpanProcessor] })
  : null

telemetrySdk?.start()

if (!hasLangfuseConfig) {
  console.warn('[Langfuse] Configuração incompleta — rastreamento desabilitado.')
}
