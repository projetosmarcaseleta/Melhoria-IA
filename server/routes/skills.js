import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { requireAdmin } from '../middleware/auth.js'
import { promptCache } from '../services/promptCache.js'

const router = Router()

/** Definições de Habilidades Padrão do Sistema */
export const DEFAULT_SKILLS = [
  {
    id: 'anti_forbidden_words',
    name: '🛡️ Filtro de Termos Proibidos',
    description: 'Impede estritamente a inclusão de palavras proibidas ou termos comerciais negativos.',
    promptInjection: 'REGRA DA SKILL (FILTRO DE TERMOS PROIBIDOS):\nÉ estritamente proibido utilizar as seguintes palavras ou variações no resultado: {{forbiddenWords}}. Se alguma dessas palavras estiver no input original, remova-a totalmente.',
    defaultConfig: { forbiddenWords: 'promoção, oferta, grátis, frete grátis, barato, desconto, envio imediato, melhor do mercado, original' },
    scope: 'ambos',
  },
  {
    id: 'tone_of_voice',
    name: '🎨 Estilo e Tom de Voz',
    description: 'Ajusta a personalidade da redação para o tom preferido do cliente.',
    promptInjection: 'REGRA DA SKILL (TOM DE VOZ):\nEscreva todo o conteúdo utilizando um tom de voz {{toneStyle}}. Adapte o vocabulário para esse perfil de público.',
    defaultConfig: { toneStyle: 'Técnico, Direto e Objetivo' }, // Opções: 'Técnico, Direto e Objetivo', 'Comercial e Persuasivo', 'Sofisticado e Premium'
    scope: 'ambos',
  },
  {
    id: 'html_spec_formatter',
    name: '📐 Padronizador de Especificações HTML',
    description: 'Força a estrutura HTML limpa com parágrafo inicial + lista <ul><li> para dados técnicos.',
    promptInjection: 'REGRA DA SKILL (PADRONIZADOR HTML):\nFormate a descrição obrigatoriamente como: 1) Um parágrafo <p> introdutório curto e direto. 2) Uma lista <ul> com itens <li> destacando as especificações do produto.',
    defaultConfig: {},
    scope: 'descricao',
  },
  {
    id: 'title_max_length',
    name: '✂️ Limite de Caracteres do Título',
    description: 'Garante que o título nunca exceda o limite de caracteres definido. Além de instruir a IA, o backend corta deterministicamente por palavra inteira caso o modelo estoure o limite.',
    promptInjection: 'REGRA DA SKILL (LIMITE DE CARACTERES):\nO título final deve ter NO MÁXIMO {{maxLength}} caracteres, contando espaços. Se ultrapassar, remova palavras inteiras a partir do final até respeitar o limite — nunca corte no meio de uma palavra e nunca acrescente palavras novas.',
    defaultConfig: { maxLength: 60 },
    scope: 'titulo',
  },
  {
    id: 'category_suggestion',
    name: '🗂️ Sugestão de Categorias (AnyMarket)',
    description:
      'Habilita o botão de categoria no card do produto: analisa título e descrição, sugere o caminho hierárquico no padrão da árvore do cliente, deduplica e — após confirmação — cria no AnyMarket e substitui a categoria do produto.',
    // O escopo 'categoria' é ESTRITO no promptResolver: esta injeção nunca vaza para
    // os prompts de título/descrição, e regras marcadas 'ambos' não entram aqui.
    promptInjection:
      'REGRA DA SKILL (POLÍTICA DE CATEGORIAS DO CLIENTE):\nRespeite as seguintes preferências de taxonomia ao propor o caminho: {{taxonomyNotes}}',
    defaultConfig: {
      taxonomyNotes: 'Preferir árvore rasa (departamento > categoria > subcategoria) e nomes no plural.',
      maxDepth: 'auto',
      namingConvention: 'derive_from_tree',
      preferExistingRoots: true,
      allowNewRoot: 'confirm',
      definitionPriceScope: 'SKU',
      priceFactor: 1,
      partnerIdPrefix: 'CRIA',
      exactMatchOnly: false,
      fuzzyThreshold: 0.88,
      globalHintThreshold: 0.72,
      maxNewNodesPerApproval: 10,
      attachMode: 'confirm_each',
      maxAutoAttachPerBatch: 50,
      skipWhenSameLeaf: true,
      onlyWhenEmpty: false,
      forbiddenNodeNames: 'Outros, Diversos, Geral, Sem Categoria',
    },
    scope: 'categoria',
  },
]

import { isTestClient, getMockSkills, saveMockSkill } from '../services/mockStorage.js'

/**
 * GET /api/skills/:clientId
 * Retorna as skills ativas e disponíveis para o cliente.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    if (isTestClient(clientId)) {
      return res.json(getMockSkills(clientId, DEFAULT_SKILLS))
    }

    try {
      const snapshot = await db
        .collection('clients')
        .doc(clientId)
        .collection('skills')
        .get()

      const clientSkillsMap = {}
      snapshot.docs.forEach((doc) => {
        clientSkillsMap[doc.id] = { id: doc.id, ...doc.data() }
      })

      const result = DEFAULT_SKILLS.map((def) => {
        const saved = clientSkillsMap[def.id]
        return {
          ...def,
          isActive: saved ? saved.isActive : false,
          config: saved?.config ?? def.defaultConfig,
        }
      })

      return res.json(result)
    } catch (dbErr) {
      console.warn('[Skills] Aviso Firestore (usando mock):', dbErr.message)
      return res.json(getMockSkills(clientId, DEFAULT_SKILLS))
    }
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/skills/:clientId/:skillId
 * Ativa/Desativa ou atualiza configurações de uma skill para o cliente.
 */
router.put('/:clientId/:skillId', async (req, res, next) => {
  try {
    const { clientId, skillId } = req.params
    const { isActive, config } = req.body ?? {}

    const def = DEFAULT_SKILLS.find((s) => s.id === skillId)
    if (!def) {
      return res.status(404).json({ error: 'Skill não encontrada no catálogo.' })
    }

    if (isTestClient(clientId)) {
      const saved = saveMockSkill(clientId, skillId, {
        name: def.name,
        promptInjection: def.promptInjection,
        isActive: Boolean(isActive),
        config: config ?? def.defaultConfig,
      })
      return res.json({ ok: true, skillId, ...saved })
    }

    try {
      const docRef = db
        .collection('clients')
        .doc(clientId)
        .collection('skills')
        .doc(skillId)

      const skillData = {
        name: def.name,
        promptInjection: def.promptInjection,
        isActive: Boolean(isActive),
        config: config ?? def.defaultConfig,
        updatedAt: FieldValue.serverTimestamp(),
      }

      await docRef.set(skillData, { merge: true })
      promptCache.invalidateClient(clientId)
      return res.json({ ok: true, skillId, ...skillData })
    } catch (dbErr) {
      console.warn('[SkillsPut] Aviso Firestore (salvando mock):', dbErr.message)
      const saved = saveMockSkill(clientId, skillId, {
        name: def.name,
        promptInjection: def.promptInjection,
        isActive: Boolean(isActive),
        config: config ?? def.defaultConfig,
      })
      promptCache.invalidateClient(clientId)
      return res.json({ ok: true, skillId, ...saved })
    }
  } catch (err) {
    next(err)
  }
})

export default router

