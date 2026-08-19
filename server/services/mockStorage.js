/**
 * Módulo de Mock / Armazenamento em Memória para a conta 'Teste - Marca Seleta'
 * Permite que a conta de teste funcione de forma 100% autônoma, sem depender do Firebase Firestore/Auth.
 * Também serve como contingência caso o Firebase atinja limites de cota diária (RESOURCE_EXHAUSTED).
 */

export const TEST_CLIENT_ID = 'teste-marca-seleta'

export const TEST_CLIENT = {
  id: TEST_CLIENT_ID,
  name: 'Teste - Marca Seleta',
  slug: 'teste-marca-seleta',
  anymarket_token: 'test-token-marca-seleta',
  isActive: true,
  settings: {
    ai_provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 1.0,
    max_description_length: 2000,
    max_title_length: 60,
  },
  isMock: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export const TEST_OPERATOR = {
  id: 'test-operator-id',
  email: 'teste@marcaseleta.com.br',
  name: 'Operador Teste (Marca Seleta)',
  role: 'admin',
}

// ── In-Memory Store ────────────────────────────────────────────────────────
const mockStore = {
  clients: new Map([[TEST_CLIENT_ID, { ...TEST_CLIENT }]]),
  prompts: new Map(),
  skills: new Map(),
  knowledge_docs: new Map(),
  knowledge_chunks: new Map(),
  knowledge_rules: new Map(),
  generations: new Map(),
  operators: new Map([[TEST_OPERATOR.id, { ...TEST_OPERATOR }]]),
}

// Popular regras e conhecimentos iniciais de teste
const initialDocId = 'doc-teste-marca-seleta-1'
mockStore.knowledge_docs.set(initialDocId, {
  id: initialDocId,
  clientId: TEST_CLIENT_ID,
  filename: 'manual-marca-seleta-diretrizes.md',
  charCount: 1250,
  chunkCount: 2,
  ruleCount: 3,
  analysisStatus: 'approved',
  createdAt: new Date().toISOString(),
})

mockStore.knowledge_rules.set('rule-teste-1', {
  id: 'rule-teste-1',
  clientId: TEST_CLIENT_ID,
  sourceDocId: initialDocId,
  name: 'Texto Institucional Marca Seleta',
  type: 'fixed_text',
  application: 'prepend_exactly',
  priority: 'high',
  scopes: ['descricao'],
  content: '<p><strong>A Marca Seleta é referência em qualidade, design e durabilidade.</strong> Nossos produtos são desenvolvidos com materiais de alta performance para oferecer a melhor experiência.</p>',
  status: 'approved',
  createdAt: new Date().toISOString(),
})

mockStore.knowledge_rules.set('rule-teste-2', {
  id: 'rule-teste-2',
  clientId: TEST_CLIENT_ID,
  sourceDocId: initialDocId,
  name: 'Termos Proibidos Marca Seleta',
  type: 'prohibition',
  application: 'semantic_instruction',
  priority: 'critical',
  scopes: ['titulo', 'descricao'],
  content: 'promoção, oferta, grátis, barato, desconto, envio imediato, réplica, primeira linha',
  status: 'approved',
  createdAt: new Date().toISOString(),
})

mockStore.knowledge_rules.set('rule-teste-3', {
  id: 'rule-teste-3',
  clientId: TEST_CLIENT_ID,
  sourceDocId: initialDocId,
  name: 'Estrutura Obrigatória de Descrição',
  type: 'formatting',
  application: 'semantic_instruction',
  priority: 'high',
  scopes: ['descricao'],
  content: 'Usar apenas parágrafo <p> introdutório e lista <ul><li> para destaques técnicos. Não usar cabeçalhos H1/H2/H3.',
  status: 'approved',
  createdAt: new Date().toISOString(),
})

/**
 * Verifica se um clientId pertence ao ambiente de teste em memória
 */
export function isTestClient(clientId) {
  if (!clientId) return false
  const clean = String(clientId).toLowerCase().trim()
  return (
    clean === TEST_CLIENT_ID ||
    clean === 'teste' ||
    clean === 'test-client' ||
    clean === 'marcaseleta-teste' ||
    clean === 'teste-marcaseleta'
  )
}

/**
 * Retorna lista de clientes mock (incluindo Teste - Marca Seleta)
 */
export function getMockClients() {
  return Array.from(mockStore.clients.values()).filter((c) => c.isActive !== false)
}

/**
 * Retorna dados do cliente mock
 */
export function getMockClient(clientId = TEST_CLIENT_ID) {
  return mockStore.clients.get(TEST_CLIENT_ID) || { ...TEST_CLIENT }
}

/**
 * Prompts em memória
 */
export function getMockPrompt(clientId, type) {
  return mockStore.prompts.get(`${clientId}:${type}`) || null
}

export function saveMockPrompt(clientId, type, content, userId = 'test-operator-id') {
  const current = getMockPrompt(clientId, type)
  const version = (current?.version ?? 0) + 1
  const data = {
    id: type,
    clientId,
    content,
    version,
    isActive: true,
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  }
  mockStore.prompts.set(`${clientId}:${type}`, data)
  return data
}

/**
 * Regras estruturadas em memória
 */
export function getMockRules(clientId, filterApproved = true) {
  const rules = Array.from(mockStore.knowledge_rules.values()).filter((r) => r.clientId === clientId)
  if (filterApproved) {
    return rules.filter((r) => r.status === 'approved')
  }
  return rules
}

export function saveMockRule(clientId, ruleData, userId = 'test-operator-id') {
  const id = ruleData.id || `rule-teste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const rule = {
    ...ruleData,
    id,
    clientId,
    approvedBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  mockStore.knowledge_rules.set(id, rule)
  return rule
}

export function updateMockRule(ruleId, updates) {
  const existing = mockStore.knowledge_rules.get(ruleId)
  if (!existing) return null
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() }
  mockStore.knowledge_rules.set(ruleId, updated)
  return updated
}

/**
 * Documentos de conhecimento em memória
 */
export function getMockKnowledgeDocs(clientId) {
  return Array.from(mockStore.knowledge_docs.values()).filter((d) => d.clientId === clientId)
}

export function deleteMockKnowledgeDoc(clientId, docId) {
  mockStore.knowledge_docs.delete(docId)
  // Remover regras associadas
  for (const [key, rule] of mockStore.knowledge_rules.entries()) {
    if (rule.sourceDocId === docId) {
      mockStore.knowledge_rules.delete(key)
    }
  }
  return true
}

/**
 * Skills em memória
 */
export function getMockSkills(clientId, defaultSkills = []) {
  return defaultSkills.map((def) => {
    const key = `${clientId}:${def.id}`
    const saved = mockStore.skills.get(key)
    return {
      ...def,
      isActive: saved ? saved.isActive : true, // ativas por padrão no teste
      config: saved?.config ?? def.defaultConfig,
    }
  })
}

export function saveMockSkill(clientId, skillId, data) {
  const key = `${clientId}:${skillId}`
  const entry = {
    id: skillId,
    clientId,
    ...data,
    updatedAt: new Date().toISOString(),
  }
  mockStore.skills.set(key, entry)
  return entry
}

/**
 * Gerações e Feedbacks em memória
 */
export function saveMockGeneration(genData) {
  const id = genData.id || `gen-teste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const record = {
    ...genData,
    id,
    createdAt: new Date().toISOString(),
  }
  mockStore.generations.set(id, record)
  return record
}

export function getMockGenerations(clientId, limit = 50) {
  return Array.from(mockStore.generations.values())
    .filter((g) => g.clientId === clientId)
    .slice(0, limit)
}

export function updateMockFeedback(generationId, updates, userId = 'test-operator-id') {
  const existing = mockStore.generations.get(generationId)
  const updated = {
    ...(existing || { id: generationId, clientId: TEST_CLIENT_ID }),
    ...updates,
    feedbackBy: userId,
    feedbackAt: new Date().toISOString(),
  }
  mockStore.generations.set(generationId, updated)
  return updated
}


// ── Árvore de categorias falsa do AnyMarket (cliente de teste) ──────────────
//
// Criar categoria no AnyMarket é irreversível (§P1 da especificação), então o
// cliente de teste NUNCA fala com a API real. Esta árvore é de propósito suja:
// carrega as duplicatas que o funil de dedup precisa reconhecer, além de um nó
// órfão e um nome genérico já existente.
const MOCK_CATEGORY_TREE = [
  { id: 1000, name: 'Automotivo' },
  { id: 1001, name: 'AUTOMOTIVO' },                                       // duplicata de 1000 (slugKey)
  { id: 1002, name: 'Acessorios', parent: { id: 1000 } },
  { id: 1003, name: 'Tapetes e Carpetes', parent: { id: 1002 } },
  { id: 1004, name: 'Pecas', parent: { id: 1000 } },
  { id: 1005, name: 'Acessorios Automotivos', parent: { id: 1000 } },
  { id: 1006, name: 'Automotivos Acessorios', parent: { id: 1000 } },     // duplicata de 1005 (tokenSetKey)
  { id: 1010, name: 'Casa e Decoracao' },
  { id: 1011, name: 'Cozinha', parent: { id: 1010 } },
  { id: 1012, name: 'Panelas', parent: { id: 1011 } },
  { id: 1013, name: 'Panela', parent: { id: 1011 } },                     // duplicata de 1012 (singular/plural)
  { id: 1020, name: 'Outros' },                                           // genérico que já existe
  { id: 1030, name: 'Pneus', parent: { id: 9999 } },                      // órfão: pai inexistente
  { id: 1031, name: 'Tapete Michelin 205/55', parent: { id: 1002 } },     // nome com marca e medida
]

/** Árvore de categorias em memória do cliente de teste (nunca vai à API real). */
export function getMockCategoryTree() {
  return MOCK_CATEGORY_TREE.map((node) => ({ ...node }))
}

// ── Propostas e vínculos de categoria (cliente de teste) ────────────────────
const mockCategoryProposals = new Map()
const mockAttachments = new Map()
let mockAttachmentSeq = 0

const proposalKey = (clientId, proposalId) => `${clientId}::${proposalId}`

export function saveMockCategoryProposal(clientId, proposalId, data) {
  const record = { ...data, id: proposalId, clientId }
  mockCategoryProposals.set(proposalKey(clientId, proposalId), record)
  return record
}

export function getMockCategoryProposal(clientId, proposalId) {
  return mockCategoryProposals.get(proposalKey(clientId, proposalId)) ?? null
}

export function listMockCategoryProposals(clientId, status = null) {
  return [...mockCategoryProposals.values()]
    .filter((p) => p.clientId === clientId && (!status || p.status === status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export function saveMockAttachment(clientId, record) {
  const id = record.id ?? `attach-${++mockAttachmentSeq}`
  const saved = { ...record, id, clientId }
  mockAttachments.set(`${clientId}::${id}`, saved)
  return saved
}

export function getMockAttachment(clientId, attachmentId) {
  return mockAttachments.get(`${clientId}::${attachmentId}`) ?? null
}

export function listMockAttachments(clientId, productId = null) {
  return [...mockAttachments.values()].filter(
    (a) => a.clientId === clientId && (!productId || a.productId === String(productId))
  )
}

/** Só para testes: zera propostas e vínculos em memória. */
export function resetMockCategoryState() {
  mockCategoryProposals.clear()
  mockAttachments.clear()
  mockAttachmentSeq = 0
}
