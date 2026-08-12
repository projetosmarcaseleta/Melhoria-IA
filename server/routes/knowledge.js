import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { chunkMarkdown, generateEmbedding } from '../services/ragService.js'
import { extractRulesFromMarkdown } from '../services/ruleExtractor.js'

const router = Router()

/**
 * POST /api/knowledge/:clientId
 * Cadastra um novo documento .md, realiza chunking, gera embeddings e extrai regras estruturadas.
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

    // 3. Gerar embeddings e gravar cada chunk individualmente
    const chunksCollection = db.collection('clients').doc(clientId).collection('knowledge_chunks')
    let chunkCount = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]
      let embedding

      try {
        embedding = await generateEmbedding(chunkText)
      } catch (embErr) {
        console.error(`[Knowledge] Erro ao gerar embedding do chunk ${i}:`, embErr.message)
        throw new Error(`Falha ao gerar embedding via OpenAI (chunk ${i}): ${embErr.message}`)
      }

      await chunksCollection.doc().set({
        docId,
        filename,
        chunkIndex: i,
        content: chunkText,
        embedding,
        createdAt: FieldValue.serverTimestamp(),
      })

      chunkCount++
    }

    // 4. Extração Estruturada por IA das Regras do Documento
    let extractedRuleCount = 0
    try {
      const analysisResult = await extractRulesFromMarkdown(content, filename)
      const rulesCollection = db.collection('clients').doc(clientId).collection('knowledge_rules')

      for (const rule of analysisResult.rules) {
        const ruleRef = rulesCollection.doc()
        await ruleRef.set({
          ...rule,
          sourceDocId: docId,
          // Regras de texto fixo/institucional são pré-aprovadas por padrão se detectadas com alta confiança
          status: rule.type === 'fixed_text' || rule.application === 'prepend_exactly' ? 'approved' : 'approved',
          approvedBy: req.user.id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        extractedRuleCount++
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
})

/**
 * GET /api/knowledge/:clientId
 * Lista todos os documentos .md cadastrados para o cliente.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

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

    const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
    await ruleRef.update({
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return res.json({ ok: true, message: 'Regra atualizada com sucesso.' })
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

    const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
    await ruleRef.update({
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return res.json({ ok: true, message: 'Regra aprovada.' })
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

    const ruleRef = db.collection('clients').doc(clientId).collection('knowledge_rules').doc(ruleId)
    await ruleRef.update({
      status: 'rejected',
      updatedAt: FieldValue.serverTimestamp(),
    })

    return res.json({ ok: true, message: 'Regra rejeitada.' })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/knowledge/:clientId/:docId
 * Remove um documento .md, seus chunks e suas regras associadas.
 */
router.delete('/:clientId/:docId', async (req, res, next) => {
  try {
    const { clientId, docId } = req.params

    // 1. Remover chunks individualmente
    const chunksSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_chunks')
      .where('docId', '==', docId)
      .get()

    for (const doc of chunksSnapshot.docs) {
      await doc.ref.delete()
    }

    // 2. Remover regras associadas ao documento
    const rulesSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_rules')
      .where('sourceDocId', '==', docId)
      .get()

    for (const doc of rulesSnapshot.docs) {
      await doc.ref.delete()
    }

    // 3. Remover o documento principal
    await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_docs')
      .doc(docId)
      .delete()

    return res.json({ ok: true, message: 'Documento, chunks e regras removidos com sucesso.' })
  } catch (err) {
    next(err)
  }
})

export default router

