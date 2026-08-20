/**
 * Resolução AUTOMÁTICA do de-para de categoria por canal.
 *
 * O ponto da feature: o operador não deveria navegar a árvore do Mercado Livre à mão —
 * se fosse para escolher manualmente, o painel do AnyMarket já faz isso. Aqui o CRIA
 * DECIDE o destino em cada canal e apresenta um "de → para" para confirmação única.
 *
 * Duas fontes de decisão, em ordem de custo:
 *
 *   1. Sugestão da AnyMarket (§1.3) — quando vem com confiança acima do piso, é a
 *      resposta mais barata e a que o próprio hub endossa.
 *   2. Descida guiada na árvore nativa do canal (§1.4) — nível a nível, pontuando os
 *      filhos contra o caminho da categoria no hub com o MESMO matcher determinístico
 *      da criação de categorias (`categoryMatcher.js`), e chamando o LLM só para
 *      desempatar. Medido: `/suggestions` respondeu vazio nas categorias testadas, então
 *      depender só dela deixaria a feature sem resposta justamente no caso comum.
 *
 * Por que o determinístico vem antes do LLM: nome de categoria de marketplace é curto e
 * repetitivo ("Panelas", "Chaveiros"), onde similaridade textual acerta e é auditável.
 * O LLM entra onde ele é melhor — dois candidatos plausíveis, decisão semântica.
 *
 * NADA aqui escreve. A escrita continua sendo `channelBindService.applyBinding`, e só
 * depois de confirmação humana.
 */

import { scoreForReuse } from './categoryMatcher.js'
import { normalizeName, tokenSet } from './categoryNormalizer.js'
import { generateStructured } from './llmService.js'

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const AUTO_DEFAULTS = {
  /** Acima disto, a sugestão da AnyMarket é aceita sem descer a árvore. */
  minSuggestionPercentage: num(process.env.ANYMARKET_BIND_MIN_SUGGESTION, 50),
  /** Score mínimo por nível para seguir descendo sem ajuda do LLM. */
  minScore: num(process.env.ANYMARKET_BIND_MIN_SCORE, 0.5),
  /** Abaixo disto nem com LLM a proposta é marcada como confiável. */
  lowConfidence: num(process.env.ANYMARKET_BIND_LOW_CONFIDENCE, 0.65),
  /** Diferença entre 1º e 2º colocados abaixo da qual chamamos o LLM para desempatar. */
  ambiguityGap: num(process.env.ANYMARKET_BIND_AMBIGUITY_GAP, 0.1),
  maxDepth: Math.max(1, num(process.env.ANYMARKET_BIND_MAX_DEPTH, 8)),
  /**
   * Quantas vezes a busca pode voltar um nível ao bater em beco sem saída.
   *
   * Pequeno de propósito: cada retorno é mais uma chamada ao LLM, e o ganho medido está
   * nos dois primeiros — depois disso, o sinal é que a categoria do hub não tem
   * equivalente claro no canal, e isso é informação para o operador, não algo para
   * insistir.
   */
  maxBacktracks: Math.max(0, num(process.env.ANYMARKET_BIND_MAX_BACKTRACKS, 2)),
  /**
   * Teto de candidatos enviados ao LLM por nível — alto de propósito.
   *
   * Medido: cortar em 10 por score textual ESCONDIA o ramo certo. Num nível intermediário
   * o score textual é ruído ("Acessórios Náuticos" e "Pneus e Acessórios" empatavam à
   * frente do ramo que continha "Tapetes"), então o corte descartava a resposta antes de
   * alguém poder escolhê-la. Um nível do Mercado Livre tem algumas dezenas de filhos;
   * mandar todos é barato e é o que faz a decisão ser possível.
   */
  candidatesForLlm: Math.max(2, num(process.env.ANYMARKET_BIND_LLM_CANDIDATES, 80)),
}

const CHOICE_SCHEMA = {
  name: 'channel_category_choice',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      codeInMarketPlace: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['codeInMarketPlace', 'confidence', 'reasoning'],
  },
}

// ── Pontuação de candidato (puro) ──────────────────────────────────────────────

/**
 * Peso da semelhança com o CAMINHO em relação à semelhança com a FOLHA.
 *
 * Menor que 1 de propósito, e isso é a lição do primeiro teste contra a árvore real do
 * Mercado Livre: para a categoria "Acessórios > Chaveiros", a sobreposição de tokens com
 * o caminho dava 0.5 tanto para "Acessórios para Veículos" quanto para "Câmeras e
 * Acessórios" — empate entre um destino razoável e um errado, e a descida parava no
 * nível 0 sem nunca chegar em "Chaveiros". Semelhança com o caminho é PISTA de rota;
 * quem decide destino é o nome da folha.
 */
const PESO_CAMINHO = 0.7

/** Acima disto o nome do canal é praticamente o mesmo da folha do hub — pode parar. */
const FOLHA_FORTE = 0.85

/**
 * Quanto um nó do canal combina com a categoria do hub.
 *
 * Duas medidas, com pesos diferentes:
 *   - `leafScore`: semelhança com o nome da FOLHA do hub ("Chaveiros" ↔ "Chaveiros").
 *     É o sinal que decide, porque é a folha que está sendo vinculada.
 *   - `pathScore`: sobreposição de tokens com o caminho INTEIRO. Serve para os níveis de
 *     cima, onde o nome do canal é mais largo ("Acessórios para Veículos" vs
 *     "Acessórios"), mas entra descontado — pista de rota, não veredito.
 *
 * O resultado carrega as duas medidas e a `metric` para a decisão ser auditável na tela:
 * o operador vê por que aquele destino foi proposto, em vez de um número solto.
 */
export function scoreChannelCandidate(candidateName, { leafName, pathTokens }) {
  // `scoreForReuse`, não `scoreNames`: sem containment. É a mesma decisão que
  // categoryMatcher.js já tomou para o reuso de categoria, e por um motivo que reapareceu
  // aqui — medido na conta real, "Chave de Roda" casou com "Rodas" em 1.0 por containment
  // e foi proposta com confiança máxima. Chave de roda é ferramenta, roda é peça: o
  // vínculo estaria errado, e com selo de certeza. Containment continua contando como
  // pista de ROTA (via `pathScore`), onde errar só custa uma descida extra.
  const direto = scoreForReuse(candidateName, leafName ?? '')
  const leafScore = Number(direto.score.toFixed(4))

  const tokensCandidato = tokenSet(candidateName)
  const alvo = pathTokens ?? new Set()
  let comuns = 0
  for (const token of tokensCandidato) if (alvo.has(token)) comuns++

  // Proporção dos tokens do candidato cobertos pelo caminho do hub. Divide pelo
  // candidato (não pelo alvo) para não premiar nome genérico e curto do canal.
  const pathScore = Number((tokensCandidato.size ? comuns / tokensCandidato.size : 0).toFixed(4))
  const descontado = pathScore * PESO_CAMINHO

  return descontado > leafScore
    ? { score: Number(descontado.toFixed(4)), leafScore, pathScore, metric: 'caminho' }
    : { score: leafScore, leafScore, pathScore, metric: direto.metric }
}

/** Ordena os filhos de um nível do melhor para o pior candidato. */
export function rankCandidates(childs, alvo) {
  return (childs ?? [])
    .map((child) => ({ ...child, ...scoreChannelCandidate(child.name ?? '', alvo) }))
    .sort((a, b) => b.score - a.score)
}

/** O nível está ambíguo — dois candidatos praticamente empatados? */
export function isAmbiguous(ranked, { minScore, ambiguityGap }) {
  if (!ranked.length) return false
  const [primeiro, segundo] = ranked
  if (primeiro.score < minScore) return true
  return Boolean(segundo) && primeiro.score - segundo.score < ambiguityGap
}

const alvoDoCaminho = (hubPath) => {
  const nomes = (Array.isArray(hubPath) ? hubPath : String(hubPath ?? '').split(/[/>]/))
    .map((parte) => String(parte).trim())
    .filter(Boolean)

  const tokens = new Set()
  for (const nome of nomes) for (const token of tokenSet(nome)) tokens.add(token)

  return { names: nomes, leafName: nomes[nomes.length - 1] ?? '', pathTokens: tokens }
}

// ── Desempate pelo LLM ─────────────────────────────────────────────────────────

/**
 * O prompt é de NAVEGAÇÃO, não de escolha final.
 *
 * A diferença importa e foi medida: perguntando "qual destes é a categoria equivalente?",
 * o modelo respondia "nenhum" num nível intermediário — corretamente, porque nenhum
 * daqueles nomes ERA a categoria; eles apenas levavam até ela. A pergunta certa num nível
 * intermediário é "por qual ramo se chega lá?".
 *
 * O score textual vai junto, mas rotulado como pista fraca — ele é bom para nomes iguais
 * e péssimo nos níveis de cima, e o modelo não deve tratá-lo como recomendação.
 */
const SYSTEM_ESCOLHA = `Você navega a árvore de categorias de um marketplace para encontrar onde uma categoria de um catálogo (hub) deve ser anunciada.
Você recebe UM nível da árvore. Sua tarefa é escolher por qual ramo continuar para chegar à categoria alvo — não é preciso que o nome do candidato seja igual ao alvo.
Regras:
- Escolha APENAS entre os códigos listados. Nunca invente código.
- Prefira o ramo mais específico que ainda CONTÉM o alvo.
- Devolva codeInMarketPlace null somente se nenhum ramo puder conter o alvo.
- O score é uma pista textual fraca (serve para nomes idênticos, engana nos níveis altos). Decida pelo significado.
- confidence entre 0 e 1: alta quando o ramo claramente contém o alvo, baixa quando é um chute.
- reasoning em português, uma frase curta.`

function buildChoiceMessage({ hubPath, marketplace, breadcrumb, candidatos, truncados = 0, isRoot = false }) {
  return [
    `Categoria alvo (no hub): ${hubPath.join(' > ')}`,
    `Categoria específica a vincular: ${hubPath[hubPath.length - 1] ?? '(desconhecida)'}`,
    `Marketplace: ${marketplace}`,
    breadcrumb.length ? `Você está em: ${breadcrumb.join(' > ')}` : 'Você está na raiz do canal',
    '',
    'Ramos disponíveis neste nível (código — nome — score textual):',
    ...candidatos.map((c) => `- ${c.codeInMarketPlace} — ${c.name} — ${c.score}`),
    ...(truncados > 0 ? ['', `(${truncados} ramos com score mais baixo foram omitidos)`] : []),
    // Na raiz, "nenhum serve" é quase sempre erro de leitura: a raiz cobre o catálogo
    // inteiro do marketplace. Medido: o modelo recusou a raiz do Mercado Livre para
    // "Chaveiros", que obviamente é vendido lá.
    ...(isRoot ? ['', 'Este é o nível RAIZ do marketplace: ele cobre todo o catálogo. Escolher null aqui significa que o marketplace não vende nada parecido — o que é raro.'] : []),
  ].join('\n')
}

/** Desempate pelo LLM. Falha aqui NÃO derruba a resolução: cai no determinístico. */
async function escolherComLlm({ hubPath, marketplace, breadcrumb, candidatos, model, truncados = 0, isRoot = false }) {
  try {
    const resposta = await generateStructured({
      systemPrompt: SYSTEM_ESCOLHA,
      userMessage: buildChoiceMessage({ hubPath, marketplace, breadcrumb, candidatos, truncados, isRoot }),
      jsonSchema: CHOICE_SCHEMA,
      model: model ?? 'gpt-4o-mini',
      temperature: 0.1,
    })

    // Blindagem contra código inventado: só vale o que estava na lista.
    const escolhido = candidatos.find((c) => c.codeInMarketPlace === resposta.codeInMarketPlace)
    if (!escolhido) return { node: null, confidence: 0, reasoning: resposta.reasoning ?? null, hallucinated: Boolean(resposta.codeInMarketPlace) }

    return { node: escolhido, confidence: Math.max(0, Math.min(1, Number(resposta.confidence) || 0)), reasoning: resposta.reasoning ?? null }
  } catch (err) {
    console.warn(`[ChannelBindResolver] Desempate pelo LLM indisponível (${err.message}) — seguindo pelo score.`)
    return null
  }
}

// ── Descida na árvore do canal ─────────────────────────────────────────────────

/**
 * Percorre a árvore nativa do canal até o destino do vínculo.
 *
 * Não é uma descida cega: é busca com **retorno**. A versão anterior escolhia o melhor
 * ramo em cada nível e seguia em frente; quando o ramo estava errado, o resultado era um
 * destino ruim com confiança baixa e ponto final. Medido na conta real: para "Macacos", o
 * LLM entrou em "Peças de Carros e Caminhonetes", encontrou um beco sem saída e devolveu
 * essa categoria intermediária — enquanto "Ferramentas para Veículos" estava ali ao lado,
 * como segunda opção do mesmo nível. Com retorno, o beco faz a busca voltar e tentar o
 * ramo seguinte.
 *
 * `fetchLevel(code)` é injetado (o serviço passa a versão com cache), então o retorno
 * custa pouco: os níveis já visitados não vão à rede de novo.
 *
 * Devolve sempre o RASTRO das decisões — é o que a tela mostra para a confirmação ser
 * informada, em vez de "confie em mim".
 */
export async function resolveByDescent({
  hubPath,
  marketplace,
  fetchLevel,
  options = {},
  model = null,
  useLlm = true,
  // Ponto de injeção do desempate semântico. O teste da MECÂNICA da busca (descer, voltar,
  // parar) não pode depender do humor de um modelo — e a mecânica é a parte que quebra num
  // refactor.
  chooseWithLlm = null,
}) {
  const cfg = { ...AUTO_DEFAULTS, ...options }
  const alvo = alvoDoCaminho(hubPath)
  const trail = []
  const confiancasLlm = []

  let usouLlm = false
  let retornos = 0
  /** Melhor destino vinculável visto até agora — a rede de segurança se a busca esgotar. */
  let melhorVinculavel = null

  const folhaDe = (nome) => scoreChannelCandidate(nome ?? '', alvo).leafScore

  const raiz = await fetchLevel(null)
  const pilha = [{ code: null, level: raiz, tentados: new Set() }]

  while (pilha.length) {
    if (pilha.length > cfg.maxDepth) {
      trail.push({ depth: pilha.length - 1, chosen: null, reason: `limite de profundidade (${cfg.maxDepth})` })
      break
    }

    const quadro = pilha[pilha.length - 1]
    const depth = pilha.length - 1
    const ranked = rankCandidates(quadro.level?.childs, alvo).filter((c) => !quadro.tentados.has(c.codeInMarketPlace))

    // Nível esgotado: ou volta um nível, ou a busca termina.
    if (!ranked.length) {
      if (pilha.length > 1 && retornos < cfg.maxBacktracks) {
        retornos++
        pilha.pop()
        trail.push({ depth, chosen: null, reason: 'ramo esgotado — voltando um nível', backtrack: true })
        continue
      }
      trail.push({ depth, chosen: null, reason: 'nenhum ramo restante neste nível' })
      break
    }

    let escolhido = ranked[0]
    let motivo = `melhor score do nível (${escolhido.metric})`

    if (useLlm && isAmbiguous(ranked, cfg)) {
      const veredito = await (chooseWithLlm ?? escolherComLlm)({
        hubPath: alvo.names,
        marketplace,
        breadcrumb: (quadro.level?.path ?? []).map((p) => p.name).filter(Boolean),
        candidatos: ranked.slice(0, cfg.candidatesForLlm),
        truncados: Math.max(0, ranked.length - cfg.candidatesForLlm),
        isRoot: depth === 0,
        model,
      })

      if (veredito) {
        usouLlm = true

        if (!veredito.node) {
          // Recusa na RAIZ não aborta a busca. A raiz cobre o catálogo inteiro do
          // marketplace, então "nenhum ramo serve" ali é quase sempre leitura errada do
          // modelo — medido com "Chaveiros", que o Mercado Livre obviamente vende. Segue
          // pelo melhor candidato textual, marcado como decisão fraca.
          if (pilha.length === 1) {
            trail.push({
              depth,
              chosen: null,
              reason: `LLM recusou a raiz ("${veredito.reasoning ?? 'sem motivo'}") — seguindo pelo melhor score`,
              rootRefusal: true,
            })
            confiancasLlm.push(cfg.lowConfidence)
            motivo = 'melhor score do nível (LLM não escolheu na raiz)'
          } else if (retornos < cfg.maxBacktracks) {
            // Fora da raiz, "nenhum ramo contém o alvo" costuma acusar o nível ANTERIOR:
            // entramos no galho errado. Voltar e tentar o ramo seguinte é melhor que
            // aceitar o menos ruim deste nível.
            retornos++
            pilha.pop()
            trail.push({
              depth,
              chosen: null,
              reason: veredito.reasoning ?? 'nenhum ramo pode conter o alvo (LLM)',
              backtrack: true,
            })
            continue
          } else {
            // Sem orçamento de retorno: encerra. A rede de segurança (`melhorVinculavel`)
            // decide se ainda sai uma proposta de baixa confiança.
            trail.push({
              depth,
              chosen: null,
              reason: veredito.reasoning ?? 'nenhum ramo pode conter o alvo (LLM)',
              candidates: ranked.slice(0, 3),
              ...(veredito.hallucinated ? { hallucinated: true } : {}),
            })
            break
          }
        } else {
          escolhido = veredito.node
          confiancasLlm.push(veredito.confidence)
          motivo = veredito.reasoning ?? 'desempate pelo LLM'
        }

      }
    }

    if (escolhido.score < cfg.minScore && !usouLlm) {
      trail.push({ depth, chosen: null, reason: `nenhum candidato acima do piso (${cfg.minScore})`, candidates: ranked.slice(0, 3) })
      break
    }

    quadro.tentados.add(escolhido.codeInMarketPlace)

    // Só o GET do nó revela se ele é vinculável e se tem filhos — a lista de filhos do
    // nível pai não traz `canBeSelected`.
    const filho = await fetchLevel(escolhido.codeInMarketPlace)
    const daFolha = folhaDe(filho?.name ?? escolhido.name)

    trail.push({
      depth,
      chosen: { codeInMarketPlace: escolhido.codeInMarketPlace, name: escolhido.name, score: escolhido.score, leafScore: daFolha },
      reason: motivo,
      candidates: ranked.slice(1, 3),
    })

    const vinculavel = Boolean(filho?.canBeSelected)
    const filhos = rankCandidates(filho?.childs, alvo)
    const melhorFilho = filhos[0]

    // Registra a melhor opção vinculável encontrada, para não voltar de mãos vazias.
    if (vinculavel && (!melhorVinculavel || daFolha > melhorVinculavel.leafScore)) {
      melhorVinculavel = {
        codeInMarketPlace: escolhido.codeInMarketPlace,
        node: filho,
        leafScore: daFolha,
        llmConfidences: [...confiancasLlm],
        depth,
      }
    }

    // Achou o nome da folha e nenhum filho chega mais perto: é aqui. Descer mais só
    // porque há filhos é escolher "Panelas de Pressão" para um produto que é "Panela".
    if (vinculavel && daFolha >= FOLHA_FORTE && (!melhorFilho || melhorFilho.leafScore <= daFolha)) {
      return montarResultado({ code: escolhido.codeInMarketPlace, node: filho, daFolha, confiancasLlm, trail, usouLlm, cfg, retornos })
    }

    // Beco sem saída: nó sem filhos. Se dá para vincular, é candidato; se não, volta.
    if (!filhos.length) {
      if (vinculavel) {
        return montarResultado({ code: escolhido.codeInMarketPlace, node: filho, daFolha, confiancasLlm, trail, usouLlm, cfg, retornos })
      }
      if (retornos < cfg.maxBacktracks) {
        retornos++
        trail.push({ depth, chosen: null, reason: `${filho?.name ?? escolhido.name} não é vinculável e não tem subcategorias — voltando`, backtrack: true })
        continue
      }
      break
    }

    // Parar por "nenhum filho melhora" só vale se o nó atual JÁ é uma correspondência
    // decente. Medido: para "Tapetes", a busca parava em "Aces. de Carros e Caminhonetes"
    // (semelhança 0.15 com a folha) porque os filhos — "Interior", "Exterior", "Outros" —
    // também não casavam por texto. Mas nenhum dos dois lados casar é justamente o caso em
    // que o significado precisa ser consultado: "Tapetes" está sob "Interior". O nó
    // continua guardado como rede de segurança em `melhorVinculavel`.
    if (vinculavel && daFolha >= cfg.lowConfidence && melhorFilho.leafScore <= daFolha) {
      return montarResultado({ code: escolhido.codeInMarketPlace, node: filho, daFolha, confiancasLlm, trail, usouLlm, cfg, retornos })
    }

    pilha.push({ code: escolhido.codeInMarketPlace, level: filho, tentados: new Set() })
  }

  // A busca terminou sem destino claro. Duas saídas, e a diferença entre elas importa:
  //
  //   - passou por um nó com semelhança razoável → vale como proposta de baixa confiança,
  //     com o rastro explicando o caminho;
  //   - só passou por nós sem relação com o alvo → devolve NÃO RESOLVIDO, com o palpite
  //     de lado. Medido: para "Chaveiros" a busca acabou em "Agro" (0.375) depois de o LLM
  //     recusar a raiz três vezes. Propor "Agro" com selo de "confira" é pior que dizer
  //     "não achei" — a primeira opção convida a confirmar no automático.
  if (melhorVinculavel && melhorVinculavel.leafScore < cfg.minScore) {
    return {
      resolved: false,
      reason: 'nenhuma categoria do canal se aproxima desta categoria — precisa de escolha manual',
      bestGuess: {
        codeInMarketPlace: melhorVinculavel.codeInMarketPlace,
        name: melhorVinculavel.node?.name ?? null,
        completePath: melhorVinculavel.node?.completePath ?? null,
        leafScore: melhorVinculavel.leafScore,
      },
      trail,
      usedLlm: usouLlm,
      backtracks: retornos,
    }
  }

  if (melhorVinculavel) {
    return montarResultado({
      code: melhorVinculavel.codeInMarketPlace,
      node: melhorVinculavel.node,
      daFolha: melhorVinculavel.leafScore,
      confiancasLlm: melhorVinculavel.llmConfidences,
      trail,
      usouLlm,
      cfg,
      retornos,
      fallback: true,
    })
  }

  return {
    resolved: false,
    // O motivo tem de ser o que PAROU a busca (um passo sem escolha), não a última escolha
    // feita — senão a tela mostra "melhor score do nível" como se fosse uma falha.
    reason:
      [...trail].reverse().find((t) => !t.chosen && !t.backtrack)?.reason ??
      [...trail].reverse().find((t) => !t.chosen)?.reason ??
      'nenhuma categoria vinculável encontrada na árvore do canal',
    trail,
    usedLlm: usouLlm,
    backtracks: retornos,
  }
}

/**
 * Confiança final e formato da proposta.
 *
 * O nome exato da folha fala por si. Fora disso, a decisão mais frágil do caminho é o
 * teto: um desempate semântico duvidoso num nível de cima limita o quanto se pode
 * confiar no destino, mesmo que o último nível pareça bom.
 */
function montarResultado({ code, node, daFolha, confiancasLlm, trail, usouLlm, cfg, retornos, fallback = false }) {
  const confianca = daFolha >= FOLHA_FORTE ? daFolha : Math.min(daFolha, ...confiancasLlm, fallback ? 0.5 : 1)

  return {
    resolved: true,
    codeInMarketPlace: code,
    name: node?.name ?? null,
    completePath: node?.completePath ?? null,
    confidence: Number(Math.max(0, confianca).toFixed(4)),
    lowConfidence: confianca < cfg.lowConfidence,
    exactLeafMatch: daFolha >= FOLHA_FORTE,
    isReceivingItens: node?.isReceivingItens ?? null,
    fallback,
    backtracks: retornos,
    trail,
    usedLlm: usouLlm,
    source: 'auto',
  }
}

/**
 * A sugestão da AnyMarket serve sem descer a árvore?
 *
 * `percentage` vem em escala 0–100. Converter aqui, num lugar só, e devolver 0–1 igual
 * ao score do matcher — a tela mostra as duas origens na mesma régua.
 */
export function pickSuggestion(suggestions, options = {}) {
  const cfg = { ...AUTO_DEFAULTS, ...options }
  const melhor = (suggestions ?? []).find((s) => s.codeInMarketPlace && (s.percentage ?? 0) >= cfg.minSuggestionPercentage)
  if (!melhor) return null

  return {
    resolved: true,
    codeInMarketPlace: melhor.codeInMarketPlace,
    name: melhor.name ?? null,
    completePath: melhor.completePath ?? melhor.name ?? null,
    confidence: Number((melhor.percentage / 100).toFixed(4)),
    lowConfidence: melhor.percentage / 100 < cfg.lowConfidence,
    source: 'suggestion',
    trail: [{ depth: 0, chosen: { codeInMarketPlace: melhor.codeInMarketPlace, name: melhor.name, score: melhor.percentage }, reason: 'sugestão da AnyMarket' }],
    usedLlm: false,
  }
}

/** Só para diagnóstico/log: caminho canônico do alvo. */
export const debugTarget = (hubPath) => {
  const alvo = alvoDoCaminho(hubPath)
  return { leaf: normalizeName(alvo.leafName), tokens: [...alvo.pathTokens] }
}
