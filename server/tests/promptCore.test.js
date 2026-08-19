import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { composePrompt, PROMPT_CORE, PROMPT_PROTOCOL, KNOWLEDGE_AUTHORITY_NOTE } from '../services/promptCore.js'

describe('promptCore — cliente sem RAG e sem personalização', () => {
  it('deve entregar núcleo + protocolo, funcionando sem nenhuma configuração', () => {
    const prompt = composePrompt({ type: 'titulo' })

    assert.ok(prompt.includes('especialista sênior em SEO'), 'núcleo deve estar presente')
    assert.ok(prompt.includes('DIRETRIZES GERAIS'))
    assert.ok(prompt.includes('PROTOCOLO DE RESPOSTA'))
    assert.ok(!prompt.includes('INSTRUÇÕES ESPECÍFICAS DESTE CLIENTE'), 'sem personalização, sem bloco do cliente')
  })

  it('descrição também funciona sem configuração', () => {
    const prompt = composePrompt({ type: 'descricao' })

    assert.ok(prompt.includes('redator técnico'))
    assert.ok(prompt.includes('<p>, <strong>, <ul> e <li>'))
  })
})

describe('promptCore — personalização somando ao núcleo (modo append)', () => {
  it('deve manter o núcleo E acrescentar as instruções do cliente', () => {
    const prompt = composePrompt({
      type: 'titulo',
      clientInstructions: 'Sempre cite a voltagem em produtos elétricos.',
    })

    // O ganho central do modelo de composição: o cliente escreve DUAS linhas e não
    // perde as diretrizes gerais nem o protocolo.
    assert.ok(prompt.includes('DIRETRIZES GERAIS'), 'núcleo não pode desaparecer')
    assert.ok(prompt.includes('Sempre cite a voltagem'))
    assert.ok(prompt.includes('INSTRUÇÕES ESPECÍFICAS DESTE CLIENTE'))
    assert.ok(prompt.includes('PROTOCOLO DE RESPOSTA'))
  })

  it('a personalização deve vir DEPOIS do núcleo e ANTES do protocolo', () => {
    const prompt = composePrompt({ type: 'titulo', clientInstructions: 'MARCADOR_CLIENTE' })

    const posNucleo = prompt.indexOf('DIRETRIZES GERAIS')
    const posCliente = prompt.indexOf('MARCADOR_CLIENTE')
    const posProtocolo = prompt.indexOf('PROTOCOLO DE RESPOSTA')

    assert.ok(posNucleo < posCliente, 'cliente depois do núcleo: prioridade sobre as diretrizes gerais')
    assert.ok(posCliente < posProtocolo, 'protocolo por último: nada pode contradizê-lo')
  })

  it('personalização vazia ou só espaços não cria bloco', () => {
    for (const vazio of ['', '   ', '\n', null, undefined]) {
      const prompt = composePrompt({ type: 'titulo', clientInstructions: vazio })
      assert.ok(!prompt.includes('INSTRUÇÕES ESPECÍFICAS'), `"${JSON.stringify(vazio)}" não deveria criar bloco`)
    }
  })
})

describe('promptCore — modo replace (legado)', () => {
  it('deve usar o texto do cliente como corpo, sem o núcleo', () => {
    const prompt = composePrompt({ type: 'titulo', fullReplacement: 'PROMPT INTEIRO DO CLIENTE' })

    assert.ok(prompt.startsWith('PROMPT INTEIRO DO CLIENTE'))
    assert.ok(!prompt.includes('DIRETRIZES GERAIS'), 'no modo replace o núcleo dá lugar ao texto do cliente')
  })

  it('deve reforçar o protocolo mesmo no modo replace', () => {
    // Rede de segurança: se o cliente apagou o protocolo do texto dele, o sistema
    // recoloca — é o que impede "Aqui está o título: ..." de virar título do anúncio.
    const prompt = composePrompt({ type: 'titulo', fullReplacement: 'Escreva um título bonito.' })
    assert.ok(prompt.includes('PROTOCOLO DE RESPOSTA'))
    assert.ok(prompt.trimEnd().endsWith(PROMPT_PROTOCOL.titulo.trimEnd()))
  })
})

describe('promptCore — ordem e precedência das camadas', () => {
  it('deve montar todas as camadas na ordem certa', () => {
    const prompt = composePrompt({
      type: 'descricao',
      clientInstructions: 'CLIENTE',
      structuredRulesText: 'REGRAS_ESTRUTURADAS',
      ragContextText: 'BASE_CONHECIMENTO',
      fewShotText: 'EXEMPLOS',
      skillsText: 'SKILLS',
      hasKnowledge: true,
      hasPrependRules: true,
    })

    const ordem = ['DIRETRIZES GERAIS', 'REGRAS_ESTRUTURADAS', 'BASE_CONHECIMENTO', 'CLIENTE', 'PRECEDÊNCIA', 'EXEMPLOS', 'SKILLS', 'PROTOCOLO DE RESPOSTA']
    const posicoes = ordem.map((marcador) => prompt.indexOf(marcador))

    for (const [i, pos] of posicoes.entries()) {
      assert.ok(pos >= 0, `"${ordem[i]}" não foi encontrado no prompt`)
      if (i > 0) assert.ok(pos > posicoes[i - 1], `"${ordem[i]}" deveria vir depois de "${ordem[i - 1]}"`)
    }
  })

  it('com base de conhecimento, deve declarar a precedência do manual da marca', () => {
    const comRag = composePrompt({ type: 'descricao', hasKnowledge: true })
    const semRag = composePrompt({ type: 'descricao', hasKnowledge: false })

    assert.ok(comRag.includes(KNOWLEDGE_AUTHORITY_NOTE))
    assert.ok(!semRag.includes(KNOWLEDGE_AUTHORITY_NOTE))
  })

  it('com bloco fixo determinístico, deve avisar para não repetir', () => {
    const prompt = composePrompt({ type: 'descricao', hasPrependRules: true })
    assert.ok(prompt.includes('não repita o bloco institucional'))
  })

  it('tipo sem núcleo definido (categoria) não deve inventar corpo', () => {
    const prompt = composePrompt({ type: 'categoria', fullReplacement: 'CLASSIFICADOR' })

    assert.equal(prompt, 'CLASSIFICADOR', 'categoria não recebe núcleo nem protocolo de título/descrição')
    assert.equal(PROMPT_CORE.categoria, undefined)
  })
})
