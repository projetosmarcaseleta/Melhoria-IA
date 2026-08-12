/**
 * Helpers para ler o resultado de validação que o backend devolve junto de cada
 * geração (`titleValidation` / `descValidation` em cada produto do store).
 */

/**
 * Reúne todas as violações de um produto, marcando de qual campo veio cada uma.
 * @returns {Array<{ field: 'titulo' | 'descricao', code: string, severity: string, message: string }>}
 */
export function collectViolations(product) {
  if (!product) return []

  const out = []

  for (const [field, validation] of [
    ['titulo', product.titleValidation],
    ['descricao', product.descValidation],
  ]) {
    if (!validation?.violations?.length) continue
    for (const v of validation.violations) {
      out.push({ field, severity: v.severity ?? 'warning', ...v })
    }
  }

  return out
}

/** true se o produto tem qualquer violação registrada. */
export function hasViolations(product) {
  return collectViolations(product).length > 0
}

/** Quantos produtos da lista precisam de atenção. */
export function countProductsNeedingAttention(products) {
  return products.filter(hasViolations).length
}
