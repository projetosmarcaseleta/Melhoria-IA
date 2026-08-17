import { Router } from 'express'
import { db, FieldValue } from '../services/firebaseAdmin.js'
import { requireAdmin } from '../middleware/auth.js'

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
 * GET /api/prompts/:clientId
 * Retorna os prompts ativos de um cliente no Firestore e os prompts defaults globais.
 */
router.get('/:clientId', async (req, res, next) => {
  try {
    const { clientId } = req.params

    const result = {
      defaultPrompts: DEFAULT_PROMPTS,
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
          // Buscar no cliente
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
            }
          } else {
            // Fallback global
            const globalDoc = await db
              .collection('global_prompts')
              .doc(type)
              .get()

            result[type] = {
              id: globalDoc.exists ? globalDoc.id : type,
              content: globalDoc.exists ? globalDoc.data().content : DEFAULT_PROMPTS[type],
              version: globalDoc.exists ? (globalDoc.data().version ?? 1) : 1,
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
    const { titulo, descricao } = req.body ?? {}

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

    // Para outros clientes em produção, exige role admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores.' })
    }

    try {
      const clientRef = db.collection('clients').doc(clientId)
      const clientDoc = await clientRef.get()

      if (!clientDoc.exists) {
        if (titulo) saveMockPrompt(clientId, 'titulo', titulo, req.user?.id)
        if (descricao) saveMockPrompt(clientId, 'descricao', descricao, req.user?.id)
        return res.json({ ok: true, message: 'Prompts atualizados com sucesso.' })
      }

      const batch = db.batch()

      if (titulo) {
        const titleRef = clientRef.collection('prompts').doc('titulo')
        const currentDoc = await titleRef.get()
        const currentVersion = currentDoc.exists ? (currentDoc.data().version ?? 1) : 0

        batch.set(titleRef, {
          content: titulo,
          version: currentVersion + 1,
          isActive: true,
          createdBy: req.user.id,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      if (descricao) {
        const descRef = clientRef.collection('prompts').doc('descricao')
        const currentDoc = await descRef.get()
        const currentVersion = currentDoc.exists ? (currentDoc.data().version ?? 1) : 0

        batch.set(descRef, {
          content: descricao,
          version: currentVersion + 1,
          isActive: true,
          createdBy: req.user.id,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      await batch.commit()
    } catch (dbErr) {
      console.warn('[PromptsPut] Aviso Firestore (salvando em mock):', dbErr.message)
      if (titulo) saveMockPrompt(clientId, 'titulo', titulo, req.user?.id)
      if (descricao) saveMockPrompt(clientId, 'descricao', descricao, req.user?.id)
    }

    return res.json({ ok: true, message: 'Prompts atualizados com sucesso.' })
  } catch (err) {
    next(err)
  }
})

export default router
