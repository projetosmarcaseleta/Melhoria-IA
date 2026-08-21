import axios from 'axios'
import { auth } from './firebaseClient'
import useStore from '../store/useStore'

// Exportado porque a geração em stream usa `fetch` direto (axios não entrega resposta
// parcial no navegador) e precisa montar a URL do mesmo jeito que o axios monta.
export const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Obtém o Firebase ID Token atualizado dinamicamente.
 * Se o Firebase Auth tiver um usuário ativo, chama getIdToken() (que renova automaticamente
 * caso esteja próximo de expirar).
 * Fallback para a sessão persistida no Zustand ou mock de desenvolvimento.
 */
export async function getFreshAuthToken() {
  try {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken()
      // Sincronizar com Zustand se necessário
      const currentToken = useStore.getState().auth.session?.access_token
      if (token && token !== currentToken) {
        const user = useStore.getState().auth.user
        useStore.getState().setAuth(user, { access_token: token })
      }
      return token
    }
  } catch (err) {
    console.warn('[ApiClient] Erro ao renovar token Firebase:', err.message)
  }

  // Fallback para sessão do Zustand (ex: mock sessions ou offline)
  const sessionToken = useStore.getState().auth.session?.access_token
  return sessionToken || null
}

/**
 * Instância do Axios pré-configurada com interceptor de autenticação dinâmica.
 */
export const apiClient = axios.create({
  baseURL: API_BASE,
})

apiClient.interceptors.request.use(
  async (config) => {
    const token = await getFreshAuthToken()
    if (token) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

export default apiClient
