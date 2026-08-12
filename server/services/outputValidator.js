/**
 * Servidor de Validação, Sanitização e Aplicação Determinística de Conteúdo.
 *
 * Garante que:
 * 1. Cercas Markdown (```html ou ```) sejam 100% removidas.
 * 2. Blocos de texto fixo aprovados (ex: texto institucional) sejam aplicados deterministicamente no backend.
 * 3. Validações de proibições, tamanho e tags HTML sejam verificadas.
 */

/**
 * Sanitiza a saída do LLM removendo blocos de código markdown e espaços excessivos.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeLLMOutput(text) {
  if (!text || typeof text !== 'string') return ''

  let sanitized = text.trim()

  // Remover cercas markdown ```html ... ``` ou ``` ... ```
  sanitized = sanitized.replace(/^```[a-zA-Z]*\r?\n?/gm, '')
  sanitized = sanitized.replace(/\r?\n?```$/gm, '')
  sanitized = sanitized.replace(/```/g, '')

  return sanitized.trim()
}

/**
 * Aplica regras determinísticas (ex: prepend_exactly de blocos fixos) no texto sanitizado.
 *
 * @param {string} text - Texto gerado e sanitizado
 * @param {Array<object>} rules - Regras aprovadas do cliente (knowledge_rules)
 * @param {string} scope - 'titulo' ou 'descricao'
 * @returns {{ finalOutput: string, deterministicRulesApplied: string[] }}
 */
export function applyDeterministicRules(text, rules = [], scope = 'descricao') {
  let output = text
  const appliedRules = []

  if (!Array.isArray(rules) || rules.length === 0) {
    return { finalOutput: output, deterministicRulesApplied: appliedRules }
  }

  // Filtrar regras determinísticas aplicáveis ao escopo
  const applicableRules = rules.filter(
    (r) =>
      r.status === 'approved' &&
      (r.scopes?.includes(scope) || r.scopes?.includes('ambos')) &&
      ['prepend_exactly', 'append_exactly'].includes(r.application)
  )

  // Separar prepends e appends ordenados por prioridade (critical > high > normal)
  const priorityOrder = { critical: 1, high: 2, normal: 3, reference: 4 }
  applicableRules.sort((a, b) => (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99))

  for (const rule of applicableRules) {
    if (!rule.content) continue

    const contentToInject = rule.content.trim()

    if (rule.application === 'prepend_exactly') {
      // Evitar duplicação se o LLM já tiver tentado colocar o texto
      if (!output.startsWith(contentToInject)) {
        output = `${contentToInject}\n${output}`
      }
      appliedRules.push(rule.id || rule.name)
    } else if (rule.application === 'append_exactly') {
      if (!output.endsWith(contentToInject)) {
        output = `${output}\n${contentToInject}`
      }
      appliedRules.push(rule.id || rule.name)
    }
  }

  return { finalOutput: output, deterministicRulesApplied: appliedRules }
}

/**
 * Limites de caracteres por escopo. Espelham o contrato dos prompts padrão
 * (título: 60 / descrição: 2000) e o contador exibido no ReviewPanel.
 */
export const SCOPE_MAX_LENGTH = {
  titulo: 60,
  descricao: 2000,
}

/**
 * Conta ocorrências de `needle` em `haystack` (comparação literal).
 */
function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    count++
    from = idx + needle.length
  }
  return count
}

/**
 * Valida o resultado final contra proibições e limites.
 *
 * @param {string} text
 * @param {Array<object>} rules
 * @param {string} scope
 * @param {object} [options]
 * @param {number} [options.maxLength] - Sobrescreve o limite padrão do escopo
 * @returns {{ valid: boolean, violations: Array<{ ruleId?: string, code: string, severity: string, message: string }> }}
 */
export function validateOutput(text, rules = [], scope = 'descricao', options = {}) {
  const violations = []

  // 1. Checagem contra markdown residual
  if (text.includes('```')) {
    violations.push({
      code: 'MARKDOWN_FENCE_PRESENT',
      severity: 'error',
      message: 'O texto contém marcadores de código Markdown (```).',
    })
  }

  // 2. Checagem de proibições das regras
  const prohibitionRules = rules.filter(
    (r) =>
      r.status === 'approved' &&
      (r.scopes?.includes(scope) || r.scopes?.includes('ambos')) &&
      r.type === 'prohibition'
  )

  for (const rule of prohibitionRules) {
    if (!rule.content) continue

    // Termos proibidos separados por vírgula ou no conteúdo
    const terms = rule.content.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    const textLower = text.toLowerCase()

    for (const term of terms) {
      if (term && textLower.includes(term)) {
        violations.push({
          ruleId: rule.id,
          code: 'PROHIBITED_TERM',
          severity: 'error',
          message: `Termo proibido em uso: "${term}" (regra: ${rule.name || rule.id})`,
        })
      }
    }
  }

  // 3. Limite de caracteres do escopo
  const maxLength = options.maxLength ?? SCOPE_MAX_LENGTH[scope]
  if (maxLength && text.length > maxLength) {
    violations.push({
      code: 'MAX_LENGTH_EXCEEDED',
      severity: 'warning',
      message: `Passou do limite de ${maxLength} caracteres (está com ${text.length}).`,
    })
  }

  // 4. Bloco institucional duplicado.
  // applyDeterministicRules injeta o texto fixo quando não encontra o bloco no
  // início/fim exato do texto. Se o LLM já tiver reproduzido o bloco literalmente
  // em outra posição, o resultado sai com o bloco duas vezes — é isso que
  // detectamos aqui.
  const fixedTextRules = rules.filter(
    (r) =>
      r.status === 'approved' &&
      (r.scopes?.includes(scope) || r.scopes?.includes('ambos')) &&
      ['prepend_exactly', 'append_exactly'].includes(r.application) &&
      r.content
  )

  for (const rule of fixedTextRules) {
    // Trecho distintivo do bloco (o início costuma ser único o suficiente)
    const marker = rule.content.trim().slice(0, 60)
    if (marker.length < 12) continue // curto demais para ser um marcador confiável

    if (countOccurrences(text, marker) > 1) {
      violations.push({
        ruleId: rule.id,
        code: 'FIXED_TEXT_DUPLICATED',
        severity: 'warning',
        message: `O bloco fixo "${rule.name || rule.id}" aparece mais de uma vez no texto.`,
      })
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}
