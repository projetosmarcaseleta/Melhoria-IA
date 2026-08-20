/**
 * Testes da resolução AUTOMÁTICA do de-para (docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §8).
 *
 * A árvore do canal é falsa, mas as ARMADILHAS são reais: cada caso aqui reproduz um erro
 * que apareceu ao rodar contra a árvore do Mercado Livre de uma conta de verdade. Sem eles,
 * um refactor bem-intencionado reintroduz o mesmo erro sem ninguém notar.
 *
 * O LLM é injetado como função de escolha nos testes de descida — teste de resolução não
 * deve depender do humor de um modelo, e o que importa aqui é a MECÂNICA da busca.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  scoreChannelCandidate,
  rankCandidates,
  isAmbiguous,
  resolveByDescent,
  pickSuggestion,
  AUTO_DEFAULTS,
} from '../services/channelBindResolver.js'

/** Árvore falsa no formato que `normalizeMarketplaceLevel` devolve. */
function criarArvore(nos) {
  const porCodigo = new Map(nos.map((n) => [n.code, n]))

  const caminho = (code) => {
    const trilha = []
    let atual = porCodigo.get(code)
    while (atual) {
      trilha.unshift(atual)
      atual = atual.parent ? porCodigo.get(atual.parent) : null
    }
    return trilha
  }

  const chamadas = []

  const fetchLevel = async (code) => {
    chamadas.push(code)
    const atual = code ? porCodigo.get(code) : null
    const filhos = nos.filter((n) => (code ? n.parent === code : !n.parent))
    const trilha = code ? caminho(code) : []

    return {
      name: atual?.name ?? null,
      canBeSelected: Boolean(atual?.selectable),
      completePath: trilha.map((n) => n.name).join('/') || null,
      isReceivingItens: atual?.receiving ?? null,
      path: trilha.map((n) => ({ codeInMarketPlace: n.code, name: n.name })),
      childs: filhos.map((f) => ({
        codeInMarketPlace: f.code,
        name: f.name,
        completePath: caminho(f.code).map((n) => n.name).join('/'),
        canBeSelected: false, // como a API real: o filho não informa isso na lista
      })),
    }
  }

  return { fetchLevel, chamadas }
}

describe('resolvedor — pontuação de candidato', () => {
  const alvo = { leafName: 'Chave de Roda', pathTokens: new Set(['acessorio', 'chave', 'de', 'roda']) }

  it('NÃO deve dar nota máxima por containment ("Chave de Roda" ⊃ "Rodas")', () => {
    // Regressão medida em conta real: com containment, "Rodas" casava 1.0 com
    // "Chave de Roda", virava "correspondência exata" e o vínculo errado saía com selo de
    // certeza. Continua tendo nota parcial (compartilha o token "roda") — o que não pode é
    // passar por nome idêntico nem superar quem realmente é.
    const rodas = scoreChannelCandidate('Rodas', alvo)
    const chave = scoreChannelCandidate('Chave de Roda', alvo)

    assert.ok(rodas.leafScore < 0.85, `não pode contar como nome idêntico, veio ${rodas.leafScore}`)
    assert.ok(rodas.leafScore < chave.leafScore)
  })

  it('deve dar nota máxima para o nome praticamente igual', () => {
    const igual = scoreChannelCandidate('Chave de Roda', alvo)
    assert.equal(igual.leafScore, 1)
    assert.equal(igual.score, 1)
  })

  it('semelhança com o caminho entra DESCONTADA, nunca à frente da folha', () => {
    // "Acessórios para Veículos" só casa com o caminho; não pode superar quem casa com a folha.
    const caminho = scoreChannelCandidate('Acessórios', alvo)
    const folha = scoreChannelCandidate('Chave de Roda', alvo)
    assert.equal(caminho.metric, 'caminho')
    assert.ok(caminho.score < folha.score)
    assert.ok(caminho.score < caminho.pathScore, 'o desconto precisa ser aplicado')
  })

  it('rankCandidates ordena do melhor para o pior', () => {
    const ranked = rankCandidates(
      [{ name: 'Pneus' }, { name: 'Chave de Roda' }, { name: 'Som' }].map((c, i) => ({ ...c, codeInMarketPlace: `C${i}` })),
      alvo
    )
    assert.equal(ranked[0].name, 'Chave de Roda')
  })

  it('isAmbiguous acusa empate e piso não atingido', () => {
    const cfg = { minScore: 0.5, ambiguityGap: 0.1 }
    assert.equal(isAmbiguous([{ score: 0.9 }, { score: 0.2 }], cfg), false)
    assert.equal(isAmbiguous([{ score: 0.9 }, { score: 0.85 }], cfg), true, 'empate técnico')
    assert.equal(isAmbiguous([{ score: 0.3 }], cfg), true, 'abaixo do piso')
    assert.equal(isAmbiguous([], cfg), false)
  })
})

describe('resolvedor — descida na árvore do canal', () => {
  // "Tapetes" está fundo, e os níveis do meio ("Interior") não casam por texto com nada —
  // é o caso que fazia a busca parar cedo.
  const arvoreML = [
    { code: 'ACC', name: 'Acessórios para Veículos', selectable: false },
    { code: 'CAR', name: 'Aces. de Carros e Caminhonetes', parent: 'ACC', selectable: true },
    { code: 'INT', name: 'Interior', parent: 'CAR', selectable: false },
    { code: 'TAP', name: 'Tapetes', parent: 'INT', selectable: true, receiving: true },
    { code: 'VOL', name: 'Capas de Volante', parent: 'CAR', selectable: true },
    { code: 'FER', name: 'Ferramentas para Veículos', parent: 'ACC', selectable: false },
    { code: 'ELEV', name: 'Elevação', parent: 'FER', selectable: false },
    { code: 'MAC', name: 'Macacos', parent: 'ELEV', selectable: true },
  ]

  /** LLM falso: escolhe pelo nome que a gente mandar, por nível. */
  const llmQueEscolhe = (roteiro) => {
    let i = 0
    return async ({ candidatos }) => {
      const desejado = roteiro[i++]
      if (desejado === null) return { node: null, confidence: 0, reasoning: 'nenhum ramo serve' }
      const node = candidatos.find((c) => c.name === desejado)
      return node ? { node, confidence: 0.8, reasoning: `escolhi ${desejado}` } : { node: null, confidence: 0, reasoning: 'não achei' }
    }
  }

  it('deve chegar até a folha exata mesmo com níveis intermediários que não casam por texto', async () => {
    const { fetchLevel } = criarArvore(arvoreML)

    const r = await resolveByDescent({
      hubPath: ['Acessórios', 'Tapetes'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      // "Acessórios para Veículos" e "Interior" precisam de decisão semântica; "Tapetes"
      // o matcher resolve sozinho.
      chooseWithLlm: llmQueEscolhe(['Acessórios para Veículos', 'Aces. de Carros e Caminhonetes', 'Interior']),
    })

    assert.equal(r.resolved, true)
    assert.equal(r.codeInMarketPlace, 'TAP')
    assert.equal(r.completePath, 'Acessórios para Veículos/Aces. de Carros e Caminhonetes/Interior/Tapetes')
    assert.equal(r.exactLeafMatch, true)
    assert.equal(r.confidence, 1)
  })

  it('CASO CRÍTICO — beco sem saída deve fazer a busca VOLTAR e tentar outro ramo', async () => {
    const { fetchLevel } = criarArvore(arvoreML)

    // Roteiro que reproduz o erro real: o LLM entra em "Aces. de Carros e Caminhonetes"
    // (ramo errado para macaco), bate no beco, e na volta escolhe "Ferramentas para
    // Veículos" — que leva ao destino certo.
    const r = await resolveByDescent({
      hubPath: ['Acessórios', 'Macacos'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      chooseWithLlm: llmQueEscolhe([
        'Acessórios para Veículos',
        'Aces. de Carros e Caminhonetes',
        null, // beco: nenhum filho serve
        'Ferramentas para Veículos',
        'Elevação',
      ]),
    })

    assert.equal(r.resolved, true)
    assert.equal(r.codeInMarketPlace, 'MAC')
    assert.equal(r.exactLeafMatch, true)
    assert.ok(r.backtracks >= 1, 'a busca precisa ter voltado ao menos uma vez')
    assert.ok(r.trail.some((t) => t.backtrack), 'o rastro precisa registrar a volta')
  })

  it('deve respeitar o orçamento de voltas em vez de girar para sempre', async () => {
    const { fetchLevel } = criarArvore(arvoreML)

    const r = await resolveByDescent({
      hubPath: ['Acessórios', 'Guincho Hidráulico'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      options: { maxBacktracks: 1 },
      chooseWithLlm: llmQueEscolhe(['Acessórios para Veículos', null, null, null, null]),
    })

    assert.ok((r.backtracks ?? 0) <= 1)
  })

  it('recusa na RAIZ não aborta: segue pelo melhor score', async () => {
    const { fetchLevel } = criarArvore(arvoreML)

    // Medido: o modelo recusou a raiz do Mercado Livre para "Chaveiros" — a raiz cobre o
    // catálogo inteiro, então recusar ali é leitura errada, não resposta.
    const r = await resolveByDescent({
      hubPath: ['Acessórios', 'Tapetes'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      chooseWithLlm: llmQueEscolhe([null, 'Aces. de Carros e Caminhonetes', 'Interior']),
    })

    assert.ok(r.trail.some((t) => t.rootRefusal), 'a recusa na raiz precisa ficar registrada')
    assert.equal(r.resolved, true)
    assert.equal(r.codeInMarketPlace, 'TAP')
  })

  it('sem equivalente no canal deve devolver NÃO resolvido, com o palpite de lado', async () => {
    const { fetchLevel } = criarArvore([
      { code: 'AGRO', name: 'Agro', selectable: true },
      { code: 'SEM', name: 'Sementes', parent: 'AGRO', selectable: true },
    ])

    const r = await resolveByDescent({
      hubPath: ['Eletrônicos', 'Fone de Ouvido'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      chooseWithLlm: llmQueEscolhe(['Agro', null]),
    })

    // Propor "Agro" para fone de ouvido com selo de "confira" convida a confirmar no
    // automático; dizer "não achei" é mais útil.
    assert.equal(r.resolved, false)
    assert.ok(r.reason)
    assert.equal(r.bestGuess?.codeInMarketPlace, 'AGRO')
  })

  it('não deve descer além da folha certa só porque existem filhos', async () => {
    const { fetchLevel } = criarArvore([
      { code: 'CASA', name: 'Casa', selectable: false },
      { code: 'PAN', name: 'Panelas', parent: 'CASA', selectable: true },
      { code: 'PRE', name: 'Panelas de Pressão', parent: 'PAN', selectable: true },
    ])

    const r = await resolveByDescent({
      hubPath: ['Cozinha', 'Panelas'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      chooseWithLlm: llmQueEscolhe(['Casa']),
    })

    assert.equal(r.codeInMarketPlace, 'PAN', 'não pode virar "Panelas de Pressão"')
    assert.equal(r.exactLeafMatch, true)
  })

  it('sem LLM, resolve o que o matcher decide e para onde ele não decide', async () => {
    const { fetchLevel } = criarArvore([
      { code: 'CASA', name: 'Casa', selectable: false },
      { code: 'TAP', name: 'Tapetes', parent: 'CASA', selectable: true },
    ])

    // "Casa" não casa com nada do alvo e o LLM está desligado: a busca não inventa rota.
    const semLlm = await resolveByDescent({
      hubPath: ['Decoração', 'Tapetes'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      useLlm: false,
    })

    assert.equal(semLlm.resolved, false)
    assert.equal(semLlm.usedLlm, false)
  })

  it('deve reaproveitar o cache de níveis (fetchLevel não é chamado duas vezes para o mesmo nó)', async () => {
    const { fetchLevel, chamadas } = criarArvore(arvoreML)

    await resolveByDescent({
      hubPath: ['Acessórios', 'Macacos'],
      marketplace: 'MERCADO_LIVRE',
      fetchLevel,
      chooseWithLlm: llmQueEscolhe(['Acessórios para Veículos', 'Aces. de Carros e Caminhonetes', null, 'Ferramentas para Veículos', 'Elevação']),
    })

    // O `fetchLevel` do serviço tem cache; aqui só se confirma que a busca não pede o
    // mesmo nó repetidamente por descuido (o voltar reusa o nível já carregado).
    const repetidos = chamadas.filter((c, i) => chamadas.indexOf(c) !== i)
    assert.deepEqual(repetidos, [], `níveis pedidos mais de uma vez: ${repetidos.join(', ')}`)
  })
})

describe('resolvedor — sugestão da AnyMarket', () => {
  it('aceita sugestão acima do piso e converte a escala para 0–1', () => {
    const r = pickSuggestion([{ codeInMarketPlace: 'MLB1', percentage: 66.67, completePath: 'A/B' }])
    assert.equal(r.resolved, true)
    assert.equal(r.source, 'suggestion')
    assert.equal(r.confidence, 0.6667)
  })

  it('ignora sugestão fraca — melhor descer a árvore que vincular por um palpite de 12%', () => {
    assert.equal(pickSuggestion([{ codeInMarketPlace: 'MLB1', percentage: 12 }]), null)
    assert.equal(pickSuggestion([]), null)
    assert.equal(pickSuggestion(null), null)
  })

  it('marca ressalva quando a sugestão passa do piso mas não convence', () => {
    const cfg = { minSuggestionPercentage: 40, lowConfidence: 0.65 }
    const r = pickSuggestion([{ codeInMarketPlace: 'MLB1', percentage: 45 }], cfg)
    assert.equal(r.lowConfidence, true)
  })

  it('o piso padrão é o documentado', () => {
    assert.equal(AUTO_DEFAULTS.minSuggestionPercentage, 50)
  })
})
