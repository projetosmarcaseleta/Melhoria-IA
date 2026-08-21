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

/** Siglas técnicas e unidades de medida que devem permanecer sempre em MAIÚSCULAS. */
export const UPPERCASE_WORDS = new Set([
  'mm', 'cm', 'm', 'km', 'pol', 'polegadas',
  'ml', 'l', 'lt', 'lts',
  'mg', 'g', 'gr', 'kg', 'ton',
  'w', 'kw', 'v', 'volts', 'va', 'kva', 'hz', 'khz', 'mhz', 'ghz', 'a', 'ma', 'ah', 'mah',
  'gb', 'mb', 'tb', 'kb',
  'fps', 'rpm', 'dpi',
  'gps', 'usb', 'led', 'oled', 'qled', 'amoled', 'lcd', 'rgb', 'hd', 'fhd', 'uhd',
  'ssd', 'ram', 'rom', 'cpu', 'gpu', 'hdmi', 'vga', 'bivolt', 'ip68', 'ip67', 'ip6x',
  '4k', '8k', '5g', '4g', '3d',
])

/** Regex para detectar e converter números com unidades coladas (ex: 46mm -> 46MM, 20w -> 20W, 110v -> 110V) */
const NUMBER_WITH_UNIT_REGEX = /^(\d+(?:[.,]\d+)?)(mm|cm|m|km|ml|l|lt|lts|mg|g|gr|kg|w|kw|v|va|kva|hz|khz|mhz|ghz|a|ma|ah|mah|gb|mb|tb|kb|fps|rpm|dpi|pol|k|g|d)$/i

export function toTitleCase(str) {
  if (!str) return ''

  return str
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase()

      // 1. Preposições minúsculas (se não for a primeira palavra)
      if (index > 0 && LOWERCASE_WORDS.has(lower)) {
        return lower
      }

      // 2. Número acompanhado de unidade de medida (ex: 46mm -> 46MM, 20w -> 20W)
      const numUnitMatch = word.match(NUMBER_WITH_UNIT_REGEX)
      if (numUnitMatch) {
        return `${numUnitMatch[1]}${numUnitMatch[2].toUpperCase()}`
      }

      // 3. Siglas e unidades isoladas em maiúsculas (ex: GPS, USB, LED, MM, CM, KG, W, V)
      if (UPPERCASE_WORDS.has(lower)) {
        return lower.toUpperCase()
      }

      // 4. Se a palavra original já estava toda em maiúsculas e tem 2 a 4 caracteres (sigla não mapeada), preserva
      if (word.length >= 2 && word.length <= 4 && word === word.toUpperCase() && /^[A-Z0-9]+$/.test(word)) {
        return word
      }

      // 5. Capitalização padrão Title Case
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}
