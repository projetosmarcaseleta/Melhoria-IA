import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  approveProposal,
  rejectProposal,
  attachCategory,
  attachCategoryBatch,
  undoAttachment,
  listAttachments,
  getCategoryConfig,
  buildCandidateShortlist,
  proposalIdFromPath,
  isAlreadyInCategory,
} from '../services/categoryService.js'
import { saveMockCategoryProposal, resetMockCategoryState, TEST_CLIENT_ID, getMockCategoryTree } from '../services/mockStorage.js'
import { buildTree } from '../services/categoryTreeService.js'
import { categoryTreeCache } from '../services/categoryTreeCache.js'
import { matchPath } from '../services/categoryMatcher.js'
import { profileTree, suggestMaxDepth, buildProfilePromptBlock } from '../services/categoryTreeProfiler.js'
import { isClientLevelError } from '../routes/categories.js'
import { AnymarketApiError } from '../services/anymarketClient.js'

const CLIENT = TEST_CLIENT_ID

/** Monta a proposta como o suggest montaria, sem depender do LLM. */
function seedProposal(path, extras = {}) {
  const nodes = buildTree(getMockCategoryTree())
  const match = matchPath({ path, nodes })
  const id = proposalIdFromPath(match.resolvedPath)

  return saveMockCategoryProposal(CLIENT, id, {
    id,
    pathKey: match.pathKey,
    proposedPath: match.resolvedPath,
    reusedPrefix: match.reusedPrefix,
    missingTail: match.missingTail.map((n) => ({ ...n, priceFactor: 1, definitionPriceScope: 'SKU' })),
    rejectedCandidates: match.rejectedCandidates,
    globalSimilar: match.globalSimilar,
    createsNewRoot: match.createsNewRoot,
    fullyExisting: match.fullyExisting,
    leafCategoryId: match.leafCategoryId,
    productIds: ['12345'],
    confidence: 0.9,
    status: match.fullyExisting ? 'auto_resolved' : 'pending_approval',
    createdCategoryIds: [],
    updatedAt: new Date().toISOString(),
    ...extras,
  })
}

describe('categoryService — configuração e opt-in', () => {
  it('a conta de teste vem habilitada e com os padrões do catálogo', async () => {
    const { isActive, config, thresholds } = await getCategoryConfig(CLIENT)

    assert.equal(isActive, true)
    assert.equal(config.attachMode, 'confirm_each')
    assert.equal(config.onlyWhenEmpty, false, 'decisão D1: substitui, não apenas preenche vazio')
    assert.equal(config.allowNewRoot, 'confirm')
    assert.equal(thresholds.fuzzy, 0.88)
  })

  it('proposalIdFromPath não deve conter barra (id de documento do Firestore)', () => {
    const id = proposalIdFromPath(['Automotivo', 'Acessorios', 'Tapetes'])
    assert.ok(!id.includes('/'))
    assert.equal(id, proposalIdFromPath(['Automotivo', 'Acessorios', 'Tapetes']))
  })
})

describe('categoryService — aprovação (criação da cauda)', () => {
  beforeEach(() => {
    resetMockCategoryState()
    categoryTreeCache.clear()
  })

  it('deve criar só a cauda faltante e devolver a folha', async () => {
    const proposal = seedProposal(['Automotivo', 'Acessorios', 'Tapetes'])
    assert.equal(proposal.missingTail.length, 1)

    const result = await approveProposal(CLIENT, proposal.id, { userId: 'op-1' })

    assert.equal(result.status, 'created')
    assert.equal(result.createdCategoryIds.length, 1, 'apenas Tapetes deveria ser criado')
    assert.equal(result.leafCategoryId, result.createdCategoryIds[0])
    assert.equal(result.reusedPrefix.length, 2, 'Automotivo e Acessorios já existiam')
  })

  it('deve ser idempotente: aprovar duas vezes não cria de novo', async () => {
    const proposal = seedProposal(['Automotivo', 'Acessorios', 'Tapetes'])
    const primeira = await approveProposal(CLIENT, proposal.id, { userId: 'op-1' })
    const segunda = await approveProposal(CLIENT, proposal.id, { userId: 'op-1' })

    assert.equal(segunda.alreadyCreated, true)
    assert.deepEqual(segunda.createdCategoryIds, primeira.createdCategoryIds)
  })

  it('não deve criar nada quando o caminho inteiro já existe', async () => {
    const proposal = seedProposal(['Automotivo', 'Acessorios'])

    assert.equal(proposal.fullyExisting, true)
    assert.equal(proposal.status, 'auto_resolved', 'caminho existente não entra na fila de aprovação')

    const result = await approveProposal(CLIENT, proposal.id, { userId: 'op-1' })
    assert.equal(result.leafCategoryId, '1002')
    assert.deepEqual(result.createdCategoryIds ?? [], [])
  })

  it('deve exigir confirmação extra para criar DEPARTAMENTO novo', async () => {
    const proposal = seedProposal(['Petshop', 'Racoes'])
    assert.equal(proposal.createsNewRoot, true)

    await assert.rejects(
      () => approveProposal(CLIENT, proposal.id, { userId: 'op-1' }),
      (err) => err.code === 'new_root_confirmation_required'
    )

    const result = await approveProposal(CLIENT, proposal.id, { userId: 'op-1', confirmNewRoot: true })
    assert.equal(result.status, 'created')
    assert.equal(result.createdCategoryIds.length, 2)
  })

  it('deve respeitar o teto de nós novos por aprovação', async () => {
    const proposal = seedProposal(['Automotivo', 'Acessorios', 'Tapetes'])
    saveMockCategoryProposal(CLIENT, proposal.id, {
      ...proposal,
      proposedPath: ['Automotivo', 'Acessorios', 'Tapetes', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    })

    await assert.rejects(
      () => approveProposal(CLIENT, proposal.id, { userId: 'op-1' }),
      (err) => err.code === 'max_new_nodes_exceeded'
    )
  })

  it('deve recusar proposta inexistente', async () => {
    await assert.rejects(
      () => approveProposal(CLIENT, 'nao-existe', {}),
      (err) => err.status === 404
    )
  })

  it('rejeitar deve mudar o status sem criar nada', async () => {
    const proposal = seedProposal(['Automotivo', 'Acessorios', 'Tapetes'])
    const result = await rejectProposal(CLIENT, proposal.id, { userId: 'op-1', reason: 'categoria errada' })

    assert.equal(result.status, 'rejected')
    assert.deepEqual(result.createdCategoryIds, [])
  })
})

describe('categoryService — vínculo ao produto (substituição)', () => {
  beforeEach(() => {
    resetMockCategoryState()
    categoryTreeCache.clear()
  })

  it('deve SUBSTITUIR a categoria atual e guardar a anterior', async () => {
    const record = await attachCategory(CLIENT, { productId: '12345', categoryId: '1012', userId: 'op-1' })

    assert.equal(record.status, 'applied')
    assert.equal(record.previousCategory.id, '1002', 'a categoria anterior tem de ficar registrada')
    assert.equal(record.newCategory.id, '1012')
  })

  it('deve pular quando o produto já está na categoria de destino', async () => {
    const record = await attachCategory(CLIENT, { productId: '12345', categoryId: '1002', userId: 'op-1' })

    assert.equal(record.skipped, true)
    assert.equal(record.reason, 'same_category')
  })

  it('deve desfazer devolvendo o produto à categoria anterior', async () => {
    const record = await attachCategory(CLIENT, { productId: '12345', categoryId: '1012', userId: 'op-1' })
    const undone = await undoAttachment(CLIENT, record.id, { userId: 'op-1' })

    assert.equal(undone.status, 'undone')
    assert.equal(undone.previousCategory.id, '1002')
  })

  it('desfazer duas vezes não deve repetir a operação', async () => {
    const record = await attachCategory(CLIENT, { productId: '12345', categoryId: '1012', userId: 'op-1' })
    await undoAttachment(CLIENT, record.id, {})
    const segunda = await undoAttachment(CLIENT, record.id, {})

    assert.equal(segunda.alreadyUndone, true)
  })

  it('deve registrar cada vínculo para auditoria', async () => {
    await attachCategory(CLIENT, { productId: '12345', categoryId: '1012', userId: 'op-1' })
    await attachCategory(CLIENT, { productId: '99999', categoryId: '1012', userId: 'op-1' })

    assert.equal((await listAttachments(CLIENT, {})).length, 2)
    assert.equal((await listAttachments(CLIENT, { productId: '12345' })).length, 1)
  })

  it('lote deve respeitar o teto e contabilizar os produtos que ficaram fora', async () => {
    const ids = new Array(60).fill(null).map((_, i) => `p-${i}`)
    const result = await attachCategoryBatch(CLIENT, { productIds: ids, categoryId: '1012', userId: 'op-1' })

    assert.equal(result.skippedByCap, 10, 'teto padrão é 50 por lote')
    assert.equal(result.applied, 50)
  })
})

describe('categoryService — contexto do prompt', () => {
  it('shortlist deve priorizar caminhos com termos do produto e devolver as raízes', () => {
    const nodes = buildTree(getMockCategoryTree())
    const { roots, candidates } = buildCandidateShortlist({ title: 'Tapete de borracha para carro', description: '' }, nodes)

    assert.ok(roots.length > 0, 'raízes vão sempre: nível 0 é universo fechado')
    assert.ok(candidates.some((n) => n.fullPath.includes('Tapete')))
    assert.ok(candidates.every((n) => n.parentId), 'a shortlist é de caminhos, não de raízes')
  })

  it('perfil deve extrair raízes, profundidade e vocabulário da árvore do cliente', () => {
    const nodes = buildTree(getMockCategoryTree())
    const profile = profileTree(nodes)

    assert.ok(profile.rootNames.includes('Automotivo'))
    assert.ok(profile.nodeCount > 0)
    assert.ok(suggestMaxDepth(profile) >= 2 && suggestMaxDepth(profile) <= 5)
    assert.ok(
      profile.genericNodesPresent.some((n) => n.fullPath === 'Outros'),
      'nó genérico existente deve ser reportado'
    )

    const bloco = buildProfilePromptBlock(profile)
    assert.ok(bloco.includes('Automotivo'))
    assert.ok(bloco.includes('Profundidade máxima permitida'))
  })
})

describe('rotas de categoria — propagação de erro de cliente', () => {
  it('erro de cliente deve subir com o código, não virar erro de produto', () => {
    // Regressão: o catch por produto no /suggest transformava "árvore não
    // sincronizada" em erro daquele produto, e a UI perdia o `code` — sem code,
    // o modal não sabe que deve oferecer o botão de sincronizar.
    assert.equal(isClientLevelError({ code: 'tree_not_synced' }), true)
    assert.equal(isClientLevelError({ code: 'skill_inactive' }), true)
    assert.equal(isClientLevelError({ resumable: true }), true)
    assert.equal(isClientLevelError(new AnymarketApiError('sem token', { status: 400 })), true)
    assert.equal(isClientLevelError(new AnymarketApiError('não autorizado', { status: 401 })), true)
  })

  it('falha de um produto não deve interromper o lote', () => {
    assert.equal(isClientLevelError(new Error('LLM devolveu caminho vazio')), false)
    assert.equal(isClientLevelError({ code: 'empty_path' }), false)
    assert.equal(isClientLevelError(new AnymarketApiError('produto inexistente', { status: 404 })), false)
    assert.equal(isClientLevelError(new AnymarketApiError('erro interno', { status: 500 })), false)
  })
})

describe('categoryService — produto já na categoria sugerida', () => {
  it('deve comparar por ID, não por texto do caminho', () => {
    // Caso real: a API devolve o caminho atual com barra e a árvore monta com seta.
    // Comparar string diria "diferente" para a mesma categoria.
    const atual = { id: '4009244', name: 'BATERIA COMUM', fullPath: 'PILHAS E BATERIAS/BATERIA COMUM' }

    assert.equal(isAlreadyInCategory(atual, '4009244'), true)
    assert.equal(isAlreadyInCategory(atual, '9999999'), false)
  })

  it('deve tolerar id numérico da API contra id string da árvore', () => {
    assert.equal(isAlreadyInCategory({ id: 4009244 }, '4009244'), true)
    assert.equal(isAlreadyInCategory({ id: '4009244' }, 4009244), true)
  })

  it('produto sem categoria ou caminho a criar não conta como já classificado', () => {
    assert.equal(isAlreadyInCategory(null, '4009244'), false)
    assert.equal(isAlreadyInCategory({ id: null }, '4009244'), false)
    // leafCategoryId null = há cauda para criar, então não existe folha ainda.
    assert.equal(isAlreadyInCategory({ id: '4009244' }, null), false)
    assert.equal(isAlreadyInCategory({ id: '4009244' }, undefined), false)
  })
})
