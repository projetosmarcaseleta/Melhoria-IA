/**
 * Perfil da árvore de categorias do cliente (decisão D3, §8.1).
 *
 * O classificador não ancora numa taxonomia genérica nem na de um marketplace
 * específico: ancora na árvore que o cliente JÁ tem. Este módulo extrai desse
 * espelho — sem custo de LLM — os sinais que entram no prompt.
 *
 * Princípio que separa o que é aprendido do que é imposto:
 *   a árvore ensina FORMA e VOCABULÁRIO; o validateNodeName dita QUALIDADE.
 * Se a árvore tem `AUTOMOTIVO` em caixa alta, o funil reusa aquele nó (dedup vence
 * estética) mas nó novo sai em Title Case. Vício existente é tolerado onde está,
 * nunca promovido a convenção.
 */

import { normalizeName, GENERIC_NAMES } from './categoryNormalizer.js'

const STOPWORDS_VOCAB = new Set(['e', 'de', 'da', 'do', 'para', 'com', 'em'])

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const index = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length))
  return sortedValues[index]
}

/** Termos mais recorrentes num conjunto de nomes. */
function topTerms(names, limit = 12) {
  const counts = new Map()

  for (const name of names) {
    for (const token of normalizeName(name).split(' ')) {
      if (!token || STOPWORDS_VOCAB.has(token) || token.length < 3) continue
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

/**
 * @param {Array<object>} nodes Árvore já montada por categoryTreeService.buildTree
 * @returns {object} perfil consumido pelo prompt do classificador
 */
export function profileTree(nodes = []) {
  const roots = nodes.filter((node) => !node.parentId)
  const depths = nodes.map((node) => node.depth ?? 0).sort((a, b) => a - b)
  const leaves = nodes.filter((node) => !node.hasChildren)

  const upperCaseCount = nodes.filter((node) => node.name === node.name.toUpperCase() && /[A-Z]{2,}/.test(node.name)).length
  const pluralCount = nodes.filter((node) => /s\s*$/i.test(node.name)).length
  const genericPresent = nodes.filter((node) => GENERIC_NAMES.has(normalizeName(node.name)))

  const byDepth = new Map()
  for (const node of nodes) {
    const depth = node.depth ?? 0
    if (!byDepth.has(depth)) byDepth.set(depth, [])
    byDepth.get(depth).push(node.name)
  }

  const vocabularyByDepth = {}
  for (const [depth, names] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    vocabularyByDepth[depth] = topTerms(names)
  }

  return {
    nodeCount: nodes.length,
    rootCount: roots.length,
    rootNames: roots.map((node) => node.name).sort((a, b) => a.localeCompare(b)),
    depthMax: depths.length ? depths[depths.length - 1] : 0,
    depthP50: percentile(depths, 50),
    depthP95: percentile(depths, 95),
    // Profundidade típica das FOLHAS é o sinal que interessa para calibrar maxDepth:
    // é onde o produto é pendurado, não onde a árvore por acaso termina.
    leafDepthP50: percentile(leaves.map((n) => n.depth ?? 0).sort((a, b) => a - b), 50),
    leafDepthMax: leaves.reduce((max, n) => Math.max(max, n.depth ?? 0), 0),
    avgChildren: roots.length ? Number(((nodes.length - roots.length) / Math.max(1, nodes.length - leaves.length)).toFixed(2)) : 0,
    upperCaseRatio: nodes.length ? Number((upperCaseCount / nodes.length).toFixed(3)) : 0,
    pluralRatio: nodes.length ? Number((pluralCount / nodes.length).toFixed(3)) : 0,
    genericNodesPresent: genericPresent.map((node) => ({ anymarketId: node.anymarketId, fullPath: node.fullPath })),
    vocabularyByDepth,
    samplePaths: leaves
      .filter((node) => (node.depth ?? 0) > 0)
      .slice(0, 15)
      .map((node) => node.fullPath),
  }
}

/**
 * Sugere `maxDepth` a partir da árvore em vez de fixar 3 no código.
 * Nunca reduz abaixo de 2 nem passa de 5: fora dessa faixa a árvore fica
 * inutilizável para operação (raso demais não organiza, fundo demais ninguém navega).
 */
export function suggestMaxDepth(profile) {
  const observed = Math.max(profile.leafDepthP50 + 1, profile.depthP50 + 1)
  return Math.min(5, Math.max(2, observed))
}

/**
 * Bloco de contexto para o prompt do classificador.
 *
 * Só texto — o modelo recebe as raízes reais e o jargão do cliente, e é instruído
 * a NÃO inventar departamento. As convenções observadas são informadas como
 * descrição da árvore, jamais como instrução de estilo (§8.1).
 */
export function buildProfilePromptBlock(profile, { maxDepth } = {}) {
  const depth = maxDepth ?? suggestMaxDepth(profile)

  const vocab = Object.entries(profile.vocabularyByDepth)
    .map(([level, terms]) => `  nível ${level}: ${terms.slice(0, 8).map((t) => t.term).join(', ')}`)
    .join('\n')

  return [
    'ÁRVORE DE CATEGORIAS ATUAL DESTE CLIENTE (é a taxonomia de referência — use o vocabulário dela):',
    `- Departamentos existentes (nível 0), universo PREFERENCIAL e fechado: ${profile.rootNames.join(' | ') || '(nenhum)'}`,
    `- Total de categorias: ${profile.nodeCount}. Profundidade típica das folhas: ${profile.leafDepthP50}. Máxima: ${profile.leafDepthMax}.`,
    `- Profundidade máxima permitida nesta sugestão: ${depth} níveis.`,
    profile.samplePaths.length ? `- Exemplos de caminhos reais:\n${profile.samplePaths.map((p) => `  ${p}`).join('\n')}` : '',
    vocab ? `- Vocabulário recorrente por nível:\n${vocab}` : '',
    '',
    'REGRAS DE ANCORAGEM:',
    '1. Encaixe o produto num departamento EXISTENTE da lista acima. Criar departamento novo é último recurso e requer confirmação humana extra.',
    '2. Prefira reusar caminhos existentes; proponha nó novo apenas para o nível realmente ausente.',
    '3. Use o vocabulário do cliente, não sinônimos seus (se a árvore diz "Acessórios", não escreva "Acessorios Diversos").',
    '4. Nomes novos: substantivo no plural, sem marca, sem medida, sem código, sem termo genérico ("Outros", "Diversos").',
  ]
    .filter(Boolean)
    .join('\n')
}
