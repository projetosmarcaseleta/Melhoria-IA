import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { chunkMarkdown, generateEmbedding } from '../services/ragService.js'
import { extractRulesFromMarkdown } from '../services/ruleExtractor.js'
import { promptCache } from '../services/promptCache.js'
import { bulkDelete, bulkSet } from '../utils/firestoreBulk.js'

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

    // 0. Reenvio do MESMO arquivo substitui a versão anterior.
    //
    // Antes, cada upload criava um documento com id novo sem olhar o nome: enviar o
    // mesmo .md duas vezes deixava dois documentos idênticos na base. Isso não era só
    // sujeira de tela — o promptResolver injeta TODOS os chunks do cliente em cada
    // descrição, então a diretriz da marca entrava duplicada em todo prompt. E, na
    // exclusão, apagar um deixava o outro: o arquivo "voltava" no F5.
    let substituidos = { docs: 0, chunks: 0, rules: 0 }
    try {
      const anteriores = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_docs')
        .where('filename', '==', filename)
        .get()

      if (!anteriores.empty) {
        const refs = []
        for (const antigo of anteriores.docs) {
          const [chunksAntigos, regrasAntigas] = await Promise.all([
            db.collection('clients').doc(clientId).collection('knowledge_chunks').where('docId', '==', antigo.id).get(),
            db.collection('clients').doc(clientId).collection('knowledge_rules').where('sourceDocId', '==', antigo.id).get(),
          ])

          substituidos.chunks += chunksAntigos.size
          substituidos.rules += regrasAntigas.size
          substituidos.docs += 1

          refs.push(...chunksAntigos.docs.map((d) => d.ref), ...regrasAntigas.docs.map((d) => d.ref), antigo.ref)
        }

        await bulkDelete(db, refs)

        console.log(
          `[Knowledge] "${filename}" já existia (${substituidos.docs} versão/versões) no cliente ${clientId} — removidas ${substituidos.chunks} chunk(s) e ${substituidos.rules} regra(s) antes de gravar a nova.`
        )
      }
    } catch (err) {
      console.warn('[Knowledge] Aviso ao substituir versão anterior do documento:', err.message)
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

    // BulkWriter, não batch: cada chunk carrega um embedding de 1536 floats, então o
    // limite que estoura primeiro é o de TAMANHO da requisição (~10 MiB), não o de 500
    // operações. Um .md grande fazia o commit único falhar com
    // "Transaction too big" — e o documento ficava gravado sem os chunks.
    await bulkSet(
      db,
      chunks.map((content, i) => ({
        ref: chunksCollection.doc(),
        data: {
          docId,
          filename,
          chunkIndex: i,
          content,
          embedding: embeddings[i],
          createdAt: FieldValue.serverTimestamp(),
        },
      })),
      { merge: false }
    )
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
      replaced: substituidos,
      message:
        substituidos.docs > 0
          ? `Documento "${filename}" atualizado! ${chunkCount} chunks e ${extractedRuleCount} regras. Substituiu ${substituidos.docs} versão(ões) anterior(es) (${substituidos.chunks} chunks e ${substituidos.rules} regras antigas removidas).`
          : `Documento "${filename}" indexado com sucesso! ${chunkCount} chunks e ${extractedRuleCount} regras extraídas.`,
    })
  } catch (err) {
    next(err)
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
 * GET /api/knowledge/:clientId/diagnostico
 *
 * O que existe DE FATO no Firestore para este cliente: ids reais dos documentos,
 * contagem de chunks por docId e chunks órfãos (de documento já excluído).
 *
 * Serve para separar "não apagou" de "apagou e a tela mostra outro": se o mesmo
 * arquivo foi enviado duas vezes, existem dois documentos com o mesmo `filename` e
 * ids diferentes — apagar um deixa o outro na lista, e parece que voltou.
 */
router.get('/:clientId/diagnostico', async (req, res, next) => {
  try {
    const { clientId } = req.params

    const docsSnapshot = await db.collection('clients').doc(clientId).collection('knowledge_docs').get()
    const chunksSnapshot = await db.collection('clients').doc(clientId).collection('knowledge_chunks').select('docId').get()

    const chunksPorDoc = {}
    chunksSnapshot.docs.forEach((chunk) => {
      const docId = chunk.data().docId ?? '(sem docId)'
      chunksPorDoc[docId] = (chunksPorDoc[docId] ?? 0) + 1
    })

    const idsExistentes = new Set(docsSnapshot.docs.map((d) => d.id))
    const documentos = docsSnapshot.docs.map((d) => ({
      id: d.id,
      filename: d.data().filename ?? null,
      chunkCount: d.data().chunkCount ?? null,
      chunksReaisNoBanco: chunksPorDoc[d.id] ?? 0,
      createdAt: d.data().createdAt ?? null,
    }))

    const nomesDuplicados = Object.entries(
      documentos.reduce((acc, doc) => {
        if (doc.filename) acc[doc.filename] = (acc[doc.filename] ?? 0) + 1
        return acc
      }, {})
    )
      .filter(([, total]) => total > 1)
      .map(([filename, total]) => ({ filename, total }))

    return res.json({
      clientId,
      totalDocumentos: documentos.length,
      documentos,
      nomesDuplicados,
      chunksOrfaos: Object.entries(chunksPorDoc)
        .filter(([docId]) => !idsExistentes.has(docId))
        .map(([docId, total]) => ({ docId, chunks: total })),
    })
  } catch (err) {
    console.error('[Knowledge] Falha no diagnóstico:', err.message)
    return res.status(502).json({ error: err.message })
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

    console.log(`[Knowledge] DELETE recebido → cliente="${clientId}" doc="${docId}"`)

    if (isTestClient(clientId) || docId.startsWith('doc-teste')) {
      console.log(`[Knowledge] doc="${docId}" tratado como MOCK (isTestClient=${isTestClient(clientId)}) — Firestore não foi tocado.`)
      deleteMockKnowledgeDoc(clientId, docId)
      return res.json({ ok: true, message: 'Documento de teste removido com sucesso.' })
    }

    try {
      // 1. Chunks associados
      const chunksSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_chunks')
        .where('docId', '==', docId)
        .get()

      // 2. Regras associadas
      const rulesSnapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('knowledge_rules')
        .where('sourceDocId', '==', docId)
        .get()

      // 3. Documento principal
      const docRef = db.collection('clients').doc(clientId).collection('knowledge_docs').doc(docId)

      const refs = [...chunksSnapshot.docs.map((d) => d.ref), ...rulesSnapshot.docs.map((d) => d.ref), docRef]

      // BulkWriter em vez de batch: o commit é limitado por operações E por tamanho
      // (~10 MiB). Lotear só pela contagem ainda dava
      // "INVALID_ARGUMENT: Transaction too big" num documento com muitos chunks.
      await bulkDelete(db, refs)

      // Confere se sumiu de verdade, em vez de confiar no commit. Foi exatamente a
      // suposição não verificada que fez a tela mentir antes: "commit não lançou erro"
      // não é a mesma coisa que "o documento não está mais lá".
      const conferencia = await docRef.get()
      if (conferencia.exists) {
        console.error(
          `[Knowledge] INCONSISTÊNCIA: commit sem erro, mas clients/${clientId}/knowledge_docs/${docId} ainda existe.`
        )
        return res.status(502).json({
          error:
            'O Firestore aceitou a exclusão mas o documento continua existindo. Verifique regras de segurança/permissões do service account.',
          code: 'delete_not_effective',
        })
      }

      console.log(
        `[Knowledge] Documento ${docId} removido do cliente ${clientId}: ${chunksSnapshot.size} chunk(s), ${rulesSnapshot.size} regra(s), ${refs.length} operação(ões). Conferido: não existe mais.`
      )

      return res.json({
        ok: true,
        message: 'Documento, chunks e regras removidos com sucesso.',
        deleted: { chunks: chunksSnapshot.size, rules: rulesSnapshot.size },
      })
    } catch (err) {
      // NUNCA responder sucesso aqui. A exclusão é no Firestore, e o mock não
      // substitui o Firestore: dizer "removido" quando o dado continua lá faz o
      // documento reaparecer no F5 e destrói a confiança na tela.
      console.error(`[Knowledge] FALHA ao excluir documento ${docId} do cliente ${clientId}:`, err.message)
      return res.status(502).json({
        error: `Não foi possível excluir o documento: ${err.message}`,
        code: 'delete_failed',
      })
    }
  } catch (err) {
    next(err)
  }
})

export default router
