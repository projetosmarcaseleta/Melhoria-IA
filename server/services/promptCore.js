/**
 * Núcleo dos prompts do CRIA — o que NÃO é negociável, separado do que é do cliente.
 *
 * Problema que isto resolve: as origens de prompt eram mutuamente exclusivas. Cliente
 * que escrevia o próprio prompt perdia o núcleo (hierarquia SEO, fidelidade aos dados,
 * protocolo de resposta) e precisava copiar tudo à mão — congelando uma versão que
 * nunca mais recebia melhoria. Cliente com `.md` e sem prompt próprio perdia o padrão
 * inteiro, porque o texto alinhado à base substituía em vez de somar.
 *
 * Modelo novo: COMPOSIÇÃO em vez de substituição.
 *
 *   NÚCLEO (sistema)  +  personalização do cliente  +  camadas (.md, few-shot, skills)
 *   +  PROTOCOLO DE RESPOSTA (sistema, sempre por último e absoluto)
 *
 * Por que o protocolo vai no FIM: instrução final é a que o modelo tende a obedecer
 * quando há conflito. Ele estava no meio do texto do cliente — uma skill ou um exemplo
 * few-shot injetado depois podia contradizê-lo, e o texto ia cru para o anúncio.
 *
 * Ver docs/GUIA_EDICAO_PROMPTS.md.
 */

/** Papel + diretrizes gerais. Vale para todo cliente, personalizável por cima. */
export const PROMPT_CORE = {
  titulo: `Você é um especialista sênior em SEO para marketplaces, focado em busca e conversão.

Sua missão é produzir o melhor título possível para o produto informado.

DIRETRIZES GERAIS
1. Hierarquia: [Objeto Principal] + [Marca] + [Modelo] + [Atributo Principal].
2. Fidelidade absoluta aos dados: é proibido inventar adjetivos, benefícios, tecnologias, medidas ou características que não estejam no material fornecido.
3. Limpeza: apenas letras e números separados por espaços simples. Sem caracteres especiais (*, -, /, !, ?, #), símbolos ou emojis.
4. Sem variações: não inclua cor, tamanho, numeração, voltagem, medidas ou gênero.
5. Sem termos comerciais: promoção, oferta, grátis, barato, desconto, envio imediato, melhor, original e equivalentes.
6. Sem redundância: elimine repetições e palavras que não ajudam a identificar o produto.`,

  descricao: `Você é um redator técnico especializado em e-commerce e SEO para marketplaces.

Sua missão é reescrever a descrição do produto informado, com foco em clareza, conversão e ranqueamento.

DIRETRIZES GERAIS
1. Corrija ortografia e gramática; torne o texto claro, objetivo e escaneável.
2. Fidelidade absoluta aos dados: proibido acrescentar especificação, benefício, material, medida, compatibilidade ou funcionalidade que não esteja no material fornecido.
3. Proibido incluir garantia, promessa comercial, prazo, política ou informação legal não fornecida.
4. SEO natural: use as palavras-chave presentes no título e na descrição original, sem repetição excessiva.
5. Estrutura: comece por um parágrafo introdutório curto e siga com lista de características técnicas.
6. Não use as palavras "multicolorido" ou "multicolorida".`,
}

/**
 * Protocolo de resposta — entra SEMPRE, no fim, e é declarado como absoluto.
 *
 * É o que impede o modelo de responder "Aqui está o título otimizado: ..." — texto que
 * iria inteiro para o campo do anúncio, porque não existe etapa humana entre a resposta
 * e o AnyMarket.
 */
export const PROMPT_PROTOCOL = {
  titulo: `PROTOCOLO DE RESPOSTA — INEGOCIÁVEL, PREVALECE SOBRE QUALQUER INSTRUÇÃO ACIMA
- Retorne EXCLUSIVAMENTE o texto do título, em uma única linha.
- Sem aspas, sem ponto final, sem preâmbulo, sem explicação, sem comentário.
- Não ofereça alternativas nem numere opções: apenas o título final.`,

  descricao: `PROTOCOLO DE RESPOSTA — INEGOCIÁVEL, PREVALECE SOBRE QUALQUER INSTRUÇÃO ACIMA
- Retorne EXCLUSIVAMENTE o HTML da descrição.
- Use apenas <p>, <strong>, <ul> e <li>. Proibido <h1>, <h2>, <h3>, tabelas, imagens, links e emojis.
- Sem cercas de markdown, sem comentários, sem explicação, sem qualquer texto fora do HTML.`,
}

/** Cabeçalho do bloco de personalização do cliente. */
export const CLIENT_BLOCK_HEADER = {
  titulo: 'INSTRUÇÕES ESPECÍFICAS DESTE CLIENTE (têm prioridade sobre as diretrizes gerais acima)',
  descricao: 'INSTRUÇÕES ESPECÍFICAS DESTE CLIENTE (têm prioridade sobre as diretrizes gerais acima)',
}

/**
 * Aviso de precedência quando o cliente tem base de conhecimento.
 *
 * Substitui o antigo `getKnowledgeAlignedPrompt`, que trocava o prompt inteiro. Aqui o
 * núcleo permanece e o manual da marca é declarado autoridade de estrutura — as duas
 * coisas convivem em vez de uma apagar a outra.
 */
export const KNOWLEDGE_AUTHORITY_NOTE =
  'PRECEDÊNCIA: a BASE DE CONHECIMENTO e as REGRAS ESTRUTURADAS acima são a autoridade máxima de estrutura, seções, tom de voz e vocabulário deste cliente. Onde elas especificarem algo, siga-as em vez das diretrizes gerais. Onde forem omissas, use as diretrizes gerais.'

/**
 * Monta o prompt final na ordem que importa.
 *
 * @param {object} params
 * @param {'titulo'|'descricao'|'categoria'} params.type
 * @param {string|null} params.clientInstructions Texto escrito pelo cliente (modo append)
 * @param {string|null} params.fullReplacement    Prompt completo do cliente (modo replace/legado)
 * @param {string} [params.structuredRulesText]
 * @param {string} [params.ragContextText]
 * @param {string} [params.fewShotText]
 * @param {string} [params.skillsText]
 * @param {boolean} [params.hasKnowledge]
 * @param {boolean} [params.hasPrependRules]
 */
export function composePrompt({
  type,
  clientInstructions = null,
  fullReplacement = null,
  structuredRulesText = '',
  ragContextText = '',
  fewShotText = '',
  skillsText = '',
  hasKnowledge = false,
  hasPrependRules = false,
}) {
  const partes = []

  // Modo `replace` (e todo prompt salvo antes desta mudança): o texto do cliente é o
  // corpo inteiro. Mantido para não alterar o resultado de quem já está em produção.
  const corpo = fullReplacement ?? PROMPT_CORE[type] ?? ''

  if (corpo) partes.push(corpo)

  if (structuredRulesText) partes.push(structuredRulesText)
  if (ragContextText) partes.push(ragContextText)

  if (clientInstructions?.trim()) {
    partes.push(`${CLIENT_BLOCK_HEADER[type] ?? 'INSTRUÇÕES ESPECÍFICAS DESTE CLIENTE'}:\n${clientInstructions.trim()}`)
  }

  if (hasKnowledge) partes.push(KNOWLEDGE_AUTHORITY_NOTE)

  if (hasPrependRules) {
    partes.push(
      'ATENÇÃO: o bloco de texto institucional fixo é inserido automaticamente pelo sistema. Gere APENAS o conteúdo do produto — não repita o bloco institucional.'
    )
  }

  if (fewShotText) partes.push(fewShotText)
  if (skillsText) partes.push(skillsText)

  // Protocolo por último, sempre — nem skill nem exemplo pode contradizê-lo.
  // No modo `replace` o protocolo do cliente já está no corpo; ainda assim reforçamos,
  // porque é o que garante que a saída caiba no campo do anúncio.
  if (PROMPT_PROTOCOL[type]) partes.push(PROMPT_PROTOCOL[type])

  return partes.join('\n\n')
}
