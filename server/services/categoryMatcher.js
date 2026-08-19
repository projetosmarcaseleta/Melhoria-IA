/**
 * Funil de deduplicação de categorias — o coração da feature.
 *
 * Funciona POR NÍVEL do caminho, não pelo caminho inteiro. O caso real dominante é
 * `extend`: "Automotivo > Acessórios" já existe e só "Tapetes" é novo. Tratar toda
 * sugestão como caminho novo é o que gera raízes quase-duplicadas.
 *
 * Estágios (§7 da especificação):
 *   0. chave natural  — `GET /v2/categories?partnerId=` (fica no categoryService,
 *                       porque exige I/O e roda dentro do lock, antes do POST)
 *   1. chave canônica — slugKey ou tokenSetKey idênticos entre IRMÃOS
 *   2. fuzzy          — Levenshtein / Jaccard / containment entre irmãos
 *   3. semântico      — juiz LLM sobre os candidatos da banda ambígua (categoryService)
 *
 * Aqui vivem 1 e 2, mais a varredura global que alimenta o "quase-duplicata" da UI.
 * Tudo puro e sem I/O — é o que permite medir o acerto do funil contra a árvore real
 * sem escrever nada (Fase 2 antes da Fase 4).
 */

import { slugKey, tokenSetKey, tokenSet, normalizeName, pathKey, buildPartnerId, formatDisplayName } from './categoryNormalizer.js'
import { buildIndexes } from './categoryTreeService.js'

export const DEFAULT_THRESHOLDS = {
  fuzzy: 0.88,        // acima disto o funil reusa sozinho
  ambiguousFloor: 0.6, // entre floor e fuzzy: mostra como quase-duplicata / manda ao juiz
  globalHint: 0.72,    // similaridade mínima para sugerir caminho existente em outro galho
}

/** Distância de edição (Levenshtein) com duas linhas — sem dependência externa. */
export function levenshtein(a, b) {
  const s = String(a ?? '')
  const t = String(b ?? '')
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length

  let prev = new Array(t.length + 1)
  let curr = new Array(t.length + 1)
  for (let j = 0; j <= t.length; j++) prev[j] = j

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = curr
    curr = swap
  }

  return prev[t.length]
}

/** Similaridade normalizada 0..1 derivada da distância de edição. */
export function similarityRatio(a, b) {
  const s = String(a ?? '')
  const t = String(b ?? '')
  const longest = Math.max(s.length, t.length)
  if (longest === 0) return 1
  return 1 - levenshtein(s, t) / longest
}

/** Interseção sobre união dos tokens canônicos. */
export function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1
  if (!setA.size || !setB.size) return 0

  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++

  return intersection / (setA.size + setB.size - intersection)
}

/**
 * Interseção sobre o MENOR conjunto — pega o caso "Automotivo, Carros" ⊃ "Automotivo",
 * em que um nome contém inteiramente o outro e o Jaccard fica baixo por diferença de tamanho.
 */
export function containment(setA, setB) {
  if (!setA.size || !setB.size) return 0

  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++

  return intersection / Math.min(setA.size, setB.size)
}

/**
 * Melhor score entre as três métricas, com o rótulo de qual venceu.
 * Usado para EXIBIR semelhança (quase-duplicata, varredura global).
 */
export function scoreNames(nameA, nameB) {
  const canonA = normalizeName(nameA)
  const canonB = normalizeName(nameB)
  const setA = tokenSet(nameA)
  const setB = tokenSet(nameB)

  const metrics = [
    { metric: 'levenshtein', score: similarityRatio(canonA, canonB) },
    { metric: 'jaccard', score: jaccard(setA, setB) },
    { metric: 'containment', score: containment(setA, setB) },
  ]

  return metrics.reduce((best, current) => (current.score > best.score ? current : best))
}

/**
 * Score que pode DECIDIR reuso automático — deliberadamente sem containment.
 *
 * Containment dá 1.0 sempre que os tokens de um nome cabem dentro do outro, e isso
 * fundiria categorias legitimamente distintas: "Panelas" ⊂ "Panelas de Pressão",
 * "Cabos" ⊂ "Cabos HDMI". Reuso errado manda o produto para a categoria errada em
 * silêncio; por isso containment fica como HINT (banda ambígua, varredura global),
 * onde o operador vê e decide, e o reuso automático exige semelhança de forma
 * (Levenshtein) ou de conjunto (Jaccard).
 *
 * O caso "Automotivo, Carros" ⊃ "Automotivo" — motivação original do containment —
 * já é resolvido antes daqui pelo splitCompositeName, que divide em dois níveis.
 */
export function scoreForReuse(nameA, nameB) {
  const canonA = normalizeName(nameA)
  const canonB = normalizeName(nameB)

  const metrics = [
    { metric: 'levenshtein', score: similarityRatio(canonA, canonB) },
    { metric: 'jaccard', score: jaccard(tokenSet(nameA), tokenSet(nameB)) },
  ]

  return metrics.reduce((best, current) => (current.score > best.score ? current : best))
}

/**
 * Resolve UM nível: o nome proposto já existe entre os irmãos deste pai?
 *
 * @returns {{decision: 'reuse'|'create', node?: object, matchStage: string, matchScore: number, candidates: Array}}
 */
export function matchLevel({ name, parentId = null, nodes, indexes, thresholds = DEFAULT_THRESHOLDS }) {
  const idx = indexes ?? buildIndexes(nodes)
  const siblings = parentId ? (idx.childrenOf.get(String(parentId)) ?? []) : idx.roots

  // ── Estágio 1: chave canônica exata ────────────────────────────────
  const slug = slugKey(name)
  const tokens = tokenSetKey(name)

  const exact =
    siblings.find((sibling) => slug && sibling.slugKey === slug) ??
    siblings.find((sibling) => tokens && sibling.tokenSetKey === tokens)

  if (exact) {
    return {
      decision: 'reuse',
      node: exact,
      matchStage: 'exact_key',
      matchScore: 1,
      candidates: [],
    }
  }

  // ── Estágio 2: fuzzy entre irmãos ──────────────────────────────────
  // `reuseScore` decide; `score` (com containment) é o que a UI mostra. Separar os
  // dois é o que impede "Panelas" de ser fundido com "Panelas de Pressão".
  const scored = siblings
    .map((sibling) => {
      const display = scoreNames(name, sibling.name)
      const reuse = scoreForReuse(name, sibling.name)
      return { node: sibling, metric: display.metric, score: display.score, reuseScore: reuse.score, reuseMetric: reuse.metric }
    })
    .sort((a, b) => b.reuseScore - a.reuseScore || b.score - a.score)

  const best = scored[0]
  if (best && best.reuseScore >= thresholds.fuzzy) {
    return {
      decision: 'reuse',
      node: best.node,
      matchStage: 'fuzzy',
      matchScore: Number(best.reuseScore.toFixed(4)),
      candidates: scored.slice(1, 4).filter((c) => c.score >= thresholds.ambiguousFloor).map(describeCandidate),
    }
  }

  return {
    decision: 'create',
    matchStage: 'none',
    matchScore: best ? Number(best.reuseScore.toFixed(4)) : 0,
    // Banda ambígua: não reusa sozinho, mas o operador precisa ver antes de aprovar.
    candidates: scored.filter((c) => c.score >= thresholds.ambiguousFloor).slice(0, 5).map(describeCandidate),
  }
}

function describeCandidate({ node, metric, score }) {
  return {
    anymarketId: node.anymarketId,
    name: node.name,
    fullPath: node.fullPath,
    metric,
    score: Number(score.toFixed(4)),
  }
}

/**
 * Varredura global: existe em OUTRO galho da árvore algo parecido com o nome da folha?
 *
 * É o aviso mais útil da UI ("você vai criar Automotivo > Acessórios > Tapetes, mas
 * Automotivo > Tapetes e Carpetes já existe"). Não decide nada sozinho — a decisão
 * fica com o operador ou com o juiz do estágio 3.
 */
export function findGlobalSimilar({ name, nodes, excludeIds = [], thresholds = DEFAULT_THRESHOLDS, limit = 5 }) {
  const excluded = new Set(excludeIds.map(String))

  return nodes
    .filter((node) => !excluded.has(node.anymarketId))
    .map((node) => {
      const { metric, score } = scoreNames(name, node.name)
      return { node, metric, score }
    })
    .filter((candidate) => candidate.score >= thresholds.globalHint)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(describeCandidate)
}

/**
 * Percorre o caminho inteiro nível a nível.
 *
 * Regra estrutural: assim que um nível precisa ser criado, todos os níveis abaixo
 * também precisam — não existe reuso de filho de pai inexistente.
 *
 * @param {{path: string[], nodes: Array, thresholds?: object, partnerIdPrefix?: string, maxDepth?: number}} params
 */
export function matchPath({ path, nodes, thresholds = DEFAULT_THRESHOLDS, partnerIdPrefix = 'CRIA', maxDepth = null }) {
  const indexes = buildIndexes(nodes)
  const levels = (maxDepth ? path.slice(0, maxDepth) : path).map((name) => formatDisplayName(name)).filter(Boolean)

  const reusedPrefix = []
  const missingTail = []
  const rejectedCandidates = []
  const redundantLevels = []

  let parentId = null
  let forcedCreate = false
  let createsNewRoot = false

  // Nomes já resolvidos no caminho = a cadeia de ancestrais deste nível.
  const ancestorKeys = new Map()

  levels.forEach((name, depth) => {
    // Nível que repete um ancestral não é subcategoria, é repetição: "CAMERAS >
    // Câmeras" (as duas viram `camera` na chave canônica) é o LLM reafirmando o pai.
    // Sem esta regra o funil criava filho idêntico ao próprio pai — o estágio 1 não
    // pegava porque ele compara só IRMÃOS, e o nome não estava entre os irmãos.
    const chave = slugKey(name)
    const tokens = tokenSetKey(name)
    const ancestralIgual = ancestorKeys.get(chave) ?? ancestorKeys.get(tokens)

    if (ancestralIgual) {
      redundantLevels.push({ depth, name, sameAs: ancestralIgual })
      return
    }

    if (forcedCreate) {
      ancestorKeys.set(chave, name)
      ancestorKeys.set(tokens, name)
      missingTail.push(buildTailNode({ name, depth, levels, partnerIdPrefix }))
      return
    }

    const result = matchLevel({ name, parentId, nodes, indexes, thresholds })
    result.candidates.forEach((candidate) => rejectedCandidates.push({ ...candidate, depth, proposedName: name }))

    if (result.decision === 'reuse') {
      // A chave do ancestral é a do nó REAL reusado, não a do nome proposto: é o nome
      // real que os níveis seguintes não podem repetir.
      ancestorKeys.set(slugKey(result.node.name), result.node.name)
      ancestorKeys.set(tokenSetKey(result.node.name), result.node.name)

      reusedPrefix.push({
        anymarketId: result.node.anymarketId,
        name: result.node.name,
        fullPath: result.node.fullPath,
        matchStage: result.matchStage,
        matchScore: result.matchScore,
        proposedName: name,
      })
      parentId = result.node.anymarketId
      return
    }

    forcedCreate = true
    if (depth === 0) createsNewRoot = true
    ancestorKeys.set(chave, name)
    ancestorKeys.set(tokens, name)
    missingTail.push(buildTailNode({ name, depth, levels, partnerIdPrefix }))
  })

  const leafName = levels[levels.length - 1]
  const globalSimilar = missingTail.length
    ? findGlobalSimilar({
        name: leafName,
        nodes,
        excludeIds: reusedPrefix.map((n) => n.anymarketId),
        thresholds,
      })
    : []

  const resolvedPath = [...reusedPrefix.map((n) => n.name), ...missingTail.map((n) => n.name)]

  return {
    resolvedPath,
    reusedPrefix,
    missingTail,
    rejectedCandidates,
    globalSimilar,
    redundantLevels,
    createsNewRoot,
    pathKey: pathKey(resolvedPath),
    leafCategoryId: missingTail.length === 0 ? (reusedPrefix[reusedPrefix.length - 1]?.anymarketId ?? null) : null,
    fullyExisting: missingTail.length === 0,
  }
}

function buildTailNode({ name, depth, levels, partnerIdPrefix }) {
  const pathUpToHere = levels.slice(0, depth + 1)

  return {
    name,
    depth,
    partnerId: buildPartnerId(pathUpToHere, partnerIdPrefix),
    pathKey: pathKey(pathUpToHere),
  }
}
