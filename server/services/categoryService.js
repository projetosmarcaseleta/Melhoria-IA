/**
 * Orquestração da criação assistida de categorias.
 *
 * Divisão de responsabilidades (§9 da especificação):
 *   suggest  → NÃO escreve em lugar nenhum. Analisa, deduplica, grava proposta.
 *   approve  → ÚNICO ponto que cria categoria no AnyMarket. Irreversível na prática.
 *   attach   → substitui a categoria do produto. Reversível: guarda previousCategory.
 *   undo     → devolve o produto à categoria anterior.
 *
 * A assimetria de reversibilidade é deliberada (princípio P7): criação exige lock,
 * re-checagem por partnerId e teto por lote; substituição exige registro do estado
 * anterior e desfazer de um clique.
 */

import { db, FieldValue } from './firebaseAdmin.js'
import {
  isTestClient,
  saveMockCategoryProposal,
  getMockCategoryProposal,
  listMockCategoryProposals,
  saveMockAttachment,
  getMockAttachment,
  listMockAttachments,
} from './mockStorage.js'
import {
  resolveAnymarketToken,
  fetchProduct,
  createCategory,
  patchProductCategory,
  findCategoriesByPartnerId,
  fetchCategoryChildren,
  AnymarketApiError,
} from './anymarketClient.js'
import { loadCategoryTree } from './categoryTreeService.js'
import { categoryTreeCache } from './categoryTreeCache.js'
import { profileTree, buildProfilePromptBlock, suggestMaxDepth } from './categoryTreeProfiler.js'
import { matchPath, DEFAULT_THRESHOLDS, scoreNames } from './categoryMatcher.js'
import { normalizePath, validateNodeName, formatDisplayName, normalizeName, slugKey, tokenSetKey, pathKey } from './categoryNormalizer.js'
import { resolvePrompt } from './promptResolver.js'
import { generateStructured } from './llmService.js'
import { DEFAULT_SKILLS } from '../routes/skills.js'

const PROPOSALS = 'category_proposals'
const ATTACHMENTS = 'category_attachments'
const LOCKS = 'category_locks'
const SKILL_ID = 'category_suggestion'
const LOCK_STALE_MS = 5 * 60 * 1000

const CLASSIFY_SCHEMA = {
  name: 'category_classification',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'array', items: { type: 'string' } },
      matchType: { type: 'string', enum: ['existing', 'extend', 'new'] },
      existingCategoryId: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['path', 'matchType', 'existingCategoryId', 'confidence', 'reasoning'],
  },
}

const JUDGE_SCHEMA = {
  name: 'category_same_judgement',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      same: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['same', 'reason'],
  },
}

export class CategoryServiceError extends Error {
  constructor(message, { status = 400, code = null, detail = null } = {}) {
    super(message)
    this.name = 'CategoryServiceError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** Id de documento a partir do pathKey (Firestore não aceita "/" em id). */
export const proposalIdFromPath = (path) => pathKey(path).replace(/\//g, '__') || 'sem-caminho'

/**
 * O produto já está exatamente na categoria sugerida?
 *
 * Comparação por ID, nunca por texto: a API devolve o caminho atual com barra
 * ("PILHAS E BATERIAS/BATERIA COMUM") e a árvore monta com seta
 * ("PILHAS E BATERIAS > BATERIA COMUM") — comparar string diria "diferente" para a
 * mesma categoria. E o id vem numérico da API e string da árvore, daí o String().
 */
export function isAlreadyInCategory(currentCategory, leafCategoryId) {
  if (!currentCategory?.id || leafCategoryId === null || leafCategoryId === undefined) return false
  return String(currentCategory.id) === String(leafCategoryId)
}

/**
 * Config da skill do cliente, com os padrões do catálogo por baixo.
 *
 * A feature é OPCIONAL por cliente: sem a skill ativa, `suggest` recusa. É o mesmo
 * idioma das outras habilidades do CRIA, e é o que garante que nenhum cliente ganhe
 * escrita em categoria sem alguém ligar explicitamente.
 */
export async function getCategoryConfig(clientId, { requireActive = true } = {}) {
  const definition = DEFAULT_SKILLS.find((skill) => skill.id === SKILL_ID)
  const defaults = definition?.defaultConfig ?? {}

  let isActive = false
  let config = { ...defaults }

  if (isTestClient(clientId)) {
    isActive = true // conta de teste sempre habilitada: opera só contra a árvore falsa
  } else {
    try {
      const doc = await db.collection('clients').doc(clientId).collection('skills').doc(SKILL_ID).get()
      if (doc.exists) {
        isActive = Boolean(doc.data()?.isActive)
        config = { ...defaults, ...(doc.data()?.config ?? {}) }
      }
    } catch (err) {
      console.warn('[CategoryService] Aviso ao ler config da skill (usando padrões):', err.message)
    }
  }

  if (requireActive && !isActive) {
    throw new CategoryServiceError(
      'A habilidade "Sugestão de Categorias (AnyMarket)" está desativada para este cliente. Ative na aba Skills para usar o recurso.',
      { status: 409, code: 'skill_inactive' }
    )
  }

  return {
    isActive,
    config,
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      fuzzy: Number(config.fuzzyThreshold ?? DEFAULT_THRESHOLDS.fuzzy),
      globalHint: Number(config.globalHintThreshold ?? DEFAULT_THRESHOLDS.globalHint),
    },
  }
}

/** Texto do produto usado tanto no prompt quanto na priorização de candidatos. */
function productText(product) {
  return [product?.title, product?.characteristics, stripHtml(product?.description)].filter(Boolean).join(' \n')
}

function stripHtml(text) {
  return String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Seleciona os caminhos existentes mais plausíveis para entrar no prompt.
 *
 * Nunca a árvore inteira: além do custo em tokens, dar 2.000 caminhos ao modelo
 * aumenta a chance de ele "inventar" um id. As raízes vão SEMPRE (o nível 0 é
 * universo fechado por decisão D3) e o resto é priorizado por sobreposição de termos.
 */
export function buildCandidateShortlist(product, nodes, { limit = 20 } = {}) {
  const terms = new Set(normalizeName(productText(product)).split(' ').filter((t) => t.length > 2))

  const scored = nodes
    .filter((node) => node.parentId)
    .map((node) => {
      const pathTerms = normalizeName(node.fullPath).split(' ')
      const overlap = pathTerms.filter((term) => terms.has(term)).length
      return { node, overlap }
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.node.fullPath.length - b.node.fullPath.length)
    .slice(0, limit)
    .map((entry) => entry.node)

  const roots = nodes.filter((node) => !node.parentId)
  return { roots, candidates: scored }
}

function buildClassifyUserMessage(product, shortlist, profileBlock) {
  const candidateLines = shortlist.candidates.length
    ? shortlist.candidates.map((node) => `- ${node.fullPath} (id ${node.anymarketId})`).join('\n')
    : '- (nenhum caminho existente parecido com este produto)'

  return [
    profileBlock,
    '',
    'CAMINHOS EXISTENTES MAIS PRÓXIMOS DESTE PRODUTO:',
    candidateLines,
    '',
    'PRODUTO A CLASSIFICAR:',
    product.title ? `Título: ${product.title}` : null,
    product.characteristics ? `Características: ${product.characteristics}` : null,
    product.description ? `Descrição: ${stripHtml(product.description).slice(0, 1500)}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * Estágio 3 do funil — juiz binário na banda ambígua.
 *
 * Só roda quando o fuzzy não decidiu sozinho e existe candidato parecido em outro
 * galho. Viés instruído para "different": falso reuso manda o produto para a
 * categoria errada silenciosamente, enquanto quase-duplicata o operador enxerga.
 */
async function judgeSameCategory({ proposedPath, candidate, model }) {
  try {
    const result = await generateStructured({
      systemPrompt:
        'Você compara categorias de marketplace. Responda se os dois caminhos representam a MESMA categoria de catálogo. Em caso de dúvida, responda same=false: é melhor deixar a decisão para o operador do que fundir categorias distintas.',
      userMessage: `Caminho proposto: ${proposedPath.join(' > ')}\nCaminho existente: ${candidate.fullPath}`,
      jsonSchema: JUDGE_SCHEMA,
      model,
      temperature: 0,
    })
    return result
  } catch (err) {
    console.warn('[CategoryService] Juiz semântico indisponível (seguindo sem estágio 3):', err.message)
    return { same: false, reason: 'juiz indisponível' }
  }
}

async function readProposal(clientId, proposalId) {
  if (isTestClient(clientId)) return getMockCategoryProposal(clientId, proposalId)

  const doc = await db.collection('clients').doc(clientId).collection(PROPOSALS).doc(proposalId).get()
  return doc.exists ? { id: doc.id, ...doc.data() } : null
}

async function writeProposal(clientId, proposalId, data) {
  if (isTestClient(clientId)) return saveMockCategoryProposal(clientId, proposalId, data)

  await db.collection('clients').doc(clientId).collection(PROPOSALS).doc(proposalId).set(data, { merge: true })
  return { id: proposalId, ...data }
}

export async function listProposals(clientId, { status = null } = {}) {
  if (isTestClient(clientId)) return listMockCategoryProposals(clientId, status)

  try {
    let query = db.collection('clients').doc(clientId).collection(PROPOSALS)
    if (status) query = query.where('status', '==', status)
    const snapshot = await query.get()
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  } catch (err) {
    console.warn('[CategoryService] Aviso ao listar propostas:', err.message)
    return []
  }
}

/**
 * Analisa um produto e devolve a proposta de categoria — SEM escrever no AnyMarket.
 *
 * @param {string} clientId
 * @param {{id: string, title: string, description?: string, characteristics?: string}} product
 */
export async function suggestCategory(clientId, product, { userId = 'system', includeCurrent = true } = {}) {
  if (!product?.id) throw new CategoryServiceError('produto sem id.', { status: 400 })

  const { config, thresholds } = await getCategoryConfig(clientId)
  // allowSync: false — o clique no card não pode disparar varredura de dezenas de
  // páginas na API. Sem espelho, o erro é explícito e o operador sincroniza antes.
  const tree = await loadCategoryTree(clientId, { allowSync: false })
  const profile = profileTree(tree.nodes)
  const maxDepth = config.maxDepth === 'auto' || !config.maxDepth ? suggestMaxDepth(profile) : Number(config.maxDepth)

  // 1. Classificação pelo LLM, ancorada na árvore do cliente (D3)
  const shortlist = buildCandidateShortlist(product, tree.nodes)
  const prompt = await resolvePrompt(clientId, 'categoria', product)
  const model = config.model ?? 'gpt-4o-mini'

  const classification = await generateStructured({
    systemPrompt: prompt.systemPrompt,
    userMessage: buildClassifyUserMessage(product, shortlist, buildProfilePromptBlock(profile, { maxDepth })),
    jsonSchema: CLASSIFY_SCHEMA,
    model,
    temperature: 0.1,
  })

  // 2. Normalização determinística ANTES de qualquer comparação:
  // divide nome composto ("Automotivo, Carros"), aplica Title Case, corta em 80 chars.
  const rawPath = normalizePath(classification.path ?? [])
  if (!rawPath.length) {
    throw new CategoryServiceError('O classificador não devolveu caminho de categoria utilizável.', {
      status: 422,
      code: 'empty_path',
      detail: classification,
    })
  }

  const validations = rawPath.map((name) => validateNodeName(name, { brands: config.brands }))
  const cleanPath = validations.map((v) => v.name).filter(Boolean).slice(0, maxDepth)

  // 3. Funil de dedup, nível a nível
  let match = matchPath({
    path: cleanPath,
    nodes: tree.nodes,
    thresholds,
    partnerIdPrefix: config.partnerIdPrefix ?? 'CRIA',
    maxDepth,
  })

  // 4. Estágio 3 — juiz semântico só na banda ambígua, e só se houver o que julgar
  let judgement = null
  if (!config.exactMatchOnly && match.missingTail.length && match.globalSimilar.length) {
    const best = match.globalSimilar[0]
    if (best.score < thresholds.fuzzy) {
      judgement = await judgeSameCategory({ proposedPath: match.resolvedPath, candidate: best, model })

      if (judgement.same) {
        // O juiz reconheceu o caminho existente: vira reuso puro, nada é criado.
        const node = tree.nodes.find((n) => n.anymarketId === best.anymarketId)
        match = {
          ...match,
          resolvedPath: node.fullPath.split(' > '),
          reusedPrefix: [
            {
              anymarketId: node.anymarketId,
              name: node.name,
              fullPath: node.fullPath,
              matchStage: 'semantic_judge',
              matchScore: best.score,
              proposedName: cleanPath[cleanPath.length - 1],
            },
          ],
          missingTail: [],
          leafCategoryId: node.anymarketId,
          fullyExisting: true,
          createsNewRoot: false,
          pathKey: pathKey(node.fullPath.split(' > ')),
        }
      }
    }
  }

  // 5. Categoria atual do produto — é o "de" do modal. Sem isso o operador
  // confirmaria uma substituição às cegas.
  let currentCategory = null
  if (includeCurrent) {
    currentCategory = await getProductCategory(clientId, product.id).catch((err) => {
      console.warn(`[CategoryService] Não foi possível ler a categoria atual do produto ${product.id}:`, err.message)
      return null
    })
  }

  const proposalId = proposalIdFromPath(match.resolvedPath)
  const existing = await readProposal(clientId, proposalId)

  const nowIso = new Date().toISOString()
  const productIds = [...new Set([...(existing?.productIds ?? []), String(product.id)])]

  const proposal = {
    id: proposalId,
    pathKey: match.pathKey,
    proposedPath: match.resolvedPath,
    reusedPrefix: match.reusedPrefix,
    missingTail: match.missingTail.map((node) => ({
      ...node,
      priceFactor: Number(config.priceFactor ?? 1),
      definitionPriceScope: config.definitionPriceScope ?? 'SKU',
    })),
    rejectedCandidates: match.rejectedCandidates,
    globalSimilar: match.globalSimilar,
    createsNewRoot: match.createsNewRoot,
    fullyExisting: match.fullyExisting,
    leafCategoryId: match.leafCategoryId,
    productIds,
    currentCategory,
    // Detectado na ANÁLISE, não na hora de aplicar: se o produto já está na
    // categoria sugerida, o operador precisa saber antes de clicar em qualquer coisa.
    alreadyInSuggestedCategory: isAlreadyInCategory(currentCategory, match.leafCategoryId),
    confidence: Number(classification.confidence ?? 0),
    reasoning: classification.reasoning ?? '',
    matchType: classification.matchType,
    llmSuggestedPath: rawPath,
    nameViolations: validations.flatMap((v, i) => v.violations.map((violation) => ({ ...violation, level: i, name: rawPath[i] }))),
    judgement,
    // Caminho que já existe inteiro não vira fila de aprovação: não há o que criar.
    status: match.fullyExisting ? 'auto_resolved' : existing?.status === 'created' ? 'created' : 'pending_approval',
    createdBy: existing?.createdBy ?? userId,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    createdCategoryIds: existing?.createdCategoryIds ?? [],
    treeSyncedAt: tree.syncedAt ?? null,
    attemptCount: existing?.attemptCount ?? 0,
    lastError: existing?.lastError ?? null,
  }

  await writeProposal(clientId, proposalId, proposal)
  return proposal
}

/** Categoria atual de um produto no AnyMarket (o "de" da substituição). */
export async function getProductCategory(clientId, productId) {
  if (isTestClient(clientId)) {
    return { id: '1002', name: 'Acessorios', fullPath: 'Automotivo > Acessorios', mock: true }
  }

  const token = await resolveAnymarketToken(clientId)
  const product = await fetchProduct(token, productId)
  const category = product?.category

  if (!category?.id) return null

  return {
    id: String(category.id),
    name: category.name ?? null,
    fullPath: category.path ?? category.fullPath ?? category.name ?? null,
  }
}

/** Lock distribuído por caminho — `create()` falha se o doc já existe. */
async function acquireLock(clientId, lockId, userId) {
  if (isTestClient(clientId)) return { acquired: true, release: async () => {} }

  const ref = db.collection('clients').doc(clientId).collection(LOCKS).doc(lockId)

  try {
    await ref.create({ ownedBy: userId, startedAt: FieldValue.serverTimestamp(), startedAtMs: Date.now() })
    return {
      acquired: true,
      release: async (anymarketId = null) => {
        try {
          if (anymarketId) await ref.set({ anymarketId, finishedAtMs: Date.now() }, { merge: true })
          await ref.delete()
        } catch (err) {
          console.warn('[CategoryService] Aviso ao liberar lock:', err.message)
        }
      },
    }
  } catch (err) {
    const snapshot = await ref.get().catch(() => null)
    const startedAtMs = snapshot?.data()?.startedAtMs ?? 0

    // Lock preso (processo morreu no meio): expira em vez de travar o caminho para sempre.
    if (startedAtMs && Date.now() - startedAtMs > LOCK_STALE_MS) {
      console.warn(`[CategoryService] Lock ${lockId} expirado (${Date.now() - startedAtMs}ms) — assumindo.`)
      await ref.set({ ownedBy: userId, startedAtMs: Date.now() }, { merge: true })
      return { acquired: true, release: async () => ref.delete().catch(() => {}) }
    }

    return { acquired: false, heldBy: snapshot?.data()?.ownedBy ?? 'desconhecido', existingId: snapshot?.data()?.anymarketId ?? null }
  }
}

/** Grava o nó criado no espelho do Firestore e no cache, sem ressincronizar tudo. */
async function registerCreatedNode(clientId, node) {
  categoryTreeCache.upsertNode(clientId, node)

  if (isTestClient(clientId)) return

  try {
    await db
      .collection('clients')
      .doc(clientId)
      .collection('anymarket_categories')
      .doc(node.anymarketId)
      .set({ ...node, syncedAt: new Date().toISOString() }, { merge: true })
  } catch (err) {
    console.warn('[CategoryService] Aviso ao gravar nó novo no espelho:', err.message)
  }
}

/** Registro na coleção `generations` — alimenta o few-shot do próprio classificador. */
async function recordCategoryGeneration(clientId, { proposal, status, userId, editedPath = null }) {
  const payload = {
    clientId,
    operatorId: userId,
    productId: proposal.productIds?.[0] ?? '',
    generationType: 'categoria',
    inputTitle: '',
    generatedText: proposal.llmSuggestedPath?.join(' > ') ?? proposal.proposedPath.join(' > '),
    editedText: editedPath ? editedPath.join(' > ') : null,
    feedbackStatus: status,
    feedbackBy: userId,
    approvedVia: 'product_modal',
    confidence: proposal.confidence ?? null,
    createdAt: FieldValue.serverTimestamp(),
  }

  if (isTestClient(clientId)) return

  try {
    await db.collection('generations').add(payload)
  } catch (err) {
    console.warn('[CategoryService] Aviso ao registrar aprendizado da categoria:', err.message)
  }
}

/**
 * Cria no AnyMarket a cauda faltante da proposta. ÚNICO ponto de escrita irreversível.
 *
 * Ordem: transação de estado → lock → re-checagem por partnerId → POST top-down.
 * Cada nó criado entra no cache na hora, para o nível seguinte já achar o pai.
 */
export async function approveProposal(clientId, proposalId, { userId = 'system', confirmNewRoot = false } = {}) {
  const { config, thresholds } = await getCategoryConfig(clientId)
  const proposal = await readProposal(clientId, proposalId)

  if (!proposal) throw new CategoryServiceError('Proposta não encontrada.', { status: 404 })
  if (proposal.status === 'created') {
    return { ...proposal, alreadyCreated: true }
  }
  if (proposal.fullyExisting) {
    return { ...proposal, alreadyCreated: true, leafCategoryId: proposal.leafCategoryId }
  }

  if (proposal.createsNewRoot && (config.allowNewRoot ?? 'confirm') === 'block') {
    throw new CategoryServiceError('Criação de departamento novo está bloqueada na configuração deste cliente.', {
      status: 409,
      code: 'new_root_blocked',
    })
  }
  if (proposal.createsNewRoot && !confirmNewRoot) {
    throw new CategoryServiceError(
      'Este caminho cria um DEPARTAMENTO novo (nível 0). Confirme explicitamente para prosseguir.',
      { status: 409, code: 'new_root_confirmation_required', detail: { newRootName: proposal.missingTail[0]?.name } }
    )
  }

  // Revalida contra a árvore FRESCA: a proposta pode ter sido gerada minutos atrás e
  // alguém (ou outro lote) pode já ter criado parte do caminho.
  const tree = await loadCategoryTree(clientId, { allowSync: false })
  const fresh = matchPath({
    path: proposal.proposedPath,
    nodes: tree.nodes,
    thresholds,
    partnerIdPrefix: config.partnerIdPrefix ?? 'CRIA',
  })

  if (fresh.fullyExisting) {
    const updated = {
      ...proposal,
      status: 'created',
      leafCategoryId: fresh.leafCategoryId,
      reusedPrefix: fresh.reusedPrefix,
      missingTail: [],
      createdCategoryIds: [],
      reusedOnApprove: true,
      updatedAt: new Date().toISOString(),
    }
    await writeProposal(clientId, proposalId, updated)
    return updated
  }

  const maxNew = Number(config.maxNewNodesPerApproval ?? 10)
  if (fresh.missingTail.length > maxNew) {
    throw new CategoryServiceError(
      `A aprovação criaria ${fresh.missingTail.length} categorias, acima do teto de ${maxNew} configurado.`,
      { status: 409, code: 'max_new_nodes_exceeded' }
    )
  }

  const lockId = proposalIdFromPath(proposal.proposedPath)
  const lock = await acquireLock(clientId, lockId, userId)
  if (!lock.acquired) {
    throw new CategoryServiceError(
      `Outro processo já está criando este caminho (${lock.heldBy}). Tente novamente em instantes.`,
      { status: 409, code: 'locked', detail: { existingId: lock.existingId } }
    )
  }

  // Conta de teste NUNCA toca a API real (§9): simula a escrita mantendo todo o
  // resto do fluxo (funil, lock, cauda, cache) idêntico ao de produção.
  const dryRun = isTestClient(clientId) || process.env.ANYMARKET_DRY_RUN === 'true'
  const token = await resolveAnymarketToken(clientId)
  const createdCategoryIds = [...(proposal.createdCategoryIds ?? [])]
  let parentId = fresh.reusedPrefix[fresh.reusedPrefix.length - 1]?.anymarketId ?? null
  let leafCategoryId = parentId

  try {
    await writeProposal(clientId, proposalId, { status: 'creating', updatedAt: new Date().toISOString() })

    for (let tailIndex = 0; tailIndex < fresh.missingTail.length; tailIndex++) {
      const tail = fresh.missingTail[tailIndex]
      const partnerId = tail.partnerId

      // ── Estágio 0 do funil: chave natural contra a FONTE DA VERDADE ──
      // Fecha a janela de corrida que o cache não cobre.
      let existingId = null
      if (!isTestClient(clientId)) {
        const found = await findCategoriesByPartnerId(token, partnerId).catch((err) => {
          console.warn('[CategoryService] Aviso na checagem por partnerId (seguindo para criação):', err.message)
          return []
        })
        existingId = found?.[0]?.id ? String(found[0].id) : null
      }

      // ── Estágio 0b: filhos reais do pai, lidos da API agora ──
      // O partnerId só encontra o que o CRIA criou. Esta checagem encontra também o
      // que outra pessoa criou pelo painel do AnyMarket depois da última
      // sincronização — uma chamada, no nível exato, contra a fonte da verdade.
      if (!existingId && parentId && !isTestClient(clientId)) {
        const irmaos = await fetchCategoryChildren(token, parentId).catch((err) => {
          console.warn('[CategoryService] Aviso ao conferir filhos do pai (seguindo para criação):', err.message)
          return []
        })

        const alvoSlug = slugKey(tail.name)
        const alvoTokens = tokenSetKey(tail.name)
        const irmaoIgual = irmaos.find((irmao) => slugKey(irmao.name) === alvoSlug || tokenSetKey(irmao.name) === alvoTokens)

        if (irmaoIgual) {
          existingId = irmaoIgual.anymarketId
          console.log(
            `[CategoryService] "${tail.name}" já existe sob o pai ${parentId} como "${irmaoIgual.name}" (id ${existingId}) — reusando em vez de criar.`
          )
        }
      }

      let nodeId = existingId
      if (nodeId) {
        console.log(`[CategoryService] "${tail.name}" reusado (id ${nodeId}) — nada foi criado neste nível.`)
      } else {
        const created = await createCategory(token, {
          name: tail.name,
          partnerId,
          parentId,
          priceFactor: Number(tail.priceFactor ?? config.priceFactor ?? 1),
          definitionPriceScope: tail.definitionPriceScope ?? config.definitionPriceScope ?? 'SKU',
          dryRun,
        })
        nodeId = String(created?.id ?? '')
        if (!nodeId) throw new CategoryServiceError('AnyMarket não devolveu o id da categoria criada.', { status: 502 })
        createdCategoryIds.push(nodeId)
      }

      const pathSoFar = [...fresh.reusedPrefix.map((n) => n.name), ...fresh.missingTail.slice(0, tailIndex + 1).map((n) => n.name)]

      await registerCreatedNode(clientId, {
        anymarketId: nodeId,
        name: tail.name,
        parentId,
        depth: pathSoFar.length - 1,
        fullPath: pathSoFar.join(' > '),
        slugKey: slugKey(tail.name),
        tokenSetKey: tokenSetKey(tail.name),
        pathKey: pathKey(pathSoFar),
        partnerId,
        hasChildren: false,
        childCount: 0,
        createdByCria: true,
        isOrphan: false,
      })

      parentId = nodeId
      leafCategoryId = nodeId
    }

    const updated = {
      ...proposal,
      status: 'created',
      reusedPrefix: fresh.reusedPrefix,
      missingTail: fresh.missingTail,
      createdCategoryIds,
      leafCategoryId,
      reviewedBy: userId,
      effectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
    }

    await writeProposal(clientId, proposalId, updated)
    await recordCategoryGeneration(clientId, { proposal: updated, status: 'approved', userId })
    await lock.release(leafCategoryId)

    console.log(`[CategoryService] Cliente ${clientId} → criado "${updated.proposedPath.join(' > ')}" (folha ${leafCategoryId})`)
    return updated
  } catch (err) {
    // Falha no meio da cauda deixa rastro do que já foi criado: o retry reaproveita
    // o prefixo recém-criado (estágios 0/1) e tenta só o que falta.
    const partial = createdCategoryIds.length > 0
    await writeProposal(clientId, proposalId, {
      status: partial ? 'partially_created' : 'failed',
      createdCategoryIds,
      attemptCount: (proposal.attemptCount ?? 0) + 1,
      lastError: err.message,
      updatedAt: new Date().toISOString(),
    })
    await lock.release()

    if (err instanceof CategoryServiceError || err instanceof AnymarketApiError) throw err
    throw new CategoryServiceError(`Falha ao criar categoria: ${err.message}`, { status: 502 })
  }
}

export async function rejectProposal(clientId, proposalId, { userId = 'system', reason = null } = {}) {
  const proposal = await readProposal(clientId, proposalId)
  if (!proposal) throw new CategoryServiceError('Proposta não encontrada.', { status: 404 })

  const updated = {
    ...proposal,
    status: 'rejected',
    reviewedBy: userId,
    rejectionReason: reason,
    updatedAt: new Date().toISOString(),
  }

  await writeProposal(clientId, proposalId, updated)
  await recordCategoryGeneration(clientId, { proposal: updated, status: 'rejected', userId })
  return updated
}

/**
 * Substitui a categoria de um produto. REVERSÍVEL — guarda a categoria anterior.
 *
 * Decisão D1: substitui de fato, não só preenche vazio. O guarda `onlyWhenEmpty`
 * existe na config para quem quiser o comportamento conservador.
 */
export async function attachCategory(clientId, { productId, categoryId, proposalId = null, mode = 'confirm_each', userId = 'system' }) {
  if (!productId) throw new CategoryServiceError('productId é obrigatório.', { status: 400 })
  if (!categoryId) throw new CategoryServiceError('categoryId é obrigatório.', { status: 400 })

  const { config } = await getCategoryConfig(clientId)
  const previousCategory = await getProductCategory(clientId, productId).catch(() => null)

  if (config.onlyWhenEmpty && previousCategory?.id) {
    return { skipped: true, reason: 'only_when_empty', productId, previousCategory }
  }
  if ((config.skipWhenSameLeaf ?? true) && previousCategory?.id === String(categoryId)) {
    return { skipped: true, reason: 'same_category', productId, previousCategory }
  }

  const dryRun = isTestClient(clientId) || process.env.ANYMARKET_DRY_RUN === 'true'
  const token = await resolveAnymarketToken(clientId)
  await patchProductCategory(token, productId, categoryId, { dryRun })

  const tree = categoryTreeCache.get(clientId)
  const node = tree?.nodes?.find((n) => n.anymarketId === String(categoryId))

  const record = {
    productId: String(productId),
    previousCategory: previousCategory ?? null,
    newCategory: { id: String(categoryId), name: node?.name ?? null, fullPath: node?.fullPath ?? null },
    newCategoryWasCreatedNow: Boolean(node?.createdByCria),
    proposalId,
    mode,
    status: 'applied',
    appliedBy: userId,
    appliedAt: new Date().toISOString(),
  }

  const saved = await saveAttachment(clientId, record)
  console.log(
    `[CategoryService] Produto ${productId}: ${previousCategory?.fullPath ?? '(sem categoria)'} → ${record.newCategory.fullPath ?? categoryId}`
  )
  return saved
}

async function saveAttachment(clientId, record) {
  if (isTestClient(clientId)) return saveMockAttachment(clientId, record)

  try {
    const ref = await db.collection('clients').doc(clientId).collection(ATTACHMENTS).add(record)
    return { id: ref.id, ...record }
  } catch (err) {
    console.warn('[CategoryService] Aviso ao registrar vínculo no Firestore:', err.message)
    return { id: `local-${Date.now()}`, ...record, persisted: false }
  }
}

export async function listAttachments(clientId, { productId = null, limit = 50 } = {}) {
  if (isTestClient(clientId)) return listMockAttachments(clientId, productId)

  try {
    let query = db.collection('clients').doc(clientId).collection(ATTACHMENTS)
    if (productId) query = query.where('productId', '==', String(productId))
    const snapshot = await query.limit(limit).get()
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  } catch (err) {
    console.warn('[CategoryService] Aviso ao listar vínculos:', err.message)
    return []
  }
}

/**
 * Desfaz um vínculo: devolve o produto à categoria anterior.
 *
 * NÃO apaga a categoria criada — ela é inofensiva onde está, e apagar reabriria o
 * risco irreversível da criação (§9).
 */
export async function undoAttachment(clientId, attachmentId, { userId = 'system' } = {}) {
  const record = isTestClient(clientId)
    ? getMockAttachment(clientId, attachmentId)
    : await db
        .collection('clients')
        .doc(clientId)
        .collection(ATTACHMENTS)
        .doc(attachmentId)
        .get()
        .then((doc) => (doc.exists ? { id: doc.id, ...doc.data() } : null))

  if (!record) throw new CategoryServiceError('Vínculo não encontrado.', { status: 404 })
  if (record.status === 'undone') return { ...record, alreadyUndone: true }
  if (!record.previousCategory?.id) {
    throw new CategoryServiceError(
      'Este produto não tinha categoria antes do vínculo — não há estado anterior para restaurar. Ajuste manualmente no AnyMarket se necessário.',
      { status: 409, code: 'no_previous_category' }
    )
  }

  const token = await resolveAnymarketToken(clientId)
  await patchProductCategory(token, record.productId, record.previousCategory.id, {
    dryRun: isTestClient(clientId) || process.env.ANYMARKET_DRY_RUN === 'true',
  })

  const updated = { ...record, status: 'undone', undoneAt: new Date().toISOString(), undoneBy: userId }

  if (isTestClient(clientId)) {
    saveMockAttachment(clientId, updated)
  } else {
    try {
      await db.collection('clients').doc(clientId).collection(ATTACHMENTS).doc(attachmentId).set(updated, { merge: true })
    } catch (err) {
      console.warn('[CategoryService] Aviso ao marcar vínculo como desfeito:', err.message)
    }
  }

  return updated
}

/**
 * Vínculo em lote (`attachMode: 'auto_batch'`) — mesmo caminho do individual, com teto.
 *
 * O teto não é burocracia: sem ele, um lote com classificação ruim troca a categoria
 * de centenas de produtos publicados antes de alguém perceber.
 */
export async function attachCategoryBatch(clientId, { productIds = [], categoryId, proposalId = null, userId = 'system' }) {
  const { config } = await getCategoryConfig(clientId)
  const cap = Number(config.maxAutoAttachPerBatch ?? 50)

  const targets = productIds.slice(0, cap)
  const skippedByCap = productIds.length - targets.length

  const results = []
  for (const productId of targets) {
    try {
      results.push(await attachCategory(clientId, { productId, categoryId, proposalId, mode: 'auto_batch', userId }))
    } catch (err) {
      results.push({ productId, error: err.message, status: 'failed' })
    }
  }

  if (skippedByCap > 0) {
    console.warn(`[CategoryService] ${skippedByCap} produto(s) fora do lote por teto de ${cap}.`)
  }

  return {
    applied: results.filter((r) => r.status === 'applied').length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.status === 'failed').length,
    skippedByCap,
    results,
  }
}

export { scoreNames, formatDisplayName }
