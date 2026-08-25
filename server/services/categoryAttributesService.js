/**
 * Atributos (características) de categoria por canal.
 *
 * Ver docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §2 e §3.
 *
 * Tudo aqui vem da API PÚBLICA v2 — contrato estável, ao contrário do vínculo de
 * canal. O que esta camada acrescenta:
 *
 *   1. Cache em duas alturas: memória (TTL curto, evita reler a cada render) e
 *      Firestore (sobrevive a restart). `/v2/categories/characteristics/groups` é
 *      varredura paginada da conta inteira — bater nela a cada abertura de modal é
 *      queimar cota do cliente por um dado que muda raramente.
 *
 *   2. Obrigatoriedade POR CANAL. O mesmo atributo da mesma categoria do hub pode ser
 *      obrigatório no Mercado Livre e opcional na Magalu — é o que
 *      `characteristicItemMarketPlaces[].required` diz, e é o eixo que a UI precisa.
 *
 * Limite honesto e documentado: só a obrigatoriedade ESTÁTICA é validável aqui.
 * Regra condicional ("B é obrigatório se A = X") não é exposta pela API — aparece
 * depois, como erro de transmissão. Ver `channelBindService.scanUnpublished`.
 */

import { db } from './firebaseAdmin.js'
import { AnymarketApiError, resolveAnymarketToken, fetchProduct } from './anymarketClient.js'
import { fetchCategoryMarketplaceAttributes, fetchCharacteristicGroups, fetchVariationValues, patchProductCharacteristics, assertMarketplace, assertCategoryId } from './channelBindClient.js'
import { resolvePanelToken } from './channelBindService.js'
import { isTestClient, getMockCharacteristicGroups } from './mockStorage.js'
import { generateStructured } from './llmService.js'

const ATTRS_CACHE = 'category_attributes_cache'
const PRODUCT_VALUES = 'product_attribute_values'
const MEMORY_TTL_MS = 30 * 60 * 1000

/** Chave do balde "vale para todo canal": atributo do hub sem entrada por marketplace. */
export const ALL_CHANNELS = '*'

export class CategoryAttributesError extends Error {
  constructor(message, { status = 400, code = null, detail = null } = {}) {
    super(message)
    this.name = 'CategoryAttributesError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

// ── Cache em memória, por cliente ──────────────────────────────────────────────
//
// A varredura é da conta inteira, não de uma categoria: guardar por categoria
// multiplicaria a mesma leitura por N categorias abertas no mesmo dia.

const memoryCache = new Map()

export const attributesMemoryCache = {
  get(clientId) {
    const entry = memoryCache.get(clientId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(clientId)
      return null
    }
    return entry.data
  },
  set(clientId, data, ttlMs = MEMORY_TTL_MS) {
    memoryCache.set(clientId, { data, expiresAt: Date.now() + ttlMs })
  },
  invalidate(clientId) {
    return memoryCache.delete(clientId)
  },
  clear() {
    memoryCache.clear()
  },
}

// ── Normalização (puro, testável sem rede) ─────────────────────────────────────

const toValueType = (raw) => {
  const value = String(raw ?? '').toUpperCase()
  return ['TEXT', 'NUMBER', 'LIST', 'BOOLEAN'].includes(value) ? value : 'TEXT'
}

/**
 * Descobre a quais categorias do hub um grupo de características se aplica.
 *
 * O payload já apareceu em mais de uma forma (`categories[]`, `category{}`,
 * `categoryId`), então lê as três. Grupo sem categoria nenhuma NÃO é espalhado para
 * todas: vira `unlinked`, contado e reportado — inventar vínculo aqui produziria
 * "atributo obrigatório faltando" em categoria que não tem esse atributo.
 */
export function extractGroupCategoryIds(group) {
  const ids = new Set()

  const push = (value) => {
    const id = value?.id ?? value
    if (id !== null && id !== undefined && String(id).trim()) ids.add(String(id))
  }

  if (Array.isArray(group?.categories)) group.categories.forEach(push)
  if (group?.category) push(group.category)
  if (group?.categoryId !== undefined) push(group.categoryId)

  return [...ids]
}

/**
 * Payload cru de `/v2/categories/characteristics/groups` →
 * `{ [categoryId]: { [marketplace|'*']: Attribute[] } }`.
 */
export function normalizeCharacteristicGroups(items) {
  const byCategory = {}
  const unlinked = []

  for (const group of items ?? []) {
    const categoryIds = extractGroupCategoryIds(group)
    const characteristics = group?.characteristics ?? group?.characteristicItems ?? group?.items ?? []

    if (!Array.isArray(characteristics) || !characteristics.length) continue

    if (!categoryIds.length) {
      unlinked.push({ groupId: group?.id ?? null, groupName: group?.name ?? null, count: characteristics.length })
      continue
    }

    for (const characteristic of characteristics) {
      const base = {
        id: characteristic?.id ?? null,
        name: String(characteristic?.name ?? characteristic?.description ?? '').trim(),
        valueType: toValueType(characteristic?.valueType ?? characteristic?.type),
        typeId: characteristic?.typeId ?? characteristic?.variationTypeId ?? null,
        groupId: group?.id ?? null,
        groupName: group?.name ?? null,
      }

      if (!base.name) continue

      const perChannel = characteristic?.characteristicItemMarketPlaces ?? characteristic?.marketPlaces ?? []

      const entries = Array.isArray(perChannel) && perChannel.length
        ? perChannel.map((item) => ({
            marketplace: String(item?.marketPlace ?? item?.marketplace ?? '').trim().toUpperCase() || ALL_CHANNELS,
            required: Boolean(item?.required),
            idInMarketplace: item?.idInMarketPlace ?? item?.idInMarketplace ?? null,
            nameInMarketplace: item?.name ?? null,
          }))
        : // Sem detalhamento por canal: o atributo existe no hub e vale para todos.
          [{ marketplace: ALL_CHANNELS, required: Boolean(characteristic?.required), idInMarketplace: null, nameInMarketplace: null }]

      for (const categoryId of categoryIds) {
        byCategory[categoryId] ??= {}
        for (const entry of entries) {
          byCategory[categoryId][entry.marketplace] ??= []
          byCategory[categoryId][entry.marketplace].push({ ...base, ...entry })
        }
      }
    }
  }

  return { byCategory, unlinked }
}

/**
 * Atributos que valem para um canal: os do canal + os que valem para todos.
 *
 * Se o mesmo atributo aparece nos dois baldes, o do canal ganha — ele é quem carrega
 * o `required` específico e o `idInMarketplace`.
 */
export function attributesForMarketplace(byMarketplace, marketplace) {
  const especificos = byMarketplace?.[marketplace] ?? []
  const globais = byMarketplace?.[ALL_CHANNELS] ?? []

  const nomes = new Set(especificos.map((attr) => attr.name.toLowerCase()))
  const mesclados = [...especificos, ...globais.filter((attr) => !nomes.has(attr.name.toLowerCase()))]

  // Obrigatórios primeiro (é a ordem que a tela usa), depois alfabético.
  return mesclados.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
}

/** `characteristics[]` do produto → `[{ index, name, value }]`. */
export function normalizeProductCharacteristics(product) {
  const list = product?.characteristics ?? []
  if (!Array.isArray(list)) return []

  return list
    .map((item, i) => ({
      index: Number.isFinite(Number(item?.index)) ? Number(item.index) : i,
      name: String(item?.name ?? '').trim(),
      value: item?.value ?? null,
    }))
    .filter((item) => item.name)
}

const isEmptyValue = (value) =>
  value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)

/**
 * Obrigatórios sem valor. Comparação por nome, case-insensitive.
 *
 * O `characteristics[]` do produto casa por NOME, não por id — é assim que o PATCH
 * da v2 funciona (`{ index, name, value }`), então é por nome que a checagem tem de
 * ser feita para não reportar "faltando" um atributo já preenchido.
 */
export function missingRequiredAttributes(attributes, filled) {
  const preenchidos = new Map((filled ?? []).map((item) => [String(item.name).toLowerCase(), item.value]))

  return (attributes ?? [])
    .filter((attr) => attr.required && isEmptyValue(preenchidos.get(attr.name.toLowerCase())))
    .map((attr) => ({ name: attr.name, valueType: attr.valueType, marketplace: attr.marketplace, idInMarketplace: attr.idInMarketplace ?? null }))
}

/**
 * Monta o `characteristics[]` do PATCH preservando o que já existe.
 *
 * Dois cuidados: (a) PATCH de lista SUBSTITUI a lista — mandar só o campo editado
 * apagaria os outros, então o corpo carrega o estado completo; (b) `index` de
 * atributo já existente é preservado, e o novo entra depois do maior — reindexar o
 * que já estava lá é a receita para embaralhar valores.
 */
export function buildCharacteristicsPatch(existing, updates) {
  const atual = normalizeProductCharacteristics({ characteristics: existing })
  const porNome = new Map(atual.map((item) => [item.name.toLowerCase(), { ...item }]))
  let proximoIndex = atual.reduce((max, item) => Math.max(max, item.index), -1) + 1

  for (const update of updates ?? []) {
    const name = String(update?.name ?? '').trim()
    if (!name) continue

    const chave = name.toLowerCase()
    const existente = porNome.get(chave)

    if (existente) {
      existente.value = update.value
    } else {
      porNome.set(chave, { index: proximoIndex++, name, value: update.value })
    }
  }

  return [...porNome.values()]
    .filter((item) => !isEmptyValue(item.value))
    .sort((a, b) => a.index - b.index)
}

// ── Leitura com cache ──────────────────────────────────────────────────────────

async function loadAccountAttributes(clientId, { refresh = false } = {}) {
  if (!refresh) {
    const emMemoria = attributesMemoryCache.get(clientId)
    if (emMemoria) return { ...emMemoria, source: 'memory' }
  }

  if (isTestClient(clientId)) {
    const normalizado = normalizeCharacteristicGroups(getMockCharacteristicGroups())
    const dados = { ...normalizado, syncedAt: new Date().toISOString(), truncated: false }
    attributesMemoryCache.set(clientId, dados)
    return { ...dados, source: 'mock' }
  }

  const token = await resolveAnymarketToken(clientId)
  const { raw, truncated } = await fetchCharacteristicGroups(token)
  const normalizado = normalizeCharacteristicGroups(raw)

  const dados = { ...normalizado, syncedAt: new Date().toISOString(), truncated }
  attributesMemoryCache.set(clientId, dados)

  // Espelho no Firestore por categoria (§3). Falha aqui não invalida a leitura — o
  // dado já está em memória — mas é avisada, nunca engolida.
  try {
    const writer = db.bulkWriter()
    for (const [anymarketCategoryId, attributesByMarketplace] of Object.entries(dados.byCategory)) {
      writer
        .set(
          db.collection('clients').doc(clientId).collection(ATTRS_CACHE).doc(String(anymarketCategoryId)),
          { anymarketCategoryId: String(anymarketCategoryId), attributesByMarketplace, syncedAt: dados.syncedAt },
          { merge: true }
        )
        .catch(() => {})
    }
    await writer.close()
  } catch (err) {
    console.warn(`[CategoryAttributes] Aviso ao espelhar cache de atributos: ${err.message}`)
    dados.degraded = true
  }

  return { ...dados, source: 'api' }
}

/**
 * Atributos de UMA categoria, opcionalmente já filtrados por canal.
 *
 * Caminho primário: endpoint direto do painel
 *   `GET /rest/api/marketplace_category_attributes/categories/{id}/marketplaces/{mp}/attributes/`
 *   → 1 chamada, resposta imediata, atributos já filtrados pelo canal.
 *
 * Caminho de fallback (token do painel ausente/expirado): varredura da conta inteira
 *   via `loadAccountAttributes` — lento, mas sempre disponível com o gumgaToken.
 *
 * `withValues` busca os valores possíveis dos atributos LIST — chamada extra por
 * atributo, então é opt-in: a tela pede só quando vai realmente renderizar o select.
 */
export async function getCategoryAttributes(
  clientId,
  anymarketCategoryId,
  { marketplace = null, refresh = false, withValues = false } = {}
) {
  const categoryId = assertCategoryId(anymarketCategoryId)
  const mp = marketplace ? assertMarketplace(marketplace) : null

  // ── Caminho primário: endpoint direto do painel ────────────────────────────
  if (mp && !isTestClient(clientId)) {
    try {
      const panelToken = await resolvePanelToken(clientId)
      if (panelToken) {
        const attrs = await fetchCategoryMarketplaceAttributes(panelToken, categoryId, mp)
        return {
          anymarketCategoryId: categoryId,
          marketplace: mp,
          attributes: attrs,
          marketplaces: [mp],
          hasAny: attrs.length > 0,
          syncedAt: new Date().toISOString(),
          source: 'panel_direct',
          truncated: false,
          unlinkedGroups: 0,
          degraded: false,
        }
      }
    } catch (err) {
      // Token expirado ou painel indisponível → cai no fallback.
      console.warn(`[CategoryAttributes] Endpoint direto do painel indisponível (${err.code ?? err.message}) — usando fallback de varredura.`)
    }
  }

  // ── Fallback: varredura da conta inteira ───────────────────────────────────
  const conta = await loadAccountAttributes(clientId, { refresh })
  const byMarketplace = conta.byCategory[categoryId] ?? {}

  const attributes = mp
    ? attributesForMarketplace(byMarketplace, mp)
    : attributesForMarketplace(byMarketplace, ALL_CHANNELS)

  if (withValues) await hydrateListValues(clientId, attributes)

  return {
    anymarketCategoryId: categoryId,
    marketplace: mp,
    attributes,
    // Canal por canal, para a UI mostrar "obrigatório no ML, opcional na Magalu" sem
    // uma chamada por canal.
    marketplaces: Object.keys(byMarketplace).filter((key) => key !== ALL_CHANNELS).sort(),
    hasAny: attributes.length > 0,
    syncedAt: conta.syncedAt,
    source: conta.source,
    truncated: Boolean(conta.truncated),
    unlinkedGroups: conta.unlinked?.length ?? 0,
    degraded: Boolean(conta.degraded),
  }
}

/** Preenche `allowedValues` dos atributos LIST. Falha por atributo não derruba a tela. */
async function hydrateListValues(clientId, attributes) {
  const alvos = attributes.filter((attr) => attr.valueType === 'LIST' && attr.typeId)
  if (!alvos.length || isTestClient(clientId)) return

  const token = await resolveAnymarketToken(clientId)

  await Promise.all(
    alvos.map(async (attr) => {
      try {
        attr.allowedValues = await fetchVariationValues(token, attr.typeId)
      } catch (err) {
        console.warn(`[CategoryAttributes] Valores do atributo "${attr.name}" (typeId ${attr.typeId}) indisponíveis: ${err.message}`)
        attr.allowedValues = null
        attr.valuesError = err.message
      }
    })
  )
}

// ── Validação e gravação por produto ───────────────────────────────────────────

/**
 * O produto tem tudo que os canais exigem para esta categoria?
 *
 * Um resultado por canal, porque a resposta é diferente por canal — e é justamente
 * essa diferença que o operador não consegue ver no painel sem abrir uma tela por
 * marketplace.
 */
export async function validateProductAttributes(
  clientId,
  { productId, anymarketCategoryId = null, marketplaces = null, refresh = false } = {}
) {
  if (!productId) {
    throw new CategoryAttributesError('productId é obrigatório.', { status: 400, code: 'missing_product' })
  }

  const token = await resolveAnymarketToken(clientId)
  const product = await fetchProduct(token, productId)

  const categoryId = assertCategoryId(anymarketCategoryId ?? product?.category?.id)
  const filled = normalizeProductCharacteristics(product)

  let byChannel = []
  let syncedAt = new Date().toISOString()

  const canais = marketplaces?.length
    ? marketplaces.map((mp) => assertMarketplace(mp))
    : []

  if (canais.length > 0) {
    byChannel = await Promise.all(
      canais.map(async (marketplace) => {
        try {
          const res = await getCategoryAttributes(clientId, categoryId, { marketplace, refresh })
          const attributes = res.attributes ?? []
          const missing = missingRequiredAttributes(attributes, filled)
          return {
            marketplace,
            requiredCount: attributes.filter((attr) => attr.required).length,
            missing,
            ok: missing.length === 0,
          }
        } catch (err) {
          console.warn(`[CategoryAttributes] Falha ao validar canal ${marketplace}: ${err.message}`)
          return {
            marketplace,
            requiredCount: 0,
            missing: [],
            ok: true,
          }
        }
      })
    )
  } else {
    const conta = await loadAccountAttributes(clientId, { refresh })
    syncedAt = conta.syncedAt
    const byMarketplace = conta.byCategory[categoryId] ?? {}
    const alvos = Object.keys(byMarketplace).filter((key) => key !== ALL_CHANNELS).sort()
    const list = alvos.length ? alvos : [ALL_CHANNELS]
    byChannel = list.map((marketplace) => {
      const attributes = attributesForMarketplace(byMarketplace, marketplace)
      const missing = missingRequiredAttributes(attributes, filled)
      return {
        marketplace: marketplace === ALL_CHANNELS ? null : marketplace,
        requiredCount: attributes.filter((attr) => attr.required).length,
        missing,
        ok: missing.length === 0,
      }
    })
  }

  return {
    productId: String(productId),
    anymarketCategoryId: categoryId,
    filled,
    byChannel,
    ok: byChannel.every((channel) => channel.ok),
    syncedAt,
    // Aviso explícito do limite da API: passar por aqui não garante publicação.
    caveat:
      'Só a obrigatoriedade estática é verificável pela API. Regra condicional (atributo exigido só em certas combinações) aparece apenas como erro de transmissão.',
  }
}

/**
 * Grava valores de atributo no produto (§2).
 *
 * `updates` = `[{ name, value }]`. O índice é resolvido por
 * `buildCharacteristicsPatch` a partir do que o produto já tem.
 */
export async function saveProductAttributes(clientId, { productId, updates, dryRun = false }, { userId = 'desconhecido' } = {}) {
  if (!productId) {
    throw new CategoryAttributesError('productId é obrigatório.', { status: 400, code: 'missing_product' })
  }
  if (!Array.isArray(updates) || !updates.length) {
    throw new CategoryAttributesError('Nenhum atributo enviado para gravação.', { status: 400, code: 'empty_updates' })
  }

  const token = await resolveAnymarketToken(clientId)
  const product = await fetchProduct(token, productId)
  const characteristics = buildCharacteristicsPatch(product?.characteristics, updates)

  const result = await patchProductCharacteristics(token, productId, characteristics, { dryRun })

  if (!isTestClient(clientId)) {
    try {
      await db
        .collection('clients')
        .doc(clientId)
        .collection(PRODUCT_VALUES)
        .doc(String(productId))
        .set(
          {
            productId: String(productId),
            anymarketCategoryId: product?.category?.id ? String(product.category.id) : null,
            characteristics,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
    } catch (err) {
      console.warn(`[CategoryAttributes] Aviso ao espelhar valores do produto ${productId}: ${err.message}`)
    }
  }

  return { productId: String(productId), characteristics, dryRun: Boolean(result?.dryRun) }
}

/**
 * Preenche e sugere valores para os atributos da categoria usando IA (LLM).
 * Baseia-se no título, descrição e características do produto.
 */
export async function extractProductAttributesWithAI(
  clientId,
  {
    productId = null,
    title = null,
    description = null,
    characteristics = null,
    attributes = [],
    scope = 'all',
  } = {}
) {
  let targetAttributes = attributes
  if (scope === 'required') {
    targetAttributes = attributes.filter((a) => Boolean(a.required))
  } else if (scope === 'optional') {
    targetAttributes = attributes.filter((a) => !a.required)
  }

  if (!Array.isArray(targetAttributes) || !targetAttributes.length) {
    return { extracted: [] }
  }

  let prodTitle = title
  let prodDescription = description
  let prodCharacteristics = characteristics

  // Se título ou descrição não foram fornecidos diretamente, busca do produto no AnyMarket
  if ((!prodTitle || !prodDescription) && productId && !isTestClient(clientId)) {
    try {
      const token = await resolveAnymarketToken(clientId)
      const prod = await fetchProduct(token, productId)
      prodTitle ||= prod?.title ?? ''
      prodDescription ||= prod?.description ?? ''
      prodCharacteristics ||= prod?.characteristics ?? []
    } catch (err) {
      console.warn(`[CategoryAttributes] Não foi possível buscar dados adicionais do produto ${productId}: ${err.message}`)
    }
  }

  // Prepara especificação enxuta dos atributos para orientar o LLM
  const attributesSpec = targetAttributes.map((attr) => ({
    name: attr.name,
    codeInMarketPlace: attr.codeInMarketPlace || undefined,
    required: Boolean(attr.required),
    valueType: attr.valueType || 'TEXT',
    allowedValues: Array.isArray(attr.allowedValues)
      ? attr.allowedValues
          .map((v) => (typeof v === 'object' ? (v.value ?? v.name ?? v.description ?? v.id) : v))
          .filter(Boolean)
      : undefined,
  }))

  const systemPrompt = `Você é um especialista em e-commerce, catálogo técnico e marketplaces (ex: Mercado Livre, Shopee, Magalu).
Sua missão é analisar os dados do produto (título, descrição e características brutas) e extrair/inferir os valores correspondentes para a lista de atributos da categoria.

DIRETRIZES FUNDAMENTAIS:
1. Analise o TÍTULO, DESCRIÇÃO e CARACTERÍSTICAS fornecidos.
2. Para cada atributo da lista:
   - Se houver 'allowedValues', você DEVE escolher EXATAMENTE uma das opções da lista de allowedValues. Não invente opções novas.
   - Se 'valueType' for 'BOOLEAN', retorne "true" ou "false" (ou "Sim" / "Não" se fizer parte de allowedValues).
   - Se 'valueType' for 'NUMBER', retorne apenas o número (ou número com unidade se requisitado).
   - Para texto livre ('TEXT'), forneça a informação de forma concisa e direta.
3. Se a informação NÃO estiver presente e NÃO puder ser deduzida com alta certeza a partir do texto ou padrão do produto, NÃO INVENTE: omita o atributo da lista ou deixe o valor vazio.
4. Dê atenção especial e priorize os atributos OBRIGATÓRIOS (required: true).`

  const userMessage = `DADOS DO PRODUTO:
Título: ${prodTitle || '(não informado)'}
Descrição: ${prodDescription || '(não informada)'}
Características Brutas: ${typeof prodCharacteristics === 'string' ? prodCharacteristics : JSON.stringify(prodCharacteristics || [])}

ATRIBUTOS A SEREM PREENCHIDOS:
${JSON.stringify(attributesSpec, null, 2)}`

  const jsonSchema = {
    name: 'extracted_attributes',
    schema: {
      type: 'object',
      properties: {
        extracted: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['name', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['extracted'],
      additionalProperties: false,
    },
  }

  try {
    const result = await generateStructured({
      systemPrompt,
      userMessage,
      jsonSchema,
      model: 'gpt-4o-mini',
      temperature: 0.1,
    })

    const extracted = (result?.extracted ?? []).filter(
      (item) => item?.name && String(item?.value ?? '').trim() !== ''
    )

    return { extracted }
  } catch (err) {
    console.error('[CategoryAttributes] Erro ao extrair atributos com IA:', err)
    throw new CategoryAttributesError(`Falha ao preencher atributos com IA: ${err.message}`, {
      status: 500,
      code: 'ai_extraction_failed',
    })
  }
}

/** Repassado às rotas: erro da API do AnyMarket não vira 500 genérico. */
export const isAnymarketError = (err) => err instanceof AnymarketApiError
