import { useState, useEffect } from 'react'
import axios from 'axios'
import useStore from '../store/useStore'

export default function ConfigModal() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setConfigOpen = useStore((s) => s.setConfigOpen)

  const [form, setForm] = useState({ ...config })
  const [showToken, setShowToken] = useState(false)

  // ── Prompts ──────────────────────────────────────────────────────────────
  const [promptsOpen, setPromptsOpen]     = useState(false)
  const [prompts, setPrompts]             = useState(null)   // { descricao, titulo }
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [promptsSaving, setPromptsSaving]   = useState(false)
  const [promptsError, setPromptsError]     = useState('')

  useEffect(() => {
    if (promptsOpen && !prompts && !promptsLoading) {
      setPromptsLoading(true)
      setPromptsError('')
      axios.get('/edit/api/prompts')
        .then(({ data }) => setPrompts(data))
        .catch(() => setPromptsError('Não foi possível carregar os prompts. Verifique se o servidor está rodando.'))
        .finally(() => setPromptsLoading(false))
    }
  }, [promptsOpen])

  const save = async () => {
    setConfig(form)

    if (promptsOpen && prompts) {
      setPromptsSaving(true)
      try {
        await axios.put('/edit/api/prompts', prompts)
      } catch {
        setPromptsError('Erro ao salvar prompts no servidor.')
        setPromptsSaving(false)
        return
      }
      setPromptsSaving(false)
    }

    setConfigOpen(false)
  }

  const field = (label, key, placeholder, type = 'text', hint) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={key === 'gumgaToken' && !showToken ? 'password' : type}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
        />
        {key === 'gumgaToken' && (
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
          >
            {showToken ? '🙈' : '👁️'}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-base font-semibold text-gray-800">⚙️ Configurações</h2>
          <button
            onClick={() => setConfigOpen(false)}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">

          {/* ── Consulta PostgreSQL ─────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Consulta de Produtos</p>
            {field(
              'URL do Webhook n8n (Consulta PostgreSQL)',
              'n8nWebhookUrl',
              'https://seu-n8n.com/webhook/consultar-produtos',
              'text',
              'O webhook receberá { ids: ["123","456",...] } e deve retornar array de produtos.'
            )}
          </div>

          {/* ── Aplicação AnyMarket ─────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Aplicação na AnyMarket</p>

            {field(
              'Token AnyMarket (gumgaToken)',
              'gumgaToken',
              'Cole seu token aqui',
              'text',
              'Necessário em ambos os modos para autenticar na AnyMarket.'
            )}

            {/* Toggle de modo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Modo de aplicação</label>
              <div className="flex gap-3">
                {[
                  { value: 'backend', label: '🖥️ Via servidor local', desc: 'O backend Express faz o PATCH direto.' },
                  { value: 'webhook', label: '🔗 Via webhook n8n', desc: 'O n8n recebe os dados e faz o PATCH.' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, anymarketMode: opt.value })}
                    className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                      form.anymarketMode === opt.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="block text-sm font-medium text-gray-800">{opt.label}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {form.anymarketMode === 'webhook' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL do Webhook n8n (Aplicação AnyMarket)
                </label>
                <input
                  type="text"
                  value={form.anymarketWebhookUrl}
                  onChange={(e) => setForm({ ...form, anymarketWebhookUrl: e.target.value })}
                  placeholder="https://seu-n8n.com/webhook/aplicar-anymarket"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Receberá <code className="bg-gray-100 px-1 rounded">{'{ productId, title, description, gumgaToken }'}</code> e fará o PATCH na AnyMarket.
                </p>
              </div>
            )}
          </div>

          {/* ── Provedor de IA ──────────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Provedor de IA</p>

            <div className="flex gap-3">
              {[
                { value: 'openai', label: '🤖 OpenAI (ChatGPT)', desc: `Modelo atual: gpt-5` },
                { value: 'gemini', label: '✨ Google Gemini',    desc: 'Modelo: gemini-2.0-flash' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, aiProvider: opt.value })}
                  className={`flex-1 text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                    form.aiProvider === opt.value
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-800">{opt.label}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{opt.desc}</span>
                </button>
              ))}
            </div>

            {form.aiProvider === 'openai' ? (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-700">
                <strong>Chave OpenAI:</strong> configure a variável <code>OPENAI_API_KEY</code> no
                arquivo <code>.env</code> na raiz do projeto e reinicie o servidor backend.
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chave API do Google Gemini
                </label>
                <input
                  type="password"
                  value={form.geminiApiKey ?? ''}
                  onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
                  placeholder="AIza..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Obtenha sua chave em{' '}
                  <span className="text-indigo-600 font-medium">aistudio.google.com</span>.
                  A chave é armazenada localmente no seu navegador.
                </p>
              </div>
            )}
          </div>

          {/* ── Prompts da IA ────────────────────────────────────────────── */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPromptsOpen(!promptsOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>✏️ Prompts da IA</span>
              <span className="text-gray-400 text-xs">{promptsOpen ? '▲ ocultar' : '▼ expandir'}</span>
            </button>

            {promptsOpen && (
              <div className="border-t border-gray-200 px-4 py-4 space-y-4 bg-gray-50">
                <p className="text-xs text-gray-500">
                  Use os marcadores{' '}
                  <code className="bg-gray-200 px-1 rounded">{'{{'} title {'}}'}</code>,{' '}
                  <code className="bg-gray-200 px-1 rounded">{'{{'} description {'}}'}</code> e{' '}
                  <code className="bg-gray-200 px-1 rounded">{'{{'} characteristics {'}}'}</code>{' '}
                  para inserir os dados do produto no prompt. As alterações são salvas no servidor ao clicar em <strong>Salvar</strong>.
                </p>

                {promptsError && (
                  <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700">
                    {promptsError}
                  </div>
                )}

                {promptsLoading ? (
                  <div className="text-sm text-gray-400 py-4 text-center">Carregando prompts...</div>
                ) : prompts ? (
                  <>
                    {/* Prompt Descrição */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Prompt — Descrição
                      </label>
                      <textarea
                        value={prompts.descricao}
                        onChange={(e) => setPrompts({ ...prompts, descricao: e.target.value })}
                        rows={12}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                    </div>

                    {/* Prompt Título */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Prompt — Título
                      </label>
                      <textarea
                        value={prompts.titulo}
                        onChange={(e) => setPrompts({ ...prompts, titulo: e.target.value })}
                        rows={10}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2 shrink-0">
          <button
            onClick={() => setConfigOpen(false)}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={promptsSaving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
          >
            {promptsSaving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
