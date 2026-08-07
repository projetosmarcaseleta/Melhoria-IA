import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { chunkMarkdown, generateEmbedding } from '../services/ragService.js'

const router = Router()

/**
 * POST /api/knowledge/:clientId
 * Cadastra um novo documento .md para o cliente, realiza chunking e gera embeddings.
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
      createdAt: FieldValue.serverTimestamp(),
    }

    await docRef.set(docData)

    // 2. Realizar chunking do Markdown
    const chunks = chunkMarkdown(content, 800, 100)

    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Nenhum conteúdo válido encontrado no arquivo.' })
    }

    // 3. Gerar embeddings e gravar chunks em batch
    const chunksCollection = db.collection('clients').doc(clientId).collection('knowledge_chunks')
    const batch = db.batch()
    let chunkCount = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]
      const embedding = await generateEmbedding(chunkText)

      const chunkRef = chunksCollection.doc()
      batch.set(chunkRef, {
        docId,
        filename,
        chunkIndex: i,
        content: chunkText,
        embedding,
        createdAt: FieldValue.serverTimestamp(),
      })
      chunkCount++
    }

    await batch.commit()

    // Atualizar documento com contagem de chunks
    await docRef.update({ chunkCount })

    return res.status(201).json({
      id: docId,
      filename,
      chunkCount,
      message: `Documento "${filename}" processado com sucesso! ${chunkCount} chunks indexados.`,
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
 * DELETE /api/knowledge/:clientId/:docId
 * Remove um documento .md e todos os seus chunks associados.
 */
router.delete('/:clientId/:docId', async (req, res, next) => {
  try {
    const { clientId, docId } = req.params

    // 1. Remover chunks do documento
    const chunksSnapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('knowledge_chunks')
      .where('docId', '==', docId)
      .get()

    const batch = db.batch()
    chunksSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref)
    })

    // 2. Remover o documento principal
    const docRef = db.collection('clients').doc(clientId).collection('knowledge_docs').doc(docId)
    batch.delete(docRef)

    await batch.commit()

    return res.json({ ok: true, message: 'Documento e chunks removidos com sucesso.' })
  } catch (err) {
    next(err)
  }
})

export default router
