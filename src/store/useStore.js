import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'melhoria-config'

const useStore = create(
  persist(
    (set, get) => ({
      // ─── Autenticação ──────────────────────────────────────────────
      auth: {
        user: null,       // { id, email, name, role }
        session: null,    // Firebase session object ({ access_token })
        isLoading: true,  // verificando sessão ao iniciar
      },

      setAuth: (user, session) =>
        set((s) => ({
          auth: { ...s.auth, user, session, isLoading: false },
        })),

      clearAuth: () =>
        set((s) => ({
          auth: { user: null, session: null, isLoading: false },
        })),

      setAuthLoading: (v) =>
        set((s) => ({
          auth: { ...s.auth, isLoading: v },
        })),

      // ─── Cliente Ativo ──────────────────────────────────────────────
      activeClient: null, // { id, name, slug, settings, anymarket_token, ... }
      clients: [],        // lista de todos os clientes disponíveis

      setActiveClient: (client) => set({ activeClient: client }),
      setClients: (clients) => set({ clients }),

      // ─── Configurações (persistidas no localStorage) ─────────────────────
      config: {
        gumgaToken: '',
        aiProvider: 'openai',     // 'openai' | 'gemini'
        geminiApiKey: '',         // chave da API do Google Gemini
        promptMode: 'default',    // 'default' | 'custom'
        applyTitles: true,        // processar títulos
        applyDescriptions: true,  // processar descrições
        soundNotification: true,  // tocar som ao terminar lote
        // Prompts personalizados ficam em cache local — só para quem alterou
        customPrompts: null,      // { descricao: string, titulo: string } | null
      },

      setConfig: (updates) =>
        set((s) => ({ config: { ...s.config, ...updates } })),

      // ─── Produtos carregados do webhook ──────────────────────────────────
      // [{id, title, description, characteristics, status}]
      // status: 'idle' | 'processing' | 'processed' | 'applying' | 'applied' | 'error'
      products: [],

      setProducts: (products) => set({ products }),

      updateProductStatus: (keyOrId, status) =>
        set((s) => ({
          products: s.products.map((p) =>
            (p._key === keyOrId || (!p._key && p.id === keyOrId)) ? { ...p, status } : p
          ),
        })),

      // `meta` carrega o retorno de validação do agente:
      // { titleValidation, descValidation, titleRulesApplied, descRulesApplied }
      updateProductResult: (keyOrId, newTitle, newDescription, titleGenerationId, descGenerationId, meta = {}) =>
        set((s) => ({
          products: s.products.map((p) =>
            (p._key === keyOrId || (!p._key && p.id === keyOrId))
              ? {
                  ...p,
                  newTitle,
                  newDescription,
                  titleGenerationId,
                  descGenerationId,
                  titleValidation: meta.titleValidation ?? null,
                  descValidation: meta.descValidation ?? null,
                  titleRulesApplied: meta.titleRulesApplied ?? [],
                  descRulesApplied: meta.descRulesApplied ?? [],
                  status: 'processed',
                }
              : p
          ),
        })),

      // Atualiza apenas os dados gerados (sem alterar status) — usado para edições manuais
      updateProductNewData: (keyOrId, newTitle, newDescription) =>
        set((s) => ({
          products: s.products.map((p) =>
            (p._key === keyOrId || (!p._key && p.id === keyOrId)) ? { ...p, newTitle, newDescription } : p
          ),
        })),

      clearProducts: () => set({ products: [] }),

      // Remove produtos específicos da lista pelo ID ou _key (ex: após aprovação)
      removeProducts: (keysOrIds) =>
        set((s) => ({
          products: s.products.filter((p) => !keysOrIds.includes(p._key || p.id) && !keysOrIds.includes(p.id)),
        })),

      // ─── Logs de alterações ───────────────────────────────────────────────
      // [{logId, productId, productTitle, timestamp, status, changes:[{field,before,after}]}]
      // status: 'applied' | 'undone' | 'error'
      logs: [],

      addLog: (log) =>
        set((s) => ({ logs: [log, ...s.logs] })),

      setLogStatus: (logId, status) =>
        set((s) => ({
          logs: s.logs.map((l) =>
            l.logId === logId ? { ...l, status } : l
          ),
        })),

      clearLogs: () => set({ logs: [] }),

      // ─── UI ───────────────────────────────────────────────────────────────
      ui: {
        activeTab: 'products',      // 'products' | 'review' | 'logs'
        isProcessing: false,
        isFetchingWebhook: false,
        isApplying: false,
        progress: { current: 0, total: 0, startTime: null },
        toasts: [],                 // [{id, type, message}]
        configOpen: false,
        selectedIds: [],            // IDs selecionados na tabela
      },

      setTab: (tab) =>
        set((s) => ({ ui: { ...s.ui, activeTab: tab } })),

      setProcessing: (v) =>
        set((s) => ({ ui: { ...s.ui, isProcessing: v } })),

      setFetchingWebhook: (v) =>
        set((s) => ({ ui: { ...s.ui, isFetchingWebhook: v } })),

      setApplying: (v) =>
        set((s) => ({ ui: { ...s.ui, isApplying: v } })),

      setProgress: (current, total) =>
        set((s) => ({
          ui: {
            ...s.ui,
            progress: {
              current,
              total,
              startTime: current === 0 ? Date.now() : (s.ui.progress.startTime ?? Date.now()),
            },
          },
        })),

      setConfigOpen: (v) =>
        set((s) => ({ ui: { ...s.ui, configOpen: v } })),

      toggleSelectId: (id) =>
        set((s) => {
          const sel = s.ui.selectedIds
          const next = sel.includes(id)
            ? sel.filter((x) => x !== id)
            : [...sel, id]
          return { ui: { ...s.ui, selectedIds: next } }
        }),

      selectAllIds: () =>
        set((s) => ({
          ui: { ...s.ui, selectedIds: s.products.map((p) => p._key || p.id) },
        })),

      // Define a seleção explicitamente. A aba de Revisão trabalha sobre um
      // subconjunto (só os produtos revisáveis), então não pode usar
      // `selectAllIds` — e antes ela mantinha um `useState` local, o que fazia
      // a barra flutuante (que lê `ui.selectedIds`) mostrar a seleção da OUTRA
      // aba enquanto os botões agiam sobre esta.
      setSelectedIds: (ids) =>
        set((s) => ({ ui: { ...s.ui, selectedIds: [...new Set(ids)] } })),

      clearSelection: () =>
        set((s) => ({ ui: { ...s.ui, selectedIds: [] } })),

      addToast: (type, message) => {
        const currentToasts = get().ui.toasts
        // Impedir mensagens de toast idênticas duplicadas
        if (currentToasts.some((t) => t.message === message)) {
          return
        }
        const id = Math.random().toString(36).slice(2)
        set((s) => ({
          ui: { ...s.ui, toasts: [...s.ui.toasts, { id, type, message }] },
        }))
        setTimeout(() => get().removeToast(id), 5000)
      },

      removeToast: (id) =>
        set((s) => ({
          ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) },
        })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        config: s.config,
        logs: s.logs,
        activeClient: s.activeClient ? { id: s.activeClient.id, name: s.activeClient.name, slug: s.activeClient.slug } : null,
      }),
    }
  )
)

export default useStore
