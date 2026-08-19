/**
 * Normalizador de nomes de categoria — funções PURAS, sem I/O.
 *
 * É aqui que "Automotivo" / "AUTOMOTIVO" / "automotívos" colapsam na mesma chave,
 * ANTES de qualquer comparação. O funil de dedup (categoryMatcher) compara chaves,
 * nunca os nomes crus.
 *
 * Duas chaves por nome, de propósito:
 *   - slugKey     → ordem preservada  ("acessorio-automotivo")
 *   - tokenSetKey → tokens ordenados  (mesma chave para "Automotivos Acessórios")
 * A segunda pega inversão de palavras, que a primeira não pega.
 *
 * Ver docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md §6.
 */

import { toTitleCase } from '../utils/textCase.js'

/** Limite da API do AnyMarket para `name` e `partnerId` de categoria. */
export const MAX_NAME_LENGTH = 80

/** Preposições/artigos descartados na chave canônica (não no nome de exibição). */
const STOPWORDS = new Set([
  'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas',
  'com', 'para', 'por', 'sem',
  'e', 'ou', 'a', 'o', 'as', 'os', 'um', 'uma',
])

/**
 * Nomes genéricos que não organizam catálogo nenhum. Recusados na criação —
 * se já existem na árvore do cliente continuam sendo reusados (§8.1: vício
 * existente é reusado, nunca aprendido).
 */
export const GENERIC_NAMES = new Set([
  'outros', 'outro', 'diverso', 'geral', 'sem categoria', 'categoria', 'teste',
  'nao definido', 'indefinido', 'default', 'padrao', 'produto', 'item',
])

/** Separadores que indicam hierarquia ou dois conceitos — nunca nome de um nó só. */
const COMPOSITE_SEPARATORS = /\s*(?:,|;|\||\/|>|»|->|→|\s-\s)\s*/

export function stripDiacritics(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Radical heurístico pt-BR — o objetivo é que singular e plural caiam na MESMA
 * chave, não passar em prova de gramática.
 *
 * Por que termina cortando o 'e' final: em português o plural de palavra
 * terminada em consoante r/z é +es (cor → cores) e o de terminada em vogal+e é
 * +s (tapete → tapetes). Pela forma da palavra as duas são indistinguíveis, então
 * qualquer regra que trate "-es" como sufixo único quebra um dos dois casos —
 * era o bug que fazia `Tapetes` (→ tapet) e `Tapete` (→ tapete) NÃO colidirem.
 * Cortar 's' e depois 'e' colapsa os dois lados de forma consistente:
 *   tapetes → tapete → tapet   |   tapete → tapet    ✔ colidem
 *   cores   → core   → cor     |   cor    → cor      ✔ colidem
 *
 * O radical fica mais curto que a palavra real, e isso é aceitável: colisão a
 * mais gera candidato a REUSO (que o operador vê no "de → para" e pode recusar);
 * colisão a menos gera DUPLICATA — o problema que a feature existe para evitar.
 */
export function singularize(token) {
  if (token.length <= 3) return token

  if (token.endsWith('oes') || token.endsWith('aes')) return `${token.slice(0, -3)}ao` // televisoes → televisao
  if (token.endsWith('ns')) return `${token.slice(0, -2)}m`                            // homens → homem
  if (token.endsWith('is') && token.length > 4) return `${token.slice(0, -2)}l`        // automoveis → automovel

  let stem = token.endsWith('s') ? token.slice(0, -1) : token
  if (stem.length > 3 && stem.endsWith('e')) stem = stem.slice(0, -1)

  return stem
}

/** Forma canônica: sem acento, minúscula, sem pontuação, sem stopword, singular. */
export function normalizeName(raw) {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token))
    .map(singularize)
    .join(' ')
    .trim()
}

/** Chave canônica com a ordem das palavras preservada. */
export function slugKey(raw) {
  const normalized = normalizeName(raw)
  return normalized ? normalized.replace(/\s+/g, '-') : ''
}

/** Chave canônica insensível à ordem — pega "Automotivos Acessórios" ≡ "Acessórios Automotivos". */
export function tokenSetKey(raw) {
  const normalized = normalizeName(raw)
  if (!normalized) return ''
  return normalized.split(' ').sort().join('-')
}

/** Conjunto de tokens canônicos, para Jaccard/containment no matcher (estágio 2). */
export function tokenSet(raw) {
  const normalized = normalizeName(raw)
  return new Set(normalized ? normalized.split(' ') : [])
}

/** Chave do caminho completo: ['Automotivo','Acessórios'] → 'automotivo/acessorio'. */
export function pathKey(path) {
  const names = Array.isArray(path) ? path : [path]
  return names.map(slugKey).filter(Boolean).join('/')
}

/**
 * Divide nome composto em níveis de hierarquia.
 *
 * "Automotivo, Carros"        → ['Automotivo', 'Carros']   (vírgula = dois conceitos)
 * "Casa > Cozinha > Panelas"  → 3 níveis
 * "Tapetes e Carpetes"        → ['Tapetes e Carpetes']     ('e' NÃO divide: nome legítimo)
 */
export function splitCompositeName(raw) {
  return String(raw ?? '')
    .split(COMPOSITE_SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Normaliza um caminho cru (string ou array) em array de níveis já divididos. */
export function normalizePath(rawPath) {
  const parts = Array.isArray(rawPath) ? rawPath : [rawPath]
  return parts.flatMap((part) => splitCompositeName(part))
}

/** Corta em `max` caracteres sem quebrar palavra ao meio. */
export function truncateAtWord(text, max = MAX_NAME_LENGTH) {
  const clean = String(text ?? '').trim()
  if (clean.length <= max) return clean

  const cut = clean.slice(0, max)

  // Corte caiu exatamente no fim de uma palavra — não há nada de quebrado a consertar.
  // Sem esta guarda, "abc def ghi" em 7 devolvia "abc", perdendo uma palavra inteira à toa.
  if (clean[max] === ' ') return cut.trim()

  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()
}

/** Nome de exibição de nó novo: Title Case pt-BR, espaços colapsados, sem pontuação terminal. */
export function formatDisplayName(raw) {
  const clean = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim()

  return truncateAtWord(toTitleCase(clean), MAX_NAME_LENGTH)
}

/**
 * `partnerId` estável derivado do caminho — é a chave natural que o estágio 0 do
 * funil consulta na própria API (`GET /v2/categories?partnerId=`) antes de criar.
 * Se estourar 80 chars, corta e acrescenta hash curto para não colidir.
 */
export function buildPartnerId(path, prefix = 'CRIA') {
  // A barra do pathKey não pode sobreviver aqui: o partnerId viaja em query string
  // (`GET /v2/categories?partnerId=`) e como identificador do parceiro no hub.
  const key = pathKey(path).replace(/\//g, '-')
  const full = `${prefix}-${key}`
  if (full.length <= MAX_NAME_LENGTH) return full

  const hash = shortHash(key)
  const room = MAX_NAME_LENGTH - prefix.length - hash.length - 2 // dois hífens
  return `${prefix}-${key.slice(0, Math.max(1, room))}-${hash}`
}

/** Hash determinístico curto (FNV-1a em base36). Sem dependência externa. */
export function shortHash(text) {
  let hash = 0x811c9dc5
  const str = String(text ?? '')
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).slice(0, 6)
}

const MEASURE_PATTERN = /\b\d+([.,]\d+)?\s*(mm|cm|kg|ml|pol|polegadas?|r\d{2}|[wvlgm])\b/i
const TIRE_SIZE_PATTERN = /\b\d{2,3}\s*\/\s*\d{2,3}\b/ // 205/55

/**
 * Valida um nome candidato a nó NOVO contra o padrão de marketplace.
 *
 * Regras duras e fixas, deliberadamente NÃO derivadas do perfil da árvore do
 * cliente (§8.1): a árvore ensina forma e vocabulário, este validador dita
 * qualidade. Herdar `AUTOMOTIVO` como convenção seria propagar vício.
 *
 * @param {string} raw
 * @param {{ brands?: string[] }} [options] Marcas do cliente, quando disponíveis.
 * @returns {{ valid: boolean, name: string, violations: Array<{code: string, message: string}> }}
 */
export function validateNodeName(raw, options = {}) {
  const violations = []
  const original = String(raw ?? '').trim()
  const name = formatDisplayName(original)
  const canonical = normalizeName(original)

  const add = (code, message) => violations.push({ code, message })

  if (!original) add('empty', 'Nome vazio.')
  if (original && !canonical) add('no_content', 'Nome sem conteúdo aproveitável após normalização.')

  if (original.length > MAX_NAME_LENGTH) {
    add('too_long', `Nome tem ${original.length} caracteres; o limite da API é ${MAX_NAME_LENGTH}. Truncado para "${name}".`)
  }

  if (splitCompositeName(original).length > 1) {
    add('composite', 'Nome contém separador de hierarquia (vírgula, barra, ">") — deve ser dividido em níveis.')
  }

  if (/\p{Extended_Pictographic}/u.test(original)) add('emoji', 'Nome contém emoji.')
  if (/<[^>]+>/.test(original)) add('html', 'Nome contém marcação HTML.')
  if (canonical && /^[0-9\s]+$/.test(canonical)) add('numeric_only', 'Nome puramente numérico não identifica categoria.')

  if (MEASURE_PATTERN.test(original) || TIRE_SIZE_PATTERN.test(original)) {
    add('measure', 'Nome contém medida/dimensão — isso é atributo de SKU, não categoria.')
  }

  if (GENERIC_NAMES.has(canonical)) add('generic', `"${name}" é genérico e não organiza catálogo.`)

  const brands = Array.isArray(options.brands) ? options.brands : []
  const brandHit = brands.find((brand) => {
    const brandKey = normalizeName(brand)
    return brandKey && brandKey === canonical
  })
  if (brandHit) add('brand', `"${name}" é marca (${brandHit}) — marca vai em brand.id, não em categoria.`)

  return { valid: violations.length === 0, name, violations }
}
