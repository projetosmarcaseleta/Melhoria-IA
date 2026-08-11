import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

/** Definições de Habilidades Padrão do Sistema */
export const DEFAULT_SKILLS = [
  {
    id: 'anti_forbidden_words',
    name: '🛡️ Filtro de Termos Proibidos',
    description: 'Impede estritamente a inclusão de palavras proibidas ou termos comerciais negativos.',
    promptInjection: 'REGRA DA SKILL (FILTRO DE TERMOS PROIBIDOS):\nÉ estritamente proibido utilizar as seguintes palavras ou variações no resultado: {{forbiddenWords}}. Se alguma dessas palavras estiver no input original, remova-a totalmente.',
    defaultConfig: { forbiddenWords: 'promoção, oferta, grátis, frete grátis, barato, desconto, envio imediato, melhor do mercado, original' },
  },
  {
    id: 'tone_of_voice',
    name: '🎨 Estilo e Tom de Voz',
    description: 'Ajusta a personalidade da redação para o tom preferido do cliente.',
    promptInjection: 'REGRA DA SKILL (TOM DE VOZ):\nEscreva todo o conteúdo utilizando um tom de voz {{toneStyle}}. Adapte o vocabulário para esse perfil de público.',
    defaultConfig: { toneStyle: 'Técnico, Direto e Objetivo' }, // Opções: 'Técnico, Direto e Objetivo', 'Comercial e Persuasivo', 'Sofisticado e Premium'
  },
  {
    id: 'html_spec_formatter',
    name: '📐 Padronizador de Especificações HTML',
    description: 'Força a estrutura HTML limpa com parágrafo inicial + lista <ul><li> para dados técnicos.',
    promptInjection: 'REGRA DA SKILL (PADRONIZADOR HTML):\nFormate a descrição obrigatoriamente como: 1) Um parágrafo <p> introdutório curto e direto. 2) Uma lista <ul> com itens <li> destacando as especificações do produto.',
    defaultConfig: {},
  },
]

/**
 * GET /api/skills/:clientId
 * Retorna as skills ativas e disponíveis para o cliente.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

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

    return res.json({ ok: true, skillId, ...skillData })
  } catch (err) {
    next(err)
  }
})

export default router
