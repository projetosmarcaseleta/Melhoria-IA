import { useState, useEffect } from 'react'
import axios from 'axios'
import useStore from '../store/useStore'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Fallbacks de segurança para garantir que o prompt default NUNCA venha vazio
const FALLBACK_DEFAULT_PROMPTS = {
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

function getAuthHeaders() {
  const session = useStore.getState().auth.session
  if (!session?.access_token) {
    throw new Error('Usuário não autenticado.')
  }
  return { Authorization: `Bearer ${session.access_token}` }
}

export default function ConfigModal() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const activeClient = useStore((s) => s.activeClient)
  const setActiveClient = useStore((s) => s.setActiveClient)
  const auth = useStore((s) => s.auth)
  const addToast = useStore((s) => s.addToast)

  const [form, setForm] = useState({
    ...config,
    anymarketToken: activeClient?.anymarket_token ?? config.gumgaToken ?? '',
    promptMode: config.promptMode || 'default',
  })

  // ── Prompts ──────────────────────────────────────────────────────────────
  const [customPrompts, setCustomPrompts] = useState({ titulo: '', descricao: '' })
  const [defaultPrompts, setDefaultPrompts] = useState(FALLBACK_DEFAULT_PROMPTS)
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [promptsError, setPromptsError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [promptTab, setPromptTab] = useState('descricao') // 'descricao' | 'titulo'

  // Carrega prompts do cliente ativo via backend Express/Firestore
  useEffect(() => {
    if (activeClient?.id) {
      setPromptsLoading(true)
      setPromptsError('')

      axios
        .get(`${API_BASE}/api/prompts/${activeClient.id}`, {
          headers: getAuthHeaders(),
        })
        .then(({ data }) => {
          const loadedDefaults = data?.defaultPrompts || FALLBACK_DEFAULT_PROMPTS
          setDefaultPrompts({
            titulo: loadedDefaults.titulo || FALLBACK_DEFAULT_PROMPTS.titulo,
            descricao: loadedDefaults.descricao || FALLBACK_DEFAULT_PROMPTS.descricao,
          })

          setCustomPrompts({
            titulo: data?.titulo?.content || loadedDefaults.titulo || FALLBACK_DEFAULT_PROMPTS.titulo,
            descricao: data?.descricao?.content || loadedDefaults.descricao || FALLBACK_DEFAULT_PROMPTS.descricao,
          })
        })
        .catch((err) => {
          console.error('[ConfigModal] Erro ao carregar prompts do servidor, usando fallbacks:', err)
          setDefaultPrompts(FALLBACK_DEFAULT_PROMPTS)
          setCustomPrompts(FALLBACK_DEFAULT_PROMPTS)
        })
        .finally(() => setPromptsLoading(false))
    }
  }, [activeClient?.id])

  const updateCustomPrompt = (field, value) => {
    setCustomPrompts((prev) => ({ ...prev, [field]: value }))
  }

  const handleCopyDefaultToCustom = () => {
    const activeText = promptTab === 'descricao' ? defaultPrompts.descricao : defaultPrompts.titulo
    setCustomPrompts((prev) => ({
      ...prev,
      [promptTab]: activeText,
    }))
    setForm({ ...form, promptMode: 'custom' })
    addToast('success', `Prompt de ${promptTab === 'descricao' ? 'Descrição' : 'Título'} copiado para Customizado!`)
  }

  const isTestMode =
    activeClient?.id === 'teste-marca-seleta' ||
    activeClient?.slug === 'teste-marca-seleta' ||
    Boolean(activeClient?.isMock)

  const canEditPrompt = auth.user?.role === 'admin' || isTestMode

  const save = async () => {
    try {
      setIsSaving(true)

      // 1. Atualizar config local
      setConfig({
        ...form,
        gumgaToken: form.anymarketToken,
      })

      // 2. Atualizar token do cliente ativo se mudou
      if (activeClient?.id && form.anymarketToken !== activeClient.anymarket_token) {
        if (canEditPrompt) {
          try {
            await axios.patch(
              `${API_BASE}/api/clients/${activeClient.id}`,
              { anymarket_token: form.anymarketToken },
              { headers: getAuthHeaders() }
            )
          } catch (patchErr) {
            console.warn('[ConfigModal] Aviso ao atualizar token do cliente:', patchErr.message)
          }
          setActiveClient({
            ...activeClient,
            anymarket_token: form.anymarketToken,
          })
        }
      }

      // 3. Salvar prompts no backend se em modo customizado e tiver permissão
      if (activeClient?.id && form.promptMode === 'custom' && canEditPrompt) {
        await axios.put(
          `${API_BASE}/api/prompts/${activeClient.id}`,
          {
            titulo: customPrompts.titulo,
            descricao: customPrompts.descricao,
          },
          { headers: getAuthHeaders() }
        )
      }

      addToast('success', 'Pronto! Suas configurações e prompts foram salvos.')
      setConfigOpen(false)
    } catch (err) {
      console.error('[ConfigModal] Erro ao salvar:', err)
      addToast('error', err.response?.data?.error || 'Erro ao salvar configurações.')
    } finally {
      setIsSaving(false)
    }
  }

  const currentDisplayPrompt =
    form.promptMode === 'default'
      ? (promptTab === 'descricao' ? (defaultPrompts.descricao || FALLBACK_DEFAULT_PROMPTS.descricao) : (defaultPrompts.titulo || FALLBACK_DEFAULT_PROMPTS.titulo))
      : (promptTab === 'descricao' ? customPrompts.descricao : customPrompts.titulo)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-overlayFade">
      <div className="animate-slideUp w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Configurações do Sistema
              </h2>
              {activeClient && (
                <p className="text-xs text-indigo-300 font-medium">
                  Cliente Ativo: {activeClient.name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setConfigOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="px-6 py-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Seção 1: Token AnyMarket */}
          <div className="space-y-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="text-lg">🔑</span>
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Token AnyMarket (gumgaToken)
                </h3>
                <p className="text-xs text-slate-300">
                  Chave de autenticação exclusiva para sincronização com o marketplace.
                </p>
              </div>
            </div>
            <input
              type="password"
              value={form.anymarketToken}
              onChange={(e) => setForm({ ...form, anymarketToken: e.target.value })}
              placeholder="Cole o gumgaToken do cliente..."
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700/70 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono"
            />
          </div>

          {/* Seção 2: Controles de Processamento */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>📝</span> Controle de Campos para Processar com IA
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Processar Títulos */}
              <button
                type="button"
                onClick={() => setForm({ ...form, applyTitles: !form.applyTitles })}
                className={`p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                  form.applyTitles
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md shadow-indigo-600/10'
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🏷️</span>
                    <span className="text-xs font-bold text-white">Todos os Títulos</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    {form.applyTitles ? 'Otimizará títulos com a IA' : 'Manterá títulos originais'}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase ${
                  form.applyTitles ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}>
                  {form.applyTitles ? 'ATIVO ✅' : 'OFF ❌'}
                </span>
              </button>

              {/* Processar Descrições */}
              <button
                type="button"
                onClick={() => setForm({ ...form, applyDescriptions: !form.applyDescriptions })}
                className={`p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                  form.applyDescriptions
                    ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-md shadow-emerald-600/10'
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📄</span>
                    <span className="text-xs font-bold text-white">Todas as Descrições</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    {form.applyDescriptions ? 'Gerará descrições via IA' : 'Manterá descrições originais'}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase ${
                  form.applyDescriptions ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}>
                  {form.applyDescriptions ? 'ATIVO ✅' : 'OFF ❌'}
                </span>
              </button>
            </div>
          </div>

          {/* Seção 3: Visualizador & Editor de Prompts */}
          <div className="space-y-4 pt-2 border-t border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">✏️</span>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Prompts da IA (Instruções do Sistema)
                  </h3>
                  <p className="text-xs text-slate-300">
                    Selecione o modo de instrução enviado para a IA durante o processamento.
                  </p>
                </div>
              </div>

              {/* Primary Mode Selector Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, promptMode: 'default' })}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    form.promptMode === 'default'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border border-indigo-400'
                      : 'bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <span>📋</span>
                  <span>Prompt Default</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, promptMode: 'custom' })}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    form.promptMode === 'custom'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border border-indigo-400'
                      : 'bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <span>✨</span>
                  <span>Customizado (Cliente)</span>
                </button>
              </div>
            </div>

            {/* Prompt Card Container */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
              
              {/* Internal Bar: Mode status + Sub-tabs */}
              <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${
                    form.promptMode === 'default'
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                  }`}>
                    {form.promptMode === 'default' ? 'MODO PADRÃO GLOBAL' : 'MODO CUSTOMIZADO DO CLIENTE'}
                  </span>

                  {/* Sub-tabs: Descrição vs Título */}
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl ml-2">
                    <button
                      type="button"
                      onClick={() => setPromptTab('descricao')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                        promptTab === 'descricao'
                          ? 'bg-indigo-600 text-white border border-indigo-400 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>📄 Descrição</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptTab('titulo')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                        promptTab === 'titulo'
                          ? 'bg-indigo-600 text-white border border-indigo-400 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>🏷️ Título</span>
                    </button>
                  </div>
                </div>

                {form.promptMode === 'default' && (
                  <button
                    type="button"
                    onClick={handleCopyDefaultToCustom}
                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 transition-all flex items-center gap-1.5 shadow-sm"
                    title="Copiar este prompt padrão para a aba de Customizados e permitir edição"
                  >
                    <span>📋 Copiar para Customizado</span>
                  </button>
                )}
              </div>

              {promptsLoading ? (
                <div className="py-8 text-center text-xs text-slate-300 space-y-2">
                  <span className="login-spinner mx-auto" />
                  <p>Carregando diretrizes do prompt...</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span className="font-semibold text-slate-200">
                      {form.promptMode === 'default'
                        ? `Prompt Padrão de ${promptTab === 'descricao' ? 'Descrição' : 'Título'} (Visualização Somente Leitura):`
                        : `Editor do Prompt Customizado de ${promptTab === 'descricao' ? 'Descrição' : 'Título'}:`}
                    </span>
                    <span className="text-slate-400 font-mono text-[10px]">
                      Variáveis aceitas: <code>{'{{title}}'}</code>, <code>{'{{description}}'}</code>
                    </span>
                  </div>

                  <textarea
                    rows={11}
                    readOnly={form.promptMode === 'default' || !canEditPrompt}
                    value={currentDisplayPrompt}
                    onChange={(e) => {
                      if (form.promptMode === 'custom') {
                        updateCustomPrompt(promptTab, e.target.value)
                      }
                    }}
                    className={`w-full p-4 rounded-xl font-mono text-xs leading-relaxed focus:outline-none transition-all ${
                      form.promptMode === 'default'
                        ? 'bg-slate-900/90 text-slate-200 border border-slate-700/80'
                        : 'bg-slate-900 text-white border border-indigo-500 focus:ring-2 focus:ring-indigo-500/30'
                    }`}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            {isTestMode ? (
              <span className="text-amber-400 font-semibold flex items-center gap-1">
                <span>🧪 Modo Teste:</span> Edição e salvamento de prompts liberados para todos os operadores.
              </span>
            ) : (
              !canEditPrompt && 'Modo leitura (Apenas admins salvam edições)'
            )}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfigOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all"
              disabled={isSaving}
            >
              {isSaving ? 'Salvando...' : '💾 Salvar Configurações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
