/**
 * Testes do vínculo de categoria por canal (docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md §6).
 *
 * Duas coberturas são exigência explícita da especificação:
 *   - "cleanBoundAttributes sucede, bind falha" (§1.5) — o estado pela metade;
 *   - obrigatoriedade de atributo variável por canal (§2).
 *
 * As respostas do painel são mockadas por injeção de dependência: os endpoints da §1
 * não têm contrato público, então teste de integração real contra eles seria teste do
 * humor da AnyMarket, não do CRIA.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeBindings,
  normalizeSuggestions,
  normalizeMarketplaceLevel,
  toBindCompletePath,
  assertMarketplace,
  assertCategoryId,
  assertMarketplaceCode,
  isPanelRejectingToken,
  isPanelTokenExpired,
  normalizeMarketplaceCatalog,
  normalizeAccountMarketplaces,
} from '../services/channelBindClient.js'
import {
  applyBinding,
  getBindingStatus,
  canSkipClean,
  classifyTransmissionIssue,
  bindingDocId,
  isLockHeldError,
  isPanelUnavailable,
  ChannelBindError,
} from '../services/channelBindService.js'
import {
  normalizeCharacteristicGroups,
  attributesForMarketplace,
  missingRequiredAttributes,
  buildCharacteristicsPatch,
  normalizeProductCharacteristics,
  extractGroupCategoryIds,
  ALL_CHANNELS,
} from '../services/categoryAttributesService.js'
import { extractItems } from '../services/anymarketClient.js'
import { TEST_CLIENT_ID, resetMockChannelBindState, getMockChannelBinding, getMockBindIntent, getMockCharacteristicGroups } from '../services/mockStorage.js'

const CATEGORIA = '1012'
const CANAL = 'MERCADO_LIVRE'

describe('channelBindClient — leitura defensiva do payload interno', () => {
  it('normalizeBindings deve tratar vínculo removido como NÃO vinculado', () => {
    const bindings = normalizeBindings({
      marketPlaces: [
        { marketPlace: 'MERCADO_LIVRE', codeInMarketPlace: 'MLB63512', completePath: 'A > B', removed: false, properties: { bindIndex: '0' } },
        { marketPlace: 'MAGAZINE_LUIZA', codeInMarketPlace: 'ML-PAN', removed: true },
      ],
    })

    assert.equal(bindings.length, 2)
    assert.equal(bindings[0].removed, false)
    assert.equal(bindings[0].bindIndex, '0')
    // O painel mantém o vínculo desfeito no array; quem lê tem de ver `removed`.
    assert.equal(bindings[1].removed, true)
  })

  it('normalizeBindings deve aceitar as variações de nome do campo e descartar lixo', () => {
    assert.deepEqual(normalizeBindings(null), [])
    assert.deepEqual(normalizeBindings({ marketPlaces: 'nao-e-array' }), [])
    assert.equal(normalizeBindings({ marketplaces: [{ marketplace: 'shopee', codeInMarketPlace: '1' }] })[0].marketplace, 'SHOPEE')
    // Item sem canal não vira `{ marketplace: null }` solto na UI.
    assert.deepEqual(normalizeBindings({ marketPlaces: [{ codeInMarketPlace: 'X' }] }), [])
  })

  it('normalizeSuggestions deve ordenar por confiança e exigir código', () => {
    const sugestoes = normalizeSuggestions({
      content: [
        { codeInMarketPlace: 'A', percentage: 12.5 },
        { codeInMarketPlace: 'B', percentage: 66.67 },
        { name: 'sem codigo', percentage: 99 },
      ],
    })

    assert.deepEqual(
      sugestoes.map((s) => s.codeInMarketPlace),
      ['B', 'A']
    )
    // Escala preservada como veio (0–100): converter em dois lugares é o caminho do bug.
    assert.equal(sugestoes[0].percentage, 66.67)
  })

  it('normalizeMarketplaceLevel deve expor folha vinculável e breadcrumb', () => {
    const nivel = normalizeMarketplaceLevel({
      name: 'Cozinha',
      canBeSelected: false,
      completePath: 'Casa/Cozinha',
      path: [{ codeInMarketPlace: 'MLB1000', name: 'Casa' }],
      childs: [
        { codeInMarketPlace: 'MLB63512', name: 'Panelas', canBeSelected: true },
        { code: 'MLB63513', name: 'Jogos', canBeSelected: false },
      ],
    })

    assert.equal(nivel.canBeSelected, false)
    assert.equal(nivel.path.length, 1)
    assert.equal(nivel.childs.length, 2)
    assert.equal(nivel.childs[0].canBeSelected, true)
    // `code` também é aceito como código do canal.
    assert.equal(nivel.childs[1].codeInMarketPlace, 'MLB63513')
  })
})

describe('channelBindClient — completePath: "/" do drill-down vs ">" do PUT (§1.5)', () => {
  it('deve converter o separador do drill-down para o do vínculo', () => {
    assert.equal(toBindCompletePath('Categoria A/Categoria B/Categoria C'), 'Categoria A > Categoria B > Categoria C')
  })

  it('deve ser idempotente para string já no formato do PUT', () => {
    assert.equal(toBindCompletePath('A > B > C'), 'A > B > C')
    assert.equal(toBindCompletePath('A>B>  C'), 'A > B > C')
  })

  it('deve aceitar o breadcrumb como array de nós ou de strings', () => {
    assert.equal(toBindCompletePath([{ name: 'A' }, { name: 'B' }]), 'A > B')
    assert.equal(toBindCompletePath(['A', 'B']), 'A > B')
    assert.equal(toBindCompletePath([]), '')
    assert.equal(toBindCompletePath(null), '')
  })
})

describe('channelBindClient — validação dos identificadores que entram na URL', () => {
  it('deve normalizar canal para maiúsculas e recusar valor fora do formato', () => {
    assert.equal(assertMarketplace('mercado_livre'), 'MERCADO_LIVRE')
    assert.throws(() => assertMarketplace('mercado livre'), /Canal inválido/)
    assert.throws(() => assertMarketplace(''), /Canal inválido/)
  })

  it('deve recusar id de categoria com caractere de caminho', () => {
    assert.equal(assertCategoryId(1012), '1012')
    assert.throws(() => assertCategoryId('1012/marketplaces'), /inválido/)
    assert.throws(() => assertCategoryId('../categories'), /inválido/)
  })

  it('deve recusar categoria criada em modo simulado', () => {
    // Id de ANYMARKET_DRY_RUN não existe no hub: 404 do painel pareceria contrato quebrado.
    assert.throws(() => assertCategoryId('dry-123-4'), /modo simulado/)
  })

  it('deve recusar código de canal com query string embutida', () => {
    assert.equal(assertMarketplaceCode('MLB63512'), 'MLB63512')
    assert.throws(() => assertMarketplaceCode('MLB1?x=1'), /inválido/)
  })
})

describe('channelBindService — aplicar vínculo (§1.5)', () => {
  beforeEach(() => resetMockChannelBindState())

  const baseParams = {
    anymarketCategoryId: CATEGORIA,
    marketplace: CANAL,
    codeInMarketPlace: 'MLB63512',
    completePath: 'Casa/Cozinha/Panelas',
    source: 'suggestion',
  }

  it('deve chamar cleanBoundAttributes ANTES do PUT do vínculo', async () => {
    const ordem = []
    const deps = {
      cleanBoundAttributes: async () => {
        ordem.push('clean')
      },
      putCategoryBinding: async () => {
        ordem.push('bind')
      },
    }

    const result = await applyBinding(TEST_CLIENT_ID, baseParams, { userId: 'op-1', deps })

    assert.deepEqual(ordem, ['clean', 'bind'])
    assert.equal(result.bound, true)
    // Origem registrada: é o que permite medir a qualidade das sugestões depois.
    assert.equal(result.suggestionAccepted, true)
    assert.equal(result.source, 'suggestion')
    // Convertido para o separador do PUT, não repassado como veio do drill-down.
    assert.equal(result.completePath, 'Casa > Cozinha > Panelas')
  })

  it('deve mandar suggestionAccepted=false quando a escolha foi manual', async () => {
    let recebido = null
    await applyBinding(
      TEST_CLIENT_ID,
      { ...baseParams, source: 'manual' },
      { userId: 'op-1', deps: { putCategoryBinding: async (_t, params) => { recebido = params } } }
    )

    assert.equal(recebido.suggestionAccepted, false)
  })

  it('deve recusar origem desconhecida e completePath vazio', async () => {
    await assert.rejects(() => applyBinding(TEST_CLIENT_ID, { ...baseParams, source: 'chute' }, {}), /Origem do vínculo inválida/)
    await assert.rejects(() => applyBinding(TEST_CLIENT_ID, { ...baseParams, completePath: '  ' }, {}), /completePath/)
  })

  it('CASO CRÍTICO — limpeza sucede e vínculo falha: erro diz que ficou pela metade', async () => {
    let limpezas = 0
    const deps = {
      cleanBoundAttributes: async () => {
        limpezas++
      },
      putCategoryBinding: async () => {
        throw new Error('ECONNRESET')
      },
    }

    const err = await applyBinding(TEST_CLIENT_ID, baseParams, { userId: 'op-1', deps }).then(
      () => null,
      (e) => e
    )

    assert.ok(err instanceof ChannelBindError)
    assert.equal(err.code, 'bind_failed_after_clean')
    assert.equal(err.detail.retrySafe, true)
    assert.match(err.message, /foram limpos/)
    assert.match(err.message, /não vai publicar/i)
    assert.equal(limpezas, 1)

    // O de-para NÃO pode ter sido gravado, e a intenção FICA registrada — é ela que
    // torna o retry seguro.
    assert.equal(getMockChannelBinding(TEST_CLIENT_ID, CATEGORIA, CANAL), null)
    const intent = getMockBindIntent(TEST_CLIENT_ID, bindingDocId(CATEGORIA, CANAL))
    assert.equal(intent.phase, 'attributes_cleaned')
    assert.equal(intent.lastError, 'ECONNRESET')
  })

  it('o retry depois da falha NÃO repete cleanBoundAttributes, e conclui o vínculo', async () => {
    let limpezas = 0
    let falhar = true

    const deps = {
      cleanBoundAttributes: async () => {
        limpezas++
      },
      putCategoryBinding: async (_token, params) => {
        if (falhar) throw new Error('ECONNRESET')
        return { ok: true, params }
      },
    }

    await assert.rejects(() => applyBinding(TEST_CLIENT_ID, baseParams, { userId: 'op-1', deps }))

    falhar = false
    const result = await applyBinding(TEST_CLIENT_ID, baseParams, { userId: 'op-1', deps })

    assert.equal(limpezas, 1, 'a limpeza já feita não deve ser repetida no retry')
    assert.equal(result.skippedClean, true)
    assert.equal(result.bound, true)
    // Transação completa: a intenção é apagada.
    assert.equal(getMockBindIntent(TEST_CLIENT_ID, bindingDocId(CATEGORIA, CANAL)), null)
  })

  it('trocar o destino depois da falha deve limpar de novo', async () => {
    let limpezas = 0
    let falhar = true
    const deps = {
      cleanBoundAttributes: async () => {
        limpezas++
      },
      putCategoryBinding: async () => {
        if (falhar) throw new Error('timeout')
      },
    }

    await assert.rejects(() => applyBinding(TEST_CLIENT_ID, baseParams, { deps }))
    falhar = false

    // Outro código de destino: a limpeza anterior era relativa ao destino antigo.
    await applyBinding(TEST_CLIENT_ID, { ...baseParams, codeInMarketPlace: 'MLB63513' }, { deps })

    assert.equal(limpezas, 2)
  })
})

describe('channelBindService — canSkipClean (janela do retry seguro)', () => {
  const agora = 1_000_000
  const intent = { phase: 'attributes_cleaned', marketplace: CANAL, codeInMarketPlace: 'MLB63512', cleanedAtMs: agora }

  it('deve reaproveitar a limpeza para o mesmo destino, dentro da janela', () => {
    assert.equal(canSkipClean(intent, { marketplace: CANAL, codeInMarketPlace: 'MLB63512' }, agora + 1000), true)
  })

  it('não deve reaproveitar quando muda canal, código, fase ou passa da janela', () => {
    assert.equal(canSkipClean(intent, { marketplace: 'SHOPEE', codeInMarketPlace: 'MLB63512' }, agora), false)
    assert.equal(canSkipClean(intent, { marketplace: CANAL, codeInMarketPlace: 'OUTRO' }, agora), false)
    assert.equal(canSkipClean({ ...intent, phase: 'cleaning' }, { marketplace: CANAL, codeInMarketPlace: 'MLB63512' }, agora), false)
    assert.equal(canSkipClean(intent, { marketplace: CANAL, codeInMarketPlace: 'MLB63512' }, agora + 11 * 60 * 1000), false)
    assert.equal(canSkipClean(null, { marketplace: CANAL, codeInMarketPlace: 'MLB63512' }, agora), false)
  })
})

describe('channelBindService — status do de-para (§1.1)', () => {
  beforeEach(() => resetMockChannelBindState())

  it('deve dizer canal por canal o que está vinculado e o que está pendente', async () => {
    const deps = {
      fetchCategoryBindings: async () => ({
        bindings: [
          { marketplace: 'MERCADO_LIVRE', codeInMarketPlace: 'MLB63512', completePath: 'A > B', removed: false },
          { marketplace: 'MAGAZINE_LUIZA', codeInMarketPlace: 'ML-PAN', removed: true },
        ],
      }),
    }

    const status = await getBindingStatus(TEST_CLIENT_ID, CATEGORIA, { deps })

    const ml = status.channels.find((c) => c.marketplace === 'MERCADO_LIVRE')
    const magalu = status.channels.find((c) => c.marketplace === 'MAGAZINE_LUIZA')

    assert.equal(ml.bound, true)
    // Vínculo desfeito é pendência, não "tudo certo".
    assert.equal(magalu.bound, false)
    assert.equal(magalu.removed, true)
    assert.equal(status.boundCount, 1)
    assert.equal(status.pendingCount, 1)
  })

  it('deve mostrar canal vinculado fora da lista configurada, marcando como inesperado', async () => {
    const deps = {
      fetchCategoryBindings: async () => ({
        bindings: [{ marketplace: 'SHOPEE', codeInMarketPlace: 'SH-1', removed: false }],
      }),
    }

    const status = await getBindingStatus(TEST_CLIENT_ID, CATEGORIA, { marketplaces: ['MERCADO_LIVRE'], deps })
    const shopee = status.channels.find((c) => c.marketplace === 'SHOPEE')

    assert.equal(shopee.bound, true)
    assert.equal(shopee.unexpected, true)
    // Canal inesperado não conta como pendência do cliente.
    assert.equal(status.pendingCount, 1)
  })
})

describe('channelBindService — classificação das transmissões (§1.2)', () => {
  it('deve separar de-para faltando de atributo faltando', () => {
    assert.equal(classifyTransmissionIssue('Categoria não vinculada para o marketplace'), 'missing_binding')
    assert.equal(classifyTransmissionIssue('A categoria do produto não está mapeada'), 'missing_binding')
    assert.equal(classifyTransmissionIssue('Atributo obrigatório Voltagem não informado'), 'missing_attribute')
    assert.equal(classifyTransmissionIssue('characteristic BRAND is required'), 'missing_attribute')
  })

  it('deve cair em genérico em vez de forçar uma gaveta', () => {
    assert.equal(classifyTransmissionIssue('Preço abaixo do mínimo'), 'other')
    assert.equal(classifyTransmissionIssue('Categoria inativa no canal'), 'category_related')
    assert.equal(classifyTransmissionIssue(null), 'unknown')
  })
})

describe('categoryAttributesService — obrigatoriedade POR CANAL (§2)', () => {
  const { byCategory } = normalizeCharacteristicGroups(getMockCharacteristicGroups())

  it('o mesmo atributo pode ser obrigatório num canal e opcional no outro', () => {
    const ml = attributesForMarketplace(byCategory['1012'], 'MERCADO_LIVRE')
    const magalu = attributesForMarketplace(byCategory['1012'], 'MAGAZINE_LUIZA')

    const voltagemML = ml.find((a) => a.name === 'Voltagem')
    const voltagemMagalu = magalu.find((a) => a.name === 'Voltagem')

    assert.equal(voltagemML.required, true)
    assert.equal(voltagemMagalu.required, false)
    // Nome do atributo no canal vem junto: é o que o marketplace cobra no erro.
    assert.equal(voltagemML.idInMarketplace, 'VOLTAGE')
  })

  it('deve mesclar atributos do hub com os do canal, sem duplicar', () => {
    const ml = attributesForMarketplace(byCategory['1012'], 'MERCADO_LIVRE')
    const nomes = ml.map((a) => a.name)

    // "Observações" não tem entrada por canal: vale para todos.
    assert.ok(nomes.includes('Observações'))
    assert.equal(nomes.filter((n) => n === 'Voltagem').length, 1)
    // Obrigatórios primeiro — é a ordem que a tela usa.
    assert.equal(ml[0].required, true)
    assert.equal(ml[ml.length - 1].required, false)
  })

  it('atributo sem detalhamento por canal cai no balde de todos os canais', () => {
    const { byCategory: semCanal } = normalizeCharacteristicGroups([
      { id: 1, categories: [{ id: 5 }], characteristics: [{ id: 2, name: 'EAN', required: true }] },
    ])

    assert.equal(semCanal['5'][ALL_CHANNELS].length, 1)
    assert.equal(semCanal['5'][ALL_CHANNELS][0].required, true)
    assert.equal(semCanal['5'][ALL_CHANNELS][0].valueType, 'TEXT')
  })

  it('grupo sem categoria NÃO é espalhado para todas — vira unlinked', () => {
    const { byCategory: vazio, unlinked } = normalizeCharacteristicGroups([
      { id: 7, name: 'Solto', characteristics: [{ id: 8, name: 'Cor' }] },
    ])

    assert.deepEqual(vazio, {})
    assert.equal(unlinked.length, 1)
    assert.equal(unlinked[0].count, 1)
  })

  it('extractGroupCategoryIds deve ler as três formas conhecidas de vínculo', () => {
    assert.deepEqual(extractGroupCategoryIds({ categories: [{ id: 1 }, { id: 2 }] }), ['1', '2'])
    assert.deepEqual(extractGroupCategoryIds({ category: { id: 3 } }), ['3'])
    assert.deepEqual(extractGroupCategoryIds({ categoryId: 4 }), ['4'])
    assert.deepEqual(extractGroupCategoryIds({}), [])
  })
})

describe('categoryAttributesService — obrigatórios faltando', () => {
  const atributos = [
    { name: 'Marca', required: true, valueType: 'TEXT', marketplace: 'MERCADO_LIVRE' },
    { name: 'Voltagem', required: true, valueType: 'LIST', marketplace: 'MERCADO_LIVRE' },
    { name: 'Observações', required: false, valueType: 'TEXT', marketplace: ALL_CHANNELS },
  ]

  it('deve casar por nome sem diferenciar caixa', () => {
    const faltando = missingRequiredAttributes(atributos, [{ name: 'marca', value: 'Tramontina' }])
    assert.deepEqual(faltando.map((a) => a.name), ['Voltagem'])
  })

  it('valor vazio, nulo ou só espaço conta como faltando', () => {
    const faltando = missingRequiredAttributes(atributos, [
      { name: 'Marca', value: '   ' },
      { name: 'Voltagem', value: null },
    ])
    assert.equal(faltando.length, 2)
  })

  it('opcional sem valor nunca entra na lista', () => {
    const faltando = missingRequiredAttributes(atributos, [
      { name: 'Marca', value: 'X' },
      { name: 'Voltagem', value: '110V' },
    ])
    assert.deepEqual(faltando, [])
  })
})

describe('categoryAttributesService — PATCH de valores no produto', () => {
  it('deve preservar o index do que já existe e enfileirar o novo depois do maior', () => {
    const existente = [
      { index: 0, name: 'Marca', value: 'Tramontina' },
      { index: 5, name: 'Material', value: 'Alumínio' },
    ]

    const patch = buildCharacteristicsPatch(existente, [
      { name: 'Marca', value: 'Brinox' },
      { name: 'Voltagem', value: '110V' },
    ])

    assert.deepEqual(patch, [
      { index: 0, name: 'Marca', value: 'Brinox' },
      { index: 5, name: 'Material', value: 'Alumínio' },
      { index: 6, name: 'Voltagem', value: '110V' },
    ])
  })

  it('deve levar o estado completo, não só o campo editado', () => {
    // PATCH de lista SUBSTITUI a lista: mandar só o editado apagaria os outros.
    const patch = buildCharacteristicsPatch([{ index: 0, name: 'Marca', value: 'X' }], [{ name: 'Voltagem', value: '220V' }])
    assert.equal(patch.length, 2)
    assert.ok(patch.some((c) => c.name === 'Marca' && c.value === 'X'))
  })

  it('deve descartar valor vazio em vez de gravar string vazia', () => {
    const patch = buildCharacteristicsPatch([{ index: 0, name: 'Marca', value: 'X' }], [{ name: 'Marca', value: '' }])
    assert.deepEqual(patch, [])
  })

  it('normalizeProductCharacteristics deve suprir index ausente e descartar item sem nome', () => {
    const lista = normalizeProductCharacteristics({
      characteristics: [{ name: 'Marca', value: 'X' }, { value: 'sem nome' }, { index: 9, name: 'Cor', value: 'Azul' }],
    })

    assert.deepEqual(lista, [
      { index: 0, name: 'Marca', value: 'X' },
      { index: 9, name: 'Cor', value: 'Azul' },
    ])
  })
})

describe('painel recusando o token — plano B (medido em conta real, 19/08/2026)', () => {
  beforeEach(() => resetMockChannelBindState())

  it('deve reconhecer a assinatura do painel recusando o gumgaToken', () => {
    // Com token: 500 genérico em QUALQUER caminho. Sem token: 401. As duas coisas
    // significam "não vai funcionar com este token", não "tente de novo".
    assert.equal(isPanelRejectingToken({ status: 500, data: { message: 'An unexpected error occurred' } }), true)
    assert.equal(isPanelRejectingToken({ status: 401, data: { message: 'Invalid authentication credentials' } }), true)
  })

  it('não deve confundir 500 de verdade com recusa de token', () => {
    assert.equal(isPanelRejectingToken({ status: 500, data: { message: 'Category not found in marketplace' } }), false)
    assert.equal(isPanelRejectingToken({ status: 502, data: null }), false)
    assert.equal(isPanelRejectingToken({ status: null }), false)
  })

  it('status deve degradar para o espelho local, avisando que não conferiu agora', async () => {
    // Primeiro grava um vínculo (vai para o espelho do cliente de teste)...
    await applyBinding(
      TEST_CLIENT_ID,
      { anymarketCategoryId: CATEGORIA, marketplace: CANAL, codeInMarketPlace: 'MLB63512', completePath: 'A/B', source: 'manual' },
      {}
    )

    // ...e agora o painel para de responder.
    const status = await getBindingStatus(TEST_CLIENT_ID, CATEGORIA, {
      deps: {
        fetchCategoryBindings: async () => {
          const err = new Error('painel fora')
          err.code = 'panel_token_unsupported'
          throw err
        },
      },
    })

    assert.equal(status.hubUnavailable, true)
    assert.equal(status.canBindHere, false)
    // `checkedAt` nulo é deliberado: ninguém conferiu no hub.
    assert.equal(status.checkedAt, null)
    assert.equal(status.channels.find((c) => c.marketplace === CANAL).bound, true)
    assert.ok(status.panelUrl)
  })

  it('erro que não é do painel deve continuar subindo, não virar estado degradado', async () => {
    await assert.rejects(
      () =>
        getBindingStatus(TEST_CLIENT_ID, CATEGORIA, {
          deps: {
            fetchCategoryBindings: async () => {
              throw new Error('token do cliente não cadastrado')
            },
          },
        }),
      /token do cliente/
    )
  })

  it('falha na limpeza NÃO deve deixar intenção pendurada — nada foi destruído', async () => {
    const deps = {
      cleanBoundAttributes: async () => {
        const err = new Error('painel fora')
        err.code = 'panel_token_unsupported'
        throw err
      },
    }

    await assert.rejects(
      () =>
        applyBinding(
          TEST_CLIENT_ID,
          { anymarketCategoryId: CATEGORIA, marketplace: CANAL, codeInMarketPlace: 'MLB63512', completePath: 'A/B', source: 'manual' },
          { deps }
        ),
      /painel fora/
    )

    assert.equal(getMockBindIntent(TEST_CLIENT_ID, bindingDocId(CATEGORIA, CANAL)), null)
    assert.equal(getMockChannelBinding(TEST_CLIENT_ID, CATEGORIA, CANAL), null)
  })
})

describe('catálogo de canais (/v2/marketplaces — confirmado em conta real)', () => {
  it('deve normalizar código e nome, descartando entrada sem código', () => {
    const catalogo = normalizeMarketplaceCatalog({
      marketplaces: [
        { code: 'MERCADO_LIVRE', name: 'Mercado Livre' },
        { code: 'shopee', name: 'Shopee' },
        { name: 'sem codigo' },
      ],
    })

    assert.deepEqual(catalogo, [
      { code: 'MERCADO_LIVRE', name: 'Mercado Livre' },
      { code: 'SHOPEE', name: 'Shopee' },
    ])
  })
})

describe('lock por categoria+canal — falha de infra não pode virar "ocupado"', () => {
  it('só ALREADY_EXISTS significa lock de outro processo', () => {
    assert.equal(isLockHeldError({ code: 6 }), true)
    assert.equal(isLockHeldError({ message: 'ALREADY_EXISTS: document already exists' }), true)
  })

  it('erro de credencial/cota/rede deve degradar, não bloquear', () => {
    // Regressão medida em execução real: sem credencial do Firestore, o vínculo
    // respondia "Outro processo já está vinculando" — falso e sem saída.
    assert.equal(isLockHeldError({ message: 'Unable to detect a Project Id in the current environment.' }), false)
    assert.equal(isLockHeldError({ code: 8, message: 'RESOURCE_EXHAUSTED' }), false)
    assert.equal(isLockHeldError({ message: 'ECONNRESET' }), false)
    assert.equal(isLockHeldError(undefined), false)
  })
})

describe('payloads REAIS do painel (capturados em 19/08/2026)', () => {
  // Corpo real de GET /rest/api/categories/3313411, reduzido aos campos que importam.
  const CATEGORIA_REAL = {
    id: 3313411,
    name: 'Categoria padrão',
    path: 'Categoria padrão',
    parentId: null,
    marketPlaces: [
      { marketPlace: 'AMAZON_GLOBAL_API', codeInMarketPlace: '116304', completePath: null, removed: null, accountIdentifier: null, properties: { bindIndex: '0' } },
      { marketPlace: 'NUVEMSHOP', codeInMarketPlace: '38321391', completePath: null, removed: null, accountIdentifier: '202', properties: null },
      { marketPlace: 'SHOPEE', codeInMarketPlace: '101446', completePath: null, removed: null, accountIdentifier: '1974', properties: null },
    ],
  }

  it('`removed: null` significa VINCULADO (a API não manda false)', () => {
    const bindings = normalizeBindings(CATEGORIA_REAL)
    assert.equal(bindings.length, 3)
    assert.ok(bindings.every((b) => b.removed === false))
    // Canal com múltiplas contas identifica a conta — precisa sobreviver à normalização.
    assert.equal(bindings.find((b) => b.marketplace === 'NUVEMSHOP').accountIdentifier, '202')
    assert.equal(bindings.find((b) => b.marketplace === 'AMAZON_GLOBAL_API').bindIndex, '0')
  })

  // Corpo real de GET /rest/api/marketplaces/MERCADO_LIVRE/categories/MLB1423.
  const NIVEL_REAL = {
    codeInMarketPlace: 'MLB1423',
    name: 'Mercearia',
    isReceivingItens: false,
    canBeSelected: true,
    completePath: 'Alimentos e Bebidas/Mercearia',
    path: [
      { codeInMarketPlace: 'MLB1403', name: 'Alimentos e Bebidas', completePath: 'Alimentos e Bebidas' },
      { codeInMarketPlace: 'MLB1423', name: 'Mercearia', completePath: 'Alimentos e Bebidas/Mercearia' },
    ],
    childs: [
      { codeInMarketPlace: 'MLB270073', name: 'Macarrões', completePath: null },
      { codeInMarketPlace: 'MLB263827', name: 'Biscoitos', completePath: null },
    ],
  }

  it('completePath do FILHO é derivado do breadcrumb — a API manda null', () => {
    // Sem isso, vincular um filho direto da lista mandaria completePath vazio no PUT.
    const nivel = normalizeMarketplaceLevel(NIVEL_REAL)
    assert.equal(nivel.childs[0].completePath, 'Alimentos e Bebidas/Mercearia/Macarrões')
    assert.equal(nivel.childs[1].completePath, 'Alimentos e Bebidas/Mercearia/Biscoitos')
    // E convertido para o separador do PUT dá o caminho completo, não um pedaço.
    assert.equal(toBindCompletePath(nivel.childs[0].completePath), 'Alimentos e Bebidas > Mercearia > Macarrões')
  })

  it('isReceivingItens do nível deve sobreviver — folha fechada é destino ruim', () => {
    assert.equal(normalizeMarketplaceLevel(NIVEL_REAL).isReceivingItens, false)
  })

  it('sugestões vêm embrulhadas em { suggestions: [...] }', () => {
    assert.deepEqual(normalizeSuggestions({ suggestions: [] }), [])
    const uma = normalizeSuggestions({ suggestions: [{ codeInMarketPlace: 'MLB1', percentage: 66.67 }] })
    assert.equal(uma.length, 1)
    assert.equal(uma[0].percentage, 66.67)
  })

  it('canais ATIVOS da conta vêm como array de strings', () => {
    assert.deepEqual(normalizeAccountMarketplaces(['MERCADO_LIVRE', 'shopee', 'MERCADO_LIVRE']), ['MERCADO_LIVRE', 'SHOPEE'])
    assert.deepEqual(normalizeAccountMarketplaces([{ code: 'MAGAZINE_LUIZA' }]), ['MAGAZINE_LUIZA'])
    assert.deepEqual(normalizeAccountMarketplaces(null), [])
  })

  it('paginação do painel usa `values`, não `content`', () => {
    assert.deepEqual(extractItems({ pageSize: 10, count: 1362, start: 0, values: [{ id: 1 }] }), [{ id: 1 }])
  })

  it('403 TOKEN_EXPIRED é o caso rotineiro e não se confunde com token errado', () => {
    const expirado = { status: 403, data: { response: 'TOKEN_EXPIRED', operation: 'geral' } }
    assert.equal(isPanelTokenExpired(expirado), true)
    assert.equal(isPanelRejectingToken(expirado), false)

    const tipoErrado = { status: 500, data: { message: 'An unexpected error occurred' } }
    assert.equal(isPanelTokenExpired(tipoErrado), false)
    assert.equal(isPanelRejectingToken(tipoErrado), true)
  })

  it('as quatro causas de "não dá para vincular aqui" degradam o status', () => {
    for (const code of ['panel_token_missing', 'panel_token_expired', 'panel_token_unsupported', 'internal_contract_changed']) {
      assert.equal(isPanelUnavailable({ code }), true, code)
    }
    assert.equal(isPanelUnavailable({ code: 'invalid_marketplace' }), false)
  })
})
