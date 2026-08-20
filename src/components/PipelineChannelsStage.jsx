import { useEffect, useState } from 'react'
import useStore from '../store/useStore'
import { fetchCurrentCategory } from '../services/categoryService'
import { fetchClientMarketplaces } from '../services/channelBindingService'
import { parallelProcess } from '../utils/batchUtils'
import { AutoBindStep } from './ChannelBindingPanel'

/**
 * Etapa "Canais" do wizard em lote (docs/PLANO_WIZARD_PIPELINE.md §2.3).
 *
 * Resolve a categoria ATUAL de cada produto selecionado (a mesma que o de-para usa —
 * não depende da etapa de Categoria ter rodado neste lote), agrupa por categoria
 * distinta (produtos na mesma categoria compartilham o mesmo de-para) e reaproveita o
 * `AutoBindStep` já validado em `ChannelBindingPanel.jsx` uma vez por grupo — em vez de
 * duplicar a lógica de proposta/confirmação.
 *
 * O ajuste manual de um canal específico (árvore do canal) continua só no modal por
 * produto (🗂️ na aba Revisão): duplicar essa navegação aqui não valia o esforço para
 * este primeiro corte do wizard.
 */
export default function PipelineChannelsStage({ clientId, products }) {
  const addToast = useStore((s) => s.addToast)

  const [grupos, setGrupos] = useState(null)
  const [semCategoria, setSemCategoria] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [canaisCliente, setCanaisCliente] = useState([])

  useEffect(() => {
    let cancelado = false

    async function montar() {
      setCarregando(true)
      try {
        const catalogo = await fetchClientMarketplaces(clientId).catch(() => ({ marketplaces: [] }))
        if (cancelado) return
        setCanaisCliente(catalogo.marketplaces ?? [])

        const resolvidos = await parallelProcess(products, 5, async (p) => {
          try {
            const atual = await fetchCurrentCategory(clientId, p.id)
            return { productId: p.id, category: atual ?? null }
          } catch {
            return { productId: p.id, category: null }
          }
        })

        if (cancelado) return

        const mapa = new Map()
        const semCat = []

        for (const r of resolvidos) {
          const categoria = r?.category
          if (!categoria?.id) {
            semCat.push(r?.productId)
            continue
          }
          const key = String(categoria.id)
          if (!mapa.has(key)) {
            mapa.set(key, {
              categoryId: key,
              path: categoria.fullPath ?? categoria.name ?? key,
              productIds: [],
            })
          }
          mapa.get(key).productIds.push(r.productId)
        }

        setGrupos([...mapa.values()])
        setSemCategoria(semCat.filter(Boolean))
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    montar()
    return () => {
      cancelado = true
    }
  }, [clientId, products])

  if (carregando) {
    return <p className="text-xs text-slate-400 py-10 text-center">Consultando a categoria atual de cada produto…</p>
  }

  if (!grupos?.length) {
    return (
      <div className="rounded-lg px-4 py-6 text-xs text-center" style={{ background: 'rgba(255,255,255,0.03)', color: '#9a9ab0' }}>
        Nenhum dos produtos selecionados tem categoria resolvível no AnyMarket ainda. Rode a etapa Categoria primeiro,
        ou ajuste manualmente pelo botão 🗂️ de cada produto na aba Revisão.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {semCategoria.length > 0 && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}
        >
          {semCategoria.length} produto(s) sem categoria resolvível — ficaram fora desta etapa.
        </div>
      )}

      {grupos.map((g) => (
        <div
          key={g.categoryId}
          className="rounded-xl p-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle, #2a2a35)' }}
        >
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
            {g.path} <span className="text-slate-600">· {g.productIds.length} produto(s)</span>
          </p>
          <AutoBindStep
            clientId={clientId}
            anymarketCategoryId={g.categoryId}
            canais={canaisCliente}
            onDone={() => addToast('success', `Canais resolvidos para "${g.path}".`)}
            onAjustar={() => addToast('info', 'Ajuste manual: abra o produto pelo botão 🗂️ na aba Revisão.')}
          />
        </div>
      ))}
    </div>
  )
}
