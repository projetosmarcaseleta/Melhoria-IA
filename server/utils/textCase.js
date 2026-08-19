/**
 * Utilitários de caixa de texto compartilhados.
 *
 * `toTitleCase` nasceu em routes/generate.js (formatação do título gerado) e foi
 * extraído para cá quando o normalizador de categorias passou a precisar da mesma
 * regra — nome de categoria novo sai em Title Case pt-BR. Duplicar a lista de
 * preposições em dois lugares seria garantia de divergência.
 *
 * routes/generate.js re-exporta este símbolo para não quebrar imports existentes.
 */

/** Preposições e artigos que permanecem minúsculos quando não são a primeira palavra. */
export const LOWERCASE_WORDS = new Set([
  'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas',
  'com', 'para', 'por',
  'e', 'ou',
  'a', 'o', 'as', 'os',
])

export function toTitleCase(str) {
  if (!str) return ''

  return str
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index > 0 && LOWERCASE_WORDS.has(lower)) {
        return lower
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}
