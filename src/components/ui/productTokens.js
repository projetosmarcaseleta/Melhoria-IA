/**
 * Fonte única dos tokens visuais e das regras de domínio do produto.
 *
 * Antes deste arquivo, `TYPE_BADGE` e `STATUS_LABEL` existiam em cópias
 * independentes em ProductTable.jsx, ReviewPanel.jsx e KnowledgeManager.jsx —
 * qualquer ajuste visual precisava ser repetido em cada cópia (e as cópias já
 * tinham divergido: o ReviewPanel não tinha o status `idle`/`undone`).
 */

// ── Tipo de produto ────────────────────────────────────────────────
export const TYPE_BADGE = {
  SIMPLE:        { text: 'Simples',    color: '#22d3ee', bg: 'rgba(34,211,238,0.12)',  border: 'rgba(34,211,238,0.3)' },
  KIT:           { text: 'Kit',        color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)' },
  VARIATION:     { text: 'Variação',   color: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.3)' },
  KIT_VARIATION: { text: 'Kit c/ Var.', color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.3)' },
}

export function typeBadgeOf(product) {
  return TYPE_BADGE[(product?.productType ?? 'SIMPLE').toUpperCase()] ?? TYPE_BADGE.SIMPLE
}

// ── Status do produto no fluxo ─────────────────────────────────────
export const STATUS = {
  idle:       { text: 'Aguardando',   tone: 'neutral', icon: 'clock' },
  processing: { text: 'Processando',  tone: 'info',    icon: 'sparkles' },
  processed:  { text: 'Pronto',       tone: 'warning', icon: 'checkCircle' },
  applying:   { text: 'Publicando',   tone: 'info',    icon: 'send' },
  applied:    { text: 'Publicado',    tone: 'success', icon: 'check' },
  undone:     { text: 'Desfeito',     tone: 'neutral', icon: 'refresh' },
  error:      { text: 'Erro',         tone: 'danger',  icon: 'alert' },
}

export const TONE = {
  neutral: { color: '#cbd5e1', bg: 'rgba(255,255,255,0.06)',   border: 'rgba(255,255,255,0.12)' },
  info:    { color: '#8aa8ff', bg: 'rgba(51,108,255,0.14)',    border: 'rgba(51,108,255,0.32)' },
  success: { color: '#34d399', bg: 'rgba(16,185,129,0.14)',    border: 'rgba(16,185,129,0.32)' },
  warning: { color: '#fbbf24', bg: 'rgba(245,158,11,0.14)',    border: 'rgba(245,158,11,0.32)' },
  danger:  { color: '#f87171', bg: 'rgba(244,63,94,0.14)',     border: 'rgba(244,63,94,0.32)' },
}

export function statusOf(product) {
  return STATUS[product?.status] ?? STATUS.idle
}

export function toneStyle(tone) {
  const t = TONE[tone] ?? TONE.neutral
  return { color: t.color, background: t.bg, border: `1px solid ${t.border}` }
}

// ── Regra de publicação ────────────────────────────────────────────
/**
 * Retorna true se o produto pode receber PATCH.
 * Regra: SIMPLE = sempre pode. KIT/VARIATION/KIT_VARIATION = só se
 * priceCalculation === 'NONE'.
 */
export function canPatchProduct(product) {
  const type = (product?.productType ?? 'SIMPLE').toUpperCase()
  if (type === 'SIMPLE') return true
  const calc = (product?.priceCalculation ?? '').toString().trim().toUpperCase()
  return calc === 'NONE'
}

/** Motivo legível do bloqueio — antes só existia dentro de um `title` de tooltip. */
export function blockReason(product) {
  if (canPatchProduct(product)) return null
  const tipo = typeBadgeOf(product).text
  const calc = product?.priceCalculation || 'não informado'
  return `${tipo} com cálculo de preço "${calc}" — a API da AnyMarket não aceita alteração`
}

// ── Limite de caracteres do título ─────────────────────────────────
export const TITLE_MAX = 60

/**
 * Cor do medidor de caracteres do título.
 *
 * A regra anterior pintava de âmbar tudo entre 70% e 100% do limite, então um
 * título de 59/60 — que é o melhor resultado possível — aparecia como aviso.
 * Em marketplace, título mais longo aproveita mais espaço de busca: o alerta
 * real é *estourar* o limite (corta no anúncio) ou ficar curto demais.
 */
export function titleMeter(len, max = TITLE_MAX) {
  if (len > max)        return { tone: 'danger',  color: TONE.danger.color,  hint: `${len - max} caractere(s) além do limite — vai ser cortado` }
  if (len === 0)        return { tone: 'neutral', color: TONE.neutral.color, hint: 'Sem título gerado' }
  if (len < max * 0.5)  return { tone: 'warning', color: TONE.warning.color, hint: 'Curto — sobra espaço de busca sem usar' }
  return { tone: 'success', color: TONE.success.color, hint: 'Bom aproveitamento do limite' }
}

export function titleMeterPct(len, max = TITLE_MAX) {
  return Math.min((len / max) * 100, 100)
}
