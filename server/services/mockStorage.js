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

