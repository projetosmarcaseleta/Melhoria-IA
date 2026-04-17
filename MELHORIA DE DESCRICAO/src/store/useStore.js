import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'melhoria-config'

const useStore = create(
  persist(
    (set, get) => ({
      // ─── Configurações (persistidas no localStorage) ─────────────────────
      config: {
        n8nWebhookUrl: '',
        gumgaToken: '',
        openaiKeyHint: '',        // apenas exibição; a chave real fica no .env do backend
        anymarketMode: 'backend', // 'backend' | 'webhook'
        anymarketWebhookUrl: '',  // URL do webhook n8n que faz o PATCH na AnyMarket
        aiProvider: 'openai',     // 'openai' | 'gemini'
        geminiApiKey: '',         // chave da API do Google Gemini
      },

      setConfig: (updates) =>
        set((s) => ({ config: { ...s.config, ...updates } })),

      // ─── Produtos carregados do webhook ──────────────────────────────────
      // [{id, title, description, characteristics, status}]
      // status: 'idle' | 'processing' | 'processed' | 'applying' | 'applied' | 'error'
      products: [],

      setProducts: (products) => set({ products }),

      updateProductStatus: (id, status) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, status } : p
          ),
        })),

      updateProductResult: (id, newTitle, newDescription) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, newTitle, newDescription, status: 'processed' } : p
          ),
        })),

      // Atualiza apenas os dados gerados (sem alterar status) — usado para edições manuais
      updateProductNewData: (id, newTitle, newDescription) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, newTitle, newDescription } : p
          ),
        })),

      clearProducts: () => set({ products: [] }),

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
        activeTab: 'products',      // 'products' | 'logs'
        isProcessing: false,
        isFetchingWebhook: false,
        isApplying: false,
        progress: { current: 0, total: 0 },
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
        set((s) => ({ ui: { ...s.ui, progress: { current, total } } })),

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
          ui: { ...s.ui, selectedIds: s.products.map((p) => p.id) },
        })),

      clearSelection: () =>
        set((s) => ({ ui: { ...s.ui, selectedIds: [] } })),

      addToast: (type, message) => {
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
      partialize: (s) => ({ config: s.config, logs: s.logs }),
    }
  )
)

export default useStore
