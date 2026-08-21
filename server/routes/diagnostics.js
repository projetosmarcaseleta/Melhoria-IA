/**
 * Diagnóstico operacional — consumo de cota do Firestore e eficácia dos caches.
 *
 * Motivo de existir: o painel roda no plano Spark (50k leituras / 20k escritas por dia)
 * e caía por cota sem ninguém saber qual rota consumia. Otimizar sem medir é chute.
 *
 * Os contadores são em memória e por processo: reiniciar o servidor zera. Isso é
 * aceitável para o propósito (descobrir o padrão de consumo de um dia de uso) e evita
 * a ironia de gastar cota do Firestore para medir consumo do Firestore.
 */

import { Router } from 'express'
import { firestoreMeter } from '../services/firestoreMeter.js'
import { operatorCache } from '../middleware/auth.js'
import { promptCache } from '../services/promptCache.js'
import { categoryTreeCache } from '../services/categoryTreeCache.js'
import { getPacing } from '../services/anymarketClient.js'
import { getLlmPacing } from '../services/llmLimiter.js'
import { getGenerationPersistenceStats } from './generate.js'

const router = Router()

/**
 * GET /api/diagnostics
 * Panorama: cota consumida hoje, rotas que mais consomem, caches e disjuntor.
 */
router.get('/', (_req, res) => {
  const firestore = firestoreMeter.stats()
  const operadores = operatorCache.stats()

  return res.json({
    firestore,
    caches: {
      // Cada hit aqui é uma leitura do Firestore que não aconteceu.
      operadores,
      prompts: promptCache.stats(),
      arvoreCategorias: categoryTreeCache.stats(),
    },
    anymarket: { ritmo: getPacing() },
    // Concorrência real das chamadas ao LLM (adaptativa) e escritas de geração perdidas.
    // `falhasDefinitivas > 0` significa texto entregue ao operador que não está no
    // Firestore: o feedback dele vai para a memória do processo e some no restart.
    llm: {
      ritmo: getLlmPacing(),
      persistencia: getGenerationPersistenceStats(),
    },
    processo: {
      uptimeSegundos: Math.round(process.uptime()),
      memoriaMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node: process.version,
    },
    alertas: montarAlertas(firestore, operadores),
  })
})

/**
 * Traduz números em recado acionável. Sem isto, o endpoint devolve dados que exigem
 * interpretação — e ninguém abre um JSON todo dia para interpretar.
 */
function montarAlertas(firestore, operadores) {
  const alertas = []
  const { totais, limiteSpark } = firestore

  const pctLeitura = totais.reads / limiteSpark.reads
  const pctEscrita = totais.writes / limiteSpark.writes

  if (pctLeitura > 0.8) {
    alertas.push({
      nivel: 'critico',
      mensagem: `Leituras em ${(pctLeitura * 100).toFixed(0)}% da cota diária do Spark. A cota reseta à meia-noite do Pacífico.`,
    })
  } else if (pctLeitura > 0.5) {
    alertas.push({ nivel: 'atencao', mensagem: `Leituras em ${(pctLeitura * 100).toFixed(0)}% da cota diária.` })
  }

  if (pctEscrita > 0.8) {
    alertas.push({ nivel: 'critico', mensagem: `Escritas em ${(pctEscrita * 100).toFixed(0)}% da cota diária do Spark.` })
  }

  if (firestore.disjuntor.aberto) {
    alertas.push({
      nivel: 'critico',
      mensagem: `Firestore indisponível por cota. Disjuntor reabre em ${firestore.disjuntor.reabreEm}. Operações de escrita estão caindo em contingência.`,
    })
  }

  if (firestore.erros.cota > 0) {
    alertas.push({ nivel: 'atencao', mensagem: `${firestore.erros.cota} erro(s) de cota registrado(s) hoje.` })
  }

  if (operadores.misses > 20 && Number(operadores.hitRate) < 0.5) {
    alertas.push({
      nivel: 'info',
      mensagem: `Cache de operador com aproveitamento baixo (${operadores.hitRate}). Muitos operadores distintos ou TTL curto demais.`,
    })
  }

  if (!alertas.length) alertas.push({ nivel: 'ok', mensagem: 'Consumo de cota dentro do normal.' })

  return alertas
}

/** POST /api/diagnostics/reset — zera os contadores (para medir uma janela específica). */
router.post('/reset', (_req, res) => {
  firestoreMeter.reset()
  return res.json({ ok: true, message: 'Contadores zerados.' })
})

export default router
