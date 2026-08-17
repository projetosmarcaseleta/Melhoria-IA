import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { chunkMarkdown, generateEmbedding } from '../services/ragService.js'
import { extractRulesFromMarkdown } from '../services/ruleExtractor.js'
import { promptCache } from '../services/promptCache.js'

const router = Router()

/**
 * POST /api/knowledge/:clientId
 * Cadastra um novo documento .md, realiza chunking, gera embeddings em paralelo e extrai regras estruturadas.
 * Body: { filename: string, content: string }
 */
router.post('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { filename, content } = req.body ?? {}

    if (!filename || !content) {
      return res.status(400).json({ error: 'filename e content são obrigatórios.' })
    }

    // 1. Criar o documento na subcoleção do cliente
    const docRef = db.collection('clients').doc(clientId).collection('knowledge_docs').doc()
    const docId = docRef.id

    const docData = {
      filename,
      charCount: content.length,
      uploadedBy: req.user.id,
      analysisStatus: 'processing',
      createdAt: FieldValue.serverTimestamp(),
    }

    await docRef.set(docData)

    // 2. Realizar chunking do Markdown
    const chunks = chunkMarkdown(content, 800, 100)

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Nenhum conteúdo válido encontrado no arquivo.' })
    }

    // 3. Gerar embeddings em paralelo e persistir chunks via batch
    const chunksCollection = db.collection('clients').doc(clientId).collection('knowledge_chunks')
    
    // Gerar embeddings com concorrência
    const embeddings = await Promise.all(
      chunks.map((chunkText, i) =>
        generateEmbedding(chunkText).catch((embErr) => {
          console.error(`[Knowledge] Erro embedding chunk ${i}:`, embErr.message)
          throw new Error(`Falha ao gerar embedding via OpenAI (chunk ${i}): ${embErr.message}`)
        })
      )
    )

    const chunksBatch = db.batch()
    for (let i = 0; i < chunks.length; i++) {
      const chunkRef = chunksCollection.doc()
      chunksBatch.set(chunkRef, {
        docId,
        filename,
        chunkIndex: i,
        content: chunks[i],
        embedding: embeddings[i],
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    await chunksBatch.commit()
    const chunkCount = chunks.length

    // 4. Extração Estruturada por IA das Regras do Documento
    let extractedRuleCount = 0
    try {
      const analysisResult = await extractRulesFromMarkdown(content, filename)
      const rulesCollection = db.collection('clients').doc(clientId).collection('knowledge_rules')
      const rulesBatch = db.batch()

      for (const rule of analysisResult.rules) {
        const ruleRef = rulesCollection.doc()
        rulesBatch.set(ruleRef, {
          ...rule,
          sourceDocId: docId,
          status: 'approved',
          approvedBy: req.user.id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        extractedRuleCount++
      }

      if (extractedRuleCount > 0) {
        await rulesBatch.commit()
      }

      await docRef.update({
        chunkCount,
        analysisStatus: 'approved',
        summary: analysisResult.summary,
        documentPurposes: analysisResult.documentPurposes,
        ruleCount: extractedRuleCount,
      })
    } catch (analysisErr) {
      console.warn('[Knowledge] Aviso na extração de regras:', analysisErr.message)
      await docRef.update({ chunkCount, analysisStatus: 'review_required' })
    }

    // Invalidar cache de prompt do cliente
    promptCache.invalidateClient(clientId)

    return res.status(201).json({
      id: docId,
      filename,
      chunkCount,
      ruleCount: extractedRuleCount,
      message: `Documento "${filename}" indexado com sucesso! ${chunkCount} chunks e ${extractedRuleCount} regras extraídas.`,
    })
  } catch (err) {
    next(err)
  }
})t(err)
  }
})

import {
  isTestClient,
  getMockKnowledgeDocs,
  getMockRules,
  saveMockRule,
  updateMockRule,
  deleteMockKnowledgeDoc,
} from '../services/mockStorage.js'

/**
 * GET /api/knowledge/:clientId
 * Lista todos os documentos .md cadastrados para o cliente.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    if (isTestClient(clientId)) {
      return res.json(getMockKnowledgeDocs(clientId))
    }

    try {
      const snapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_docs')
        .get()

      const docs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      return res.json(docs)
    } catch (err) {
      console.warn('[KnowledgeDocs] Aviso Firestore:', err.message)
      return res.json(getMockKnowledgeDocs(clientId))
    }
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/knowledge/:clientId/rules
 * Lista todas as regras estruturadas do cliente.
 */
router.get('/:clientId/rules', async (req, res, next) => {
  try {
    const { clientId } = req.params

    if (isTestClient(clientId)) {
      return res.json(getMockRules(clientId, false))
    }

    try {
      const snapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_rules')
        .get()

      const rules = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      return res.json(rules)
    } catch (err) {
      console.warn('[KnowledgeRules] Aviso Firestore:', err.message)
      return res.json(getMockRules(clientId, false))
    }
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/knowledge/:clientId/rules/:ruleId
 * Atualiza uma regra estruturada do cliente.
 */
router.put('/:clientId/rules/:ruleId', async (req, res, next) => {
  try {
    const { clientId, ruleId } = req.params
    const updates = req.body ?? {}

    promptCache.invalidateClient(clientId)

    if (isTestClient(clientId) || ruleId.startsWith('rule-teste')) {
      const updated = updateMockRule(ruleId, updates)
      return res.json({ ok: true, message: 'Regra atualizada com sucesso.', rule: updated })
    }

    try {
      const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
      await ruleRef.update({
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      })

      return res.json({ ok: true, message: 'Regra atualizada com sucesso.' })
    } catch (err) {
      console.warn('[RulePut] Aviso Firestore:', err.message)
      const updated = updateMockRule(ruleId, updates)
      return res.json({ ok: true, message: 'Regra atualizada em modo de contingência.', rule: updated })
    }
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/knowledge/:clientId/rules/:ruleId/approve
 * Aprova uma regra estruturada do cliente.
 */
router.post('/:clientId/rules/:ruleId/approve', async (req, res, next) => {
  try {
    const { clientId, ruleId } = req.params
    promptCache.invalidateClient(clientId)

    if (isTestClient(clientId) || ruleId.startsWith('rule-teste')) {
      updateMockRule(ruleId, { status: 'approved', approvedBy: req.user?.id })
      return res.json({ ok: true, message: 'Regra aprovada.' })
    }

    try {
      const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
      await ruleRef.update({
        status: 'approved',
        approvedBy: req.user.id,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      return res.json({ ok: true, message: 'Regra aprovada.' })
    } catch (err) {
      updateMockRule(ruleId, { status: 'approved', approvedBy: req.user?.id })
      return res.json({ ok: true, message: 'Regra aprovada em contingência.' })
    }
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/knowledge/:clientId/rules/:ruleId/reject
 * Rejeita uma regra estruturada do cliente.
 */
router.post('/:clientId/rules/:ruleId/reject', async (req, res, next) => {
  try {
    const { clientId, ruleId } = req.params
    promptCache.invalidateClient(clientId)

    if (isTestClient(clientId) || ruleId.startsWith('rule-teste')) {
      updateMockRule(ruleId, { status: 'rejected' })
      return res.json({ ok: true, message: 'Regra rejeitada.' })
    }

    try {
      const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
      await ruleRef.update({
        status: 'rejected',
        updatedAt: FieldValue.serverTimestamp(),
      })

      return res.json({ ok: true, message: 'Regra rejeitada.' })
    } catch (err) {
      updateMockRule(ruleId, { status: 'rejected' })
      return res.json({ ok: true, message: 'Regra rejeitada em contingência.' })
    }
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/knowledge/:clientId/:docId
 * Remove um documento .md, seus chunks e suas regras associadas usando lote (batch).
 */
router.delete('/:clientId/:docId', async (req, res, next) => {
  try {
    const { clientId, docId } = req.params
    promptCache.invalidateClient(clientId)

    if (isTestClient(clientId) || docId.startsWith('doc-teste')) {
      deleteMockKnowledgeDoc(clientId, docId)
      return res.json({ ok: true, message: 'Documento de teste removido com sucesso.' })
    }

    try {
      const deleteBatch = db.batch()

      // 1. Chunks associados
      const chunksSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_chunks')
        .where('docId', '==', docId)
        .get()

      chunksSnapshot.docs.forEach((d) => deleteBatch.delete(d.ref))

      // 2. Regras associadas
      const rulesSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_rules')
        .where('sourceDocId', '==', docId)
        .get()

      rulesSnapshot.docs.forEach((d) => deleteBatch.delete(d.ref))

      // 3. Documento principal
      const docRef = db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_docs')
        .doc(docId)

      deleteBatch.delete(docRef)

      await deleteBatch.commit()

      return res.json({ ok: true, message: 'Documento, chunks e regras removidos com sucesso.' })
    } catch (err) {
      deleteMockKnowledgeDoc(clientId, docId)
      return res.json({ ok: true, message: 'Documento removido em contingência.' })
    }
  } catch (err) {
    next(err)
  }
})

export default router

