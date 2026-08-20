import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { resolvePrompt } from '../services/promptResolver.js'
import { promptCache } from '../services/promptCache.js'

const router = Router()

export const DEFAULT_PROMPTS = {
  titulo: `Você é um especialista sênior em SEO para marketplaces, focado em algoritmos de busca e conversão.

Sua missão é criar o título perfeito para um produto, processando os dados fornecidos e aplicando um filtro rigoroso de otimização. Siga estas diretrizes com precisão absoluta, pois esta é uma tarefa de processamento de dados estruturados.

DIRETRIZES DE CONSTRUÇÃO

1. Hierarquia SEO: O título deve seguir obrigatoriamente a estrutura: [Objeto Principal] + [Marca] + [Modelo] + [Atributo Principal].
2. Limite Crítico de 60 Caracteres: O título final deve ter no máximo 60 caracteres, incluindo espaços. Se exceder, corte os atributos da direita para a esquerda, preservando sempre o Tipo de Produto e a Marca.
3. Fidelidade aos Dados: Utilize apenas informações contidas nos campos abaixo. É estritamente proibido inventar adjetivos, benefícios, tecnologias ou características não mencionadas.
4. Limpeza e Padronização: Use apenas letras e números separados por espaços simples. Remova qualquer caractere especial (*, -, /, !, ?, #), símbolos ou emojis.

RESTRIÇÕES NEGATIVAS (O QUE REMOVER)

- Sem Variações: Proibido incluir cor, tamanho, numeração, voltagem, medidas ou gênero (masculino/feminino).
- Sem Termos Comerciais: Remova palavras como promoção, oferta, grátis, barato, desconto, envio imediato, melhor, original ou equivalentes.
- Sem Redundância: Elimine redundâncias e palavras desnecessárias que não contribuam para a identificação técnica do produto.

DADOS DISPONÍVEIS

Descrição:
{{description}}

Título original:
{{title}}

PROTOCOLO DE RESPOSTA

- Retorne exclusivamente o texto do título otimizado.
- Uma única linha, sem aspas e sem ponto final.
- Proibido incluir explicações, notas de rodapé ou comentários.
- Formatação OBRIGATÓRIA do Título (Title Case): A primeira letra de cada palavra DEVE ser MAIÚSCULA (exemplo: "Açucareiro Esmaltado Porta Açúcar 450ml Suporte Açúcar").`,

  descricao: `Você é um redator profissional especializado em e-commerce e SEO para marketplaces, com foco em conversão e ranqueamento.

Sua tarefa é reescrever e otimizar a descrição do produto com base nos dados fornecidos, seguindo rigorosamente as diretrizes abaixo.

REGRAS OBRIGATÓRIAS

Corrigir erros ortográficos e gramaticais.
Tornar o texto mais claro, objetivo e persuasivo.
Melhorar o SEO utilizando apenas palavras presentes nos dados fornecidos.
Manter exatamente o significado e a proposta original do produto.
Não inventar informações: proibido adicionar especificações técnicas, benefícios, materiais, medidas, compatibilidades ou funcionalidades não informadas.
Não incluir garantias, promessas comerciais, prazos, políticas ou informações legais não fornecidas.
Texto final com no máximo 2000 caracteres (incluindo espaços).

OTIMIZAÇÃO PARA CONVERSÃO

Iniciar com um parágrafo introdutório direto e comercial, destacando o principal benefício percebido.
Priorizar clareza e leitura rápida (escaneável).
Evitar blocos longos de texto.
Utilizar linguagem simples, objetiva e orientada à decisão de compra.
Evitar repetições e termos genéricos.

REGRAS DE SEO

Inserir naturalmente as principais palavras-chave presentes no título e descrição original.
Não repetir excessivamente palavras-chave (evitar keyword stuffing).
Priorizar termos mais relevantes no início do texto.
Não utilizar sinônimos que não estejam nos dados fornecidos.

FORMATAÇÃO OBRIGATÓRIA

Utilizar apenas HTML simples com as seguintes tags:

<p> para parágrafos
<ul> e <li> para listas

Estrutura obrigatória:

Um parágrafo introdutório
Uma lista com características técnicas ou funcionais

RESTRIÇÕES

Não usar <h1>, <h2> ou qualquer outro tipo de título.
Não usar emojis.
Não usar links.
Não usar tabelas.
Não usar imagens.
Não usar caracteres especiais desnecessários.
Não inserir as palavras: multicolorido ou multicolorida.

DADOS DISPONÍVEIS (UTILIZAR APENAS ESTES)

Título do produto:
{{title}}

Descrição original:
{{description}}

PROTOCOLO DE RESPOSTA

Retornar apenas a descrição final.
Somente HTML válido utilizando <p>, <ul> e <li>.
Não incluir comentários, explicações ou qualquer texto fora do HTML.`,
}

import { isTestClient, getMockPrompt, saveMockPrompt } from '../services/mockStorage.js'

/**
 * GET /api/prompts/global
 * Retorna os prompts-núcleo do sistema (coleção `global_prompts`).
 * Qualquer operador autenticado pode ler; a edição exige admin.
 */
router.get('/global', async (req, res, next) => {
  try {
    const result = { hardcoded: DEFAULT_PROMPTS }

    for (const type of ['titulo', 'descricao']) {
      try {
        const doc = await db.collection('global_prompts').doc(type).get()
        if (doc.exists) {
          result[type] = {
            content: doc.data().content,
            version: doc.data().version ?? 1,
            updatedAt: doc.data().updatedAt?.toDate?.().toISOString() ?? null,
            updatedByName: doc.data().updatedByName ?? null,
          }
        } else {
          result[type] = { content: DEFAULT_PROMPTS[type], version: 0, source: 'hardcoded' }
        }
      } catch (dbErr) {
        console.warn(`[Prompts] Falha ao ler global_prompts/${type}:`, dbErr.message)
        result[type] = { content: DEFAULT_PROMPTS[type], version: 0, source: 'hardcoded' }
      }
    }

    return res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/prompts/global
 * Atualiza os prompts-núcleo do sistema. Requer role = admin.
 *
 * O prompt global é o "piso" que todo cliente sem personalização recebe.
 * Alterá-lo impacta TODOS os clientes que não têm prompt próprio — por isso
 * exige admin e archiva a versão anterior.
 */
router.put('/global', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem editar o núcleo do sistema.' })
    }

    const { titulo, descricao } = req.body ?? {}
    if (!titulo && !descricao) {
      return res.status(400).json({ error: 'Informe pelo menos um dos campos: titulo ou descricao.' })
    }

    const batch = db.batch()
    const salvos = []

    for (const [type, novoConteudo] of [['titulo', titulo], ['descricao', descricao]]) {
      if (!novoConteudo) continue

      const ref = db.collection('global_prompts').doc(type)
      const atual = await ref.get()
      const versaoAtual = atual.exists ? atual.data().version ?? 1 : 0

      // Archiva a versão que está saindo
      if (atual.exists && atual.data().content) {
        const histRef = db.collection('global_prompt_history').doc()
        batch.set(histRef, {
          type,
          content: atual.data().content,
          version: versaoAtual,
          replacedBy: req.user.id,
          replacedByName: req.user.name ?? null,
          archivedAt: FieldValue.serverTimestamp(),
        })
      }

      batch.set(ref, {
        content: novoConteudo,
        version: versaoAtual + 1,
        updatedBy: req.user.id,
        updatedByName: req.user.name ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      })

      salvos.push({ type, version: versaoAtual + 1 })
    }

    await batch.commit()

    // Invalida cache de TODOS os clientes que usam o global
    promptCache.clear()

    console.log(
      `[Prompts] ${req.user.name ?? req.user.id} atualizou GLOBAL: ${salvos.map((s) => `${s.type} v${s.version}`).join(', ')}`
    )
    return res.json({ ok: true, message: 'Núcleo do sistema atualizado.', salvos })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/prompts/:clientId
 * Retorna os prompts ativos de um cliente no Firestore e os prompts defaults globais.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    const result = {
      defaultPrompts: { ...DEFAULT_PROMPTS },
    }

    for (const type of ['titulo', 'descricao']) {
      if (isTestClient(clientId)) {
        const mockPrompt = getMockPrompt(clientId, type)
        result[type] = {
          id: type,
          content: mockPrompt ? mockPrompt.content : DEFAULT_PROMPTS[type],
          version: mockPrompt ? mockPrompt.version : 1,
          isGlobal: !mockPrompt,
        }
      } else {
        try {
          // 1. Ler o núcleo global do Firestore para compor defaultPrompts
          let globalContent = DEFAULT_PROMPTS[type]
          let globalVersion = 1

          try {
            const globalDoc = await db.collection('global_prompts').doc(type).get()
            if (globalDoc.exists && globalDoc.data()?.content) {
              globalContent = globalDoc.data().content
              globalVersion = globalDoc.data().version ?? 1
            }
          } catch (gErr) {
            console.warn(`[Prompts] Falha ao ler global_prompts/${type}:`, gErr.message)
          }

          result.defaultPrompts[type] = globalContent

          // 2. Buscar no cliente
          const clientDoc = await db
            .collection('clients')
            .doc(clientId)
            .collection('prompts')
            .doc(type)
            .get()

          if (clientDoc.exists && clientDoc.data()?.isActive) {
            result[type] = {
              id: clientDoc.id,
              content: clientDoc.data().content,
              version: clientDoc.data().version ?? 1,
              isGlobal: false,
              // Ausente = salvo antes do modelo de composição, e vale como 'replace'.
              promptMode: clientDoc.data().promptMode ?? 'replace',
            }
          } else {
            // Fallback global
            result[type] = {
              id: type,
              content: globalContent,
              version: globalVersion,
              isGlobal: true,
            }
          }
        } catch (dbErr) {
          console.warn('[Prompts] Aviso Firestore (usando fallback padrão):', dbErr.message)
          const mockPrompt = getMockPrompt(clientId, type)
          result[type] = {
            id: type,
            content: mockPrompt ? mockPrompt.content : DEFAULT_PROMPTS[type],
            version: mockPrompt ? mockPrompt.version : 1,
            isGlobal: !mockPrompt,
          }
        }
      }
    }

    return res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/prompts/:clientId
 * Salva ou atualiza prompts de um cliente.
 * No cliente de teste ('Teste - Marca Seleta'), todos os operadores têm permissão de edição.
 */
router.put('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { titulo, descricao, promptModeTitulo, promptModeDescricao } = req.body ?? {}

    // 'append'  → o texto é personalização e SOMA ao núcleo do sistema (padrão)
    // 'replace' → o texto é o prompt inteiro (modo avançado / legado)
    const modos = {
      titulo: promptModeTitulo === 'replace' ? 'replace' : 'append',
      descricao: promptModeDescricao === 'replace' ? 'replace' : 'append',
    }

    if (!titulo && !descricao) {
      return res.status(400).json({
        error: 'Pelo menos um dos campos "titulo" ou "descricao" é obrigatório.',
      })
    }

    // Se for o cliente de teste, salva direto sem exigir role admin
    if (isTestClient(clientId)) {
      if (titulo) saveMockPrompt(clientId, 'titulo', titulo, req.user?.id)
      if (descricao) saveMockPrompt(clientId, 'descricao', descricao, req.user?.id)
      return res.json({ ok: true, message: 'Prompts de teste atualizados com sucesso.' })
    }

    // Qualquer operador autenticado pode editar prompt do cliente.
    //
    // O que torna isso seguro não é a restrição de perfil — é o HISTÓRICO: cada
    // gravação arquiva a versão anterior em `prompt_history`, então toda alteração é
    // reversível em um clique (POST /:clientId/restore). Bloquear editor apenas
    // empurrava o trabalho para um admin sem reduzir o risco de um prompt ruim.
    try {
      const clientRef = db.collection('clients').doc(clientId)
      const clientDoc = await clientRef.get()

      if (!clientDoc.exists) {
        if (titulo) saveMockPrompt(clientId, 'titulo', titulo, req.user?.id)
        if (descricao) saveMockPrompt(clientId, 'descricao', descricao, req.user?.id)
        return res.json({ ok: true, message: 'Prompts atualizados com sucesso.' })
      }

      const batch = db.batch()
      const salvos = []

      for (const [type, novoConteudo] of [
        ['titulo', titulo],
        ['descricao', descricao],
      ]) {
        if (!novoConteudo) continue

        const ref = clientRef.collection('prompts').doc(type)
        const atual = await ref.get()
        const versaoAtual = atual.exists ? atual.data().version ?? 1 : 0

        // Arquiva a versão que está saindo, ANTES de sobrescrever.
        if (atual.exists && atual.data().content) {
          const historyRef = clientRef.collection('prompt_history').doc()
          batch.set(historyRef, {
            type,
            content: atual.data().content,
            version: versaoAtual,
            replacedBy: req.user.id,
            replacedByName: req.user.name ?? null,
            archivedAt: FieldValue.serverTimestamp(),
          })
        }

        batch.set(ref, {
          content: novoConteudo,
          promptMode: modos[type],
          version: versaoAtual + 1,
          isActive: true,
          createdBy: req.user.id,
          createdByName: req.user.name ?? null,
          createdByRole: req.user.role ?? 'editor',
          updatedAt: FieldValue.serverTimestamp(),
        })

        salvos.push({ type, version: versaoAtual + 1 })
      }

      await batch.commit()
      console.log(
        `[Prompts] ${req.user.name ?? req.user.id} (${req.user.role}) atualizou ${salvos.map((s) => `${s.type} v${s.version}`).join(', ')} do cliente ${clientId}`
      )
    } catch (dbErr) {
      console.warn('[PromptsPut] Aviso Firestore (salvando em mock):', dbErr.message)
      if (titulo) saveMockPrompt(clientId, 'titulo', titulo, req.user?.id)
      if (descricao) saveMockPrompt(clientId, 'descricao', descricao, req.user?.id)
    }

    // Invalidar cache do cliente
    promptCache.invalidateClient(clientId)

    return res.json({ ok: true, message: 'Prompts atualizados com sucesso.' })
  } catch (err) {
    next(err)
  }
})


/**
 * GET /api/prompts/:clientId/effective
 *
 * O prompt que o gerador REALMENTE monta, com a origem do texto-base e as camadas
 * ativas. Existe porque a tela mostrava um "MODO PADRÃO GLOBAL" que, em cliente com
 * base de conhecimento e sem prompt próprio, não é o texto executado — o resolver
 * troca por uma versão alinhada ao RAG. Sem isso, editar prompt é editar às cegas.
 *
 * `source`:
 *   client            → prompt salvo neste cliente (o que a tela edita)
 *   global            → documento em global_prompts
 *   knowledge_aligned → cliente TEM base de conhecimento e NÃO tem prompt próprio
 *   hardcoded         → sem prompt próprio e sem base de conhecimento
 */
router.get('/:clientId/effective', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const resultado = {}

    for (const type of ['titulo', 'descricao']) {
      // Cache invalidado para refletir o estado real do banco, não uma leitura antiga.
      promptCache.invalidateClient(clientId)
      const resolved = await resolvePrompt(clientId, type, { title: '(exemplo)', description: '(exemplo)' })

      resultado[type] = {
        source: resolved.source,
        version: resolved.version,
        basePromptContent: resolved.basePromptContent,
        systemPromptCompleto: resolved.systemPrompt,
        tamanhoCaracteres: resolved.systemPrompt.length,
        camadas: {
          regrasEstruturadas: resolved.approvedRules?.length ?? 0,
          chunksRag: resolved.ragChunksUsed?.length ?? 0,
          fewShot: resolved.fewShotExamples?.length ?? 0,
          skillsAtivas: resolved.skillsApplied ?? [],
        },
        regrasDeterministicas: (resolved.approvedRules ?? [])
          .filter((r) => r.application === 'prepend_exactly' || r.application === 'append_exactly')
          .map((r) => ({ nome: r.name, aplicacao: r.application })),
      }
    }

    return res.json({ clientId, ...resultado })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/prompts/:clientId/history/:type
 * Versões arquivadas — a rede de segurança que permite liberar a edição.
 */
router.get('/:clientId/history/:type', async (req, res, next) => {
  try {
    const { clientId, type } = req.params
    if (!['titulo', 'descricao'].includes(type)) {
      return res.status(400).json({ error: 'type deve ser "titulo" ou "descricao".' })
    }

    const snapshot = await db
      .collection('clients')
      .doc(clientId)
      .collection('prompt_history')
      .where('type', '==', type)
      .get()

    const versoes = snapshot.docs
      .map((d) => ({
        id: d.id,
        version: d.data().version,
        replacedByName: d.data().replacedByName ?? d.data().replacedBy ?? null,
        archivedAt: d.data().archivedAt?.toDate?.().toISOString() ?? null,
        preview: String(d.data().content ?? '').slice(0, 200),
        charCount: String(d.data().content ?? '').length,
      }))
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))

    return res.json({ clientId, type, total: versoes.length, versoes })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/prompts/:clientId/restore
 * Body: { type, historyId } para voltar a uma versão arquivada
 *    ou { type, useDefault: true } para voltar ao texto padrão do sistema.
 */
router.post('/:clientId/restore', async (req, res, next) => {
  try {
    const { clientId } = req.params
    const { type, historyId, useDefault } = req.body ?? {}

    if (!['titulo', 'descricao'].includes(type)) {
      return res.status(400).json({ error: 'type deve ser "titulo" ou "descricao".' })
    }
    if (!historyId && !useDefault) {
      return res.status(400).json({ error: 'Informe historyId ou useDefault.' })
    }

    const clientRef = db.collection('clients').doc(clientId)
    let conteudo = DEFAULT_PROMPTS[type]
    let origem = 'padrão do sistema'

    if (historyId) {
      const historico = await clientRef.collection('prompt_history').doc(historyId).get()
      if (!historico.exists) return res.status(404).json({ error: 'Versão não encontrada no histórico.' })
      conteudo = historico.data().content
      origem = `versão ${historico.data().version}`
    } else if (useDefault) {
      try {
        const globalDoc = await db.collection('global_prompts').doc(type).get()
        if (globalDoc.exists && globalDoc.data()?.content) {
          conteudo = globalDoc.data().content
        }
      } catch (gErr) {
        console.warn(`[Prompts] Falha ao ler global_prompts/${type} no restore:`, gErr.message)
      }
    }

    const ref = clientRef.collection('prompts').doc(type)
    const atual = await ref.get()
    const versaoAtual = atual.exists ? atual.data().version ?? 1 : 0

    const batch = db.batch()

    // Restaurar também arquiva o que está saindo: nunca se perde um estado.
    if (atual.exists && atual.data().content) {
      batch.set(clientRef.collection('prompt_history').doc(), {
        type,
        content: atual.data().content,
        version: versaoAtual,
        replacedBy: req.user.id,
        replacedByName: req.user.name ?? null,
        archivedAt: FieldValue.serverTimestamp(),
      })
    }

    batch.set(ref, {
      content: conteudo,
      version: versaoAtual + 1,
      isActive: true,
      createdBy: req.user.id,
      createdByName: req.user.name ?? null,
      restoredFrom: origem,
      updatedAt: FieldValue.serverTimestamp(),
    })

    await batch.commit()
    promptCache.invalidateClient(clientId)

    console.log(`[Prompts] ${req.user.name ?? req.user.id} restaurou ${type} do cliente ${clientId} a partir de ${origem}`)
    return res.json({ ok: true, message: `Prompt de ${type} restaurado (${origem}).`, version: versaoAtual + 1 })
  } catch (err) {
    next(err)
  }
})

export default router
