import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useStore from '../store/useStore'
import { suggestCategory, approveCategory, attachCategory, rejectCategory, syncCategoryTree } from '../services/categoryService'
import ChannelBindingPanel from './ChannelBindingPanel'

/**
 * Modal de categoria por produto — o caminho principal da feature.
 *
 * Fluxo: analisa → mostra "de → para" nível a nível → o operador confirma →
 * cria só a cauda faltante e SUBSTITUI a categoria do produto.
 *
 * A confirmação aqui É a aprovação humana exigida antes de qualquer escrita: o
 * operador vê, nível por nível, exatamente o que vai ser criado. Departamento novo
 * (nível 0) exige um segundo passo de confirmação.
 */
export default function CategoryModal({ product, onClose, onApplied }) {
  const activeClient = useStore((s) => s.activeClient)
  const addToast = useStore((s) => s.addToast)
  const addLog = useStore((s) => s.addLog)

  const [phase, setPhase] = useState('loading') // loading | review | working | done | error
  const [proposal, setProposal] = useState(null)
  const [error, setError] = useState(null)
  const [errorCode, setErrorCode] = useState(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const [confirmNewRoot, setConfirmNewRoot] = useState(false)
  const [result, setResult] = useState(null)
  const [channelTargetCategory, setChannelTargetCategory] = useState(null)

  // Trava scroll do body enquanto o modal estiver aberto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function analisar() {
      try {
        setPhase('loading')
        const data = await suggestCategory(activeClient.id, {
          id: product.id,
          title: product.newTitle || product.title,
          description: product.newDescription || product.description,
          characteristics: product.characteristics,
        })
        if (!cancelled) {
          setProposal(data)
          setPhase('review')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error ?? err.message)
          setErrorCode(err.response?.data?.code ?? null)
          setPhase('error')
        }
      }
    }

    analisar()
    return () => {
      cancelled = true
    }
  }, [activeClient?.id, product.id, tentativa])

  /**
   * Sincroniza a árvore sob demanda.
   *
   * Numa conta com milhares de categorias isso são dezenas de páginas na API do
   * AnyMarket, com ritmo lento de propósito para não estourar a cota (a API responde
   * 429 pedindo ~1 minuto de pausa). É operação deliberada, nunca automática — e
   * retomável: se cair no meio, chamar de novo continua de onde parou.
   */
  const handleSync = async () => {
    setSincronizando(true)
    try {
      const r = await syncCategoryTree(activeClient.id)
      addToast('success', `Árvore sincronizada: ${r.nodeCount} categorias.`)
      setTentativa((n) => n + 1)
    } catch (err) {
      const data = err.response?.data
      if (data?.resumable) {
        addToast(
          'warning',
          `Sincronização interrompida com ${data.partialCount} categorias lidas. Clique de novo para continuar de onde parou.`
        )
      } else {
        addToast('error', data?.error ?? err.message)
      }
    } finally {
      setSincronizando(false)
    }
  }

  const handleConfirm = async () => {
    setPhase('working')
    try {
      let leafId = proposal.leafCategoryId

      // Cria a cauda faltante só se houver o que criar.
      if (!proposal.fullyExisting) {
        const created = await approveCategory(activeClient.id, proposal.id, { confirmNewRoot })
        leafId = created.leafCategoryId
      }

      const attachment = await attachCategory(activeClient.id, {
        productId: product.id,
        categoryId: leafId,
        proposalId: proposal.id,
      })

      setResult({ leafId, attachment })
      setPhase('done')

      if (attachment.skipped) {
        addToast('info', `Produto ${product.id} já estava nessa categoria — nada foi alterado.`)
      } else {
        addToast('success', `Categoria aplicada: ${proposal.proposedPath.join(' › ')}`)

        // Entra no painel de Logs com desfazer de 1 clique, no mesmo formato dos
        // demais registros (campo CATEGORIA + attachmentId para reverter).
        addLog({
          logId: attachment.id ?? `cat-${Date.now()}`,
          productId: product.id,
          productTitle: product.newTitle ?? product.title,
          timestamp: new Date().toISOString(),
          status: 'applied',
          categoryAttachmentId: attachment.id,
          changes: [
            {
              field: 'CATEGORIA',
              before: attachment.previousCategory?.fullPath ?? '(sem categoria)',
              after: attachment.newCategory?.fullPath ?? proposal.proposedPath.join(' > '),
            },
          ],
          originalData: {
            categoryId: attachment.previousCategory?.id ?? null,
            categoryPath: attachment.previousCategory?.fullPath ?? null,
          },
        })
      }

      onApplied?.({ productId: product.id, categoryId: leafId, attachment, proposal })
    } catch (err) {
      const data = err.response?.data
      if (data?.code === 'new_root_confirmation_required') {
        setConfirmNewRoot(true)
        setPhase('review')
        addToast('warning', 'Este caminho cria um DEPARTAMENTO novo. Confirme novamente para prosseguir.')
        return
      }
      setError(data?.error ?? err.message)
      setPhase('error')
    }
  }

  /**
   * "Usar esta" num candidato parecido de outro galho.
   *
   * Caminho de reuso puro: não passa por `approve`, porque não há nada a criar —
   * só move o produto para uma categoria que já existe. É o botão que faltava: antes
   * a lista de parecidos era um aviso sem ação, e o operador tinha que cancelar,
   * adivinhar e resolver na mão no AnyMarket.
   */
  const handleUseExisting = async (categoria) => {
    setPhase('working')
    try {
      const attachment = await attachCategory(activeClient.id, {
        productId: product.id,
        categoryId: categoria.anymarketId,
        proposalId: proposal?.id,
      })

      setResult({ leafId: categoria.anymarketId, attachment, usedExisting: categoria })
      setPhase('done')

      if (attachment.skipped) {
        addToast('info', `Produto ${product.id} já estava nessa categoria.`)
      } else {
        addToast('success', `Produto movido para ${categoria.fullPath}`)
        addLog({
          logId: attachment.id ?? `cat-${Date.now()}`,
          productId: product.id,
          productTitle: product.newTitle ?? product.title,
          timestamp: new Date().toISOString(),
          status: 'applied',
          categoryAttachmentId: attachment.id,
          changes: [
            {
              field: 'CATEGORIA',
              before: attachment.previousCategory?.fullPath ?? '(sem categoria)',
              after: attachment.newCategory?.fullPath ?? categoria.fullPath,
            },
          ],
          originalData: {
            categoryId: attachment.previousCategory?.id ?? null,
            categoryPath: attachment.previousCategory?.fullPath ?? null,
          },
        })
      }

      onApplied?.({ productId: product.id, categoryId: categoria.anymarketId, attachment, proposal })
    } catch (err) {
      setError(err.response?.data?.error ?? err.message)
      setErrorCode(err.response?.data?.code ?? null)
      setPhase('error')
    }
  }

  const handleReject = async () => {
    try {
      if (proposal?.id) await rejectCategory(activeClient.id, proposal.id, 'recusada no modal')
      addToast('info', 'Sugestão recusada — o CRIA aprende com isso.')
    } catch {
      /* rejeitar é registro de aprendizado; falhar aqui não bloqueia o operador */
    }
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-card, #14141c)', border: '1px solid var(--border-subtle, #2a2a35)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle, #2a2a35)' }}
        >
          <div>
            <h3 className="font-bold text-white flex items-center gap-2">🗂️ Categoria do produto</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted, #9a9ab0)' }}>
              ID {product.id} · {(product.newTitle ?? product.title ?? '').slice(0, 70)}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg px-2">
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {phase === 'loading' && (
            <div className="py-10 text-center">
              <div className="text-3xl mb-3">🔎</div>
              <p className="text-sm text-slate-300">Analisando título e descrição e comparando com a árvore do cliente…</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-6">
              <p className="text-sm font-bold text-rose-400 mb-2">
                {errorCode === 'tree_not_synced' ? 'Árvore de categorias não sincronizada' : 'Não foi possível concluir'}
              </p>
              <p className="text-xs text-slate-300 break-words">{error}</p>

              {(errorCode === 'tree_not_synced' || errorCode === 'sync_interrupted') && (
                <div className="mt-4">
                  <button
                    onClick={handleSync}
                    disabled={sincronizando}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60"
                    style={{ background: '#4f46e5' }}
                  >
                    {sincronizando ? 'Sincronizando… (pode levar ~1 min)' : '⟳ Sincronizar árvore agora'}
                  </button>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Uma vez só por cliente: a árvore fica espelhada e as próximas análises leem do espelho. Contas com
                    milhares de categorias levam cerca de um minuto — o ritmo é lento de propósito para não estourar a
                    cota da API do AnyMarket. Se cair no meio, clicar de novo continua de onde parou.
                  </p>
                </div>
              )}
            </div>
          )}

          {(phase === 'review' || phase === 'working') && proposal && (
            <ProposalReview
              proposal={proposal}
              confirmNewRoot={confirmNewRoot}
              working={phase === 'working'}
              onUseExisting={handleUseExisting}
              onInspectChannels={(cat) => {
                setChannelTargetCategory(cat)
                setPhase('channels')
              }}
            />
          )}

          {phase === 'done' && (
            <div className="py-8 text-center">
              <div className="text-3xl mb-3">✅</div>
              <p className="text-sm text-emerald-400 font-bold mb-1">
                {result?.attachment?.skipped ? 'Nada a alterar' : 'Categoria aplicada'}
              </p>
              <p className="text-xs text-slate-300">{proposal?.proposedPath?.join(' › ')}</p>
              {result?.attachment?.previousCategory?.fullPath && !result?.attachment?.skipped && (
                <p className="text-[11px] text-slate-500 mt-2">
                  Anterior: {result.attachment.previousCategory.fullPath} · desfazer disponível na aba Logs
                </p>
              )}

              {/* Categoria trocada NÃO significa produto publicável: sem de-para de
                  canal, o marketplace recusa. Este é o momento certo de mostrar isso —
                  categoria recém-criada nasce sem vínculo nenhum. */}
              {result?.leafId && (
                <div className="mt-5 text-left">
                  <ChannelBindingPanel
                    clientId={activeClient.id}
                    anymarketCategoryId={String(result.leafId)}
                    categoryPath={proposal?.proposedPath?.join(' › ')}
                    productId={product.id}
                  />
                </div>
              )}
            </div>
          )}

          {phase === 'channels' && (
            <ChannelBindingPanel
              clientId={activeClient.id}
              anymarketCategoryId={String(channelTargetCategory?.id ?? proposal?.leafCategoryId ?? proposal?.currentCategory?.id)}
              categoryPath={channelTargetCategory?.path ?? proposal?.currentCategory?.fullPath ?? proposal?.proposedPath?.join(' › ')}
              productId={product.id}
            />
          )}
        </div>

        {phase === 'review' && proposal && (
          <div
            className="flex items-center justify-between gap-2 px-5 py-4"
            style={{ borderTop: '1px solid var(--border-subtle, #2a2a35)' }}
          >
            {/* Nada a fazer: não oferecer botão de escrita. Um "Aplicar" que resulta
                em "nada alterado" só ensina o operador a clicar sem ler. */}
            {proposal.alreadyInSuggestedCategory ? (
              <>
                <button onClick={handleReject} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-400">
                  Discordo da categoria
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setChannelTargetCategory({
                        id: proposal.currentCategory?.id ?? proposal.leafCategoryId,
                        path: proposal.currentCategory?.fullPath ?? proposal.proposedPath?.join(' › '),
                      })
                      setPhase('channels')
                    }}
                    className="px-3 py-2 rounded-lg text-xs font-bold border hover:border-slate-500 hover:text-white transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border-subtle, #2a2a35)', color: '#cbd5e1' }}
                  >
                    Canais e atributos
                  </button>
                  <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-white" style={{ background: '#059669' }}>
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <button onClick={handleReject} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-400">
                  Recusar sugestão
                </button>

                <div className="flex items-center gap-2">
                  {(proposal.currentCategory?.id || proposal.leafCategoryId || proposal.reusedPrefix?.[proposal.reusedPrefix.length - 1]?.anymarketId) && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId =
                          proposal.leafCategoryId ??
                          proposal.reusedPrefix?.[proposal.reusedPrefix.length - 1]?.anymarketId ??
                          proposal.currentCategory?.id
                        const targetPath =
                          proposal.proposedPath?.join(' › ') ??
                          proposal.currentCategory?.fullPath ??
                          proposal.currentCategory?.name

                        setChannelTargetCategory({ id: targetId, path: targetPath })
                        setPhase('channels')
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-bold border border-indigo-500/40 bg-indigo-950/40 text-indigo-300 hover:border-indigo-400 hover:text-white transition-all flex items-center gap-1"
                      title="Verificar de-para por canal/marketplace e atributos"
                    >
                      <span>🔗 Canais e de-para</span>
                    </button>
                  )}
                  <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-300 hover:text-white">
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white"
                    style={{ background: proposal.createsNewRoot && !confirmNewRoot ? '#b45309' : '#4f46e5' }}
                  >
                    {proposal.fullyExisting
                      ? 'Aplicar categoria existente'
                      : proposal.createsNewRoot && !confirmNewRoot
                      ? 'Criar DEPARTAMENTO novo…'
                      : `Confirmar e substituir${proposal.missingTail?.length ? ` (cria ${proposal.missingTail.length})` : ''}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'working' && (
          <div className="px-5 py-4 text-xs text-indigo-300" style={{ borderTop: '1px solid var(--border-subtle, #2a2a35)' }}>
            Criando categoria e aplicando ao produto…
          </div>
        )}

        {(phase === 'channels' || phase === 'done') && (
          <div
            className="flex items-center justify-end gap-2 px-5 py-4"
            style={{ borderTop: '1px solid var(--border-subtle, #2a2a35)' }}
          >
            {phase === 'channels' && (
              <button onClick={() => setPhase('review')} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-300 hover:text-white">
                ← Voltar
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-white" style={{ background: '#059669' }}>
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

/** Bloco "de → para" com selo por nível — é o que torna a aprovação informada. */
function ProposalReview({ proposal, confirmNewRoot, working, onUseExisting, onInspectChannels }) {
  const níveis = [
    ...(proposal.reusedPrefix ?? []).map((n) => ({ name: n.name, existing: true, meta: n })),
    ...(proposal.missingTail ?? []).map((n) => ({ name: n.name, existing: false, meta: n })),
  ]

  return (
    <div className={working ? 'opacity-50 pointer-events-none' : ''}>
      {/* Já está na categoria certa: nada a criar, nada a substituir. Dizer isso aqui
          evita que o operador clique num botão que não vai fazer nada. */}
      {proposal.alreadyInSuggestedCategory && (
        <div
          className="rounded-lg px-3 py-2.5 mb-4 text-xs"
          style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399' }}
        >
          <strong>Este produto já está nessa categoria.</strong> A análise concordou com a classificação atual — não há
          nada a criar nem a substituir.
        </div>
      )}

      {proposal.createsNewRoot && (
        <div
          className="rounded-lg px-3 py-2.5 mb-4 text-xs"
          style={{ background: 'rgba(180,83,9,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24' }}
        >
          <strong>Atenção: departamento novo.</strong> Nenhum departamento existente foi reconhecido para este produto,
          então o nível 0 seria criado. Isso muda a estrutura do catálogo — na maioria dos casos significa que o
          departamento certo existe com outro nome.
          {confirmNewRoot && <div className="mt-1 font-bold">Confirmação ativada: o próximo clique cria.</div>}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">Categoria atual</p>
          <p className="text-sm text-slate-200 font-medium">
            {proposal.currentCategory?.fullPath ?? proposal.currentCategory?.name ?? '(sem categoria)'}
            {proposal.currentCategory?.id && <span className="text-slate-500 text-xs"> · #{proposal.currentCategory.id}</span>}
          </p>
        </div>
        {proposal.currentCategory?.id && (
          <button
            type="button"
            onClick={() =>
              onInspectChannels?.({
                id: proposal.currentCategory.id,
                path: proposal.currentCategory.fullPath ?? proposal.currentCategory.name,
              })
            }
            className="shrink-0 px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-slate-700 bg-slate-800 text-indigo-300 hover:text-white hover:border-indigo-500 hover:bg-indigo-950/40 transition-all flex items-center gap-1"
            title="Verificar de-para e atributos desta categoria atual"
          >
            <span>🔍 Ver canais e atributos</span>
          </button>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Categoria sugerida</p>
          {(proposal.leafCategoryId || proposal.reusedPrefix?.[proposal.reusedPrefix.length - 1]?.anymarketId) && (
            <button
              type="button"
              onClick={() =>
                onInspectChannels?.({
                  id: proposal.leafCategoryId ?? proposal.reusedPrefix[proposal.reusedPrefix.length - 1].anymarketId,
                  path: proposal.proposedPath?.join(' › '),
                })
              }
              className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold border border-indigo-500/40 bg-indigo-950/40 text-indigo-300 hover:text-white hover:border-indigo-400 hover:bg-indigo-900/50 transition-all flex items-center gap-1"
              title="Verificar de-para por canal/marketplace para esta categoria sugerida"
            >
              <span>🔗 Ver de-para dos marketplaces</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {níveis.map((nível, i) => (
            <span key={`${nível.name}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-600">›</span>}
              <span
                className="px-2 py-1 rounded-md text-xs font-bold border"
                style={
                  nível.existing
                    ? { background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#34d399' }
                    : { background: 'rgba(79,70,229,0.15)', borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc' }
                }
              >
                {nível.existing ? '✓' : '✦'} {nível.name}
              </span>
            </span>
          ))}
        </div>
        {/* A legenda só menciona "será criado" quando algo realmente será criado —
            mostrar o símbolo sempre fazia parecer que havia nó novo no caminho. */}
        <p className="text-[11px] text-slate-500 mt-2">
          <span className="text-emerald-400">✓ existe</span>
          {proposal.missingTail?.length > 0 && (
            <>
              {' · '}
              <span className="text-indigo-300">✦ será criado</span>
            </>
          )}
          {typeof proposal.confidence === 'number' && ` · confiança ${Math.round(proposal.confidence * 100)}%`}
        </p>
      </div>

      {proposal.reusedPrefix?.some((n) => n.matchStage !== 'exact_key') && (
        <div className="mb-3 text-[11px] text-slate-400">
          {proposal.reusedPrefix
            .filter((n) => n.matchStage !== 'exact_key')
            .map((n) => (
              <div key={n.anymarketId}>
                Reuso: <strong className="text-slate-300">{n.name}</strong> casou com #{n.anymarketId} por{' '}
                {n.matchStage === 'fuzzy' ? 'semelhança' : n.matchStage} ({n.matchScore})
              </div>
            ))}
        </div>
      )}

      {proposal.globalSimilar?.length > 0 && (
        <div
          className="rounded-lg px-3 py-2.5 mb-3 text-xs"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
        >
          <p className="font-bold text-amber-400 mb-1">Categorias parecidas que já existem</p>
          <p className="text-[11px] text-slate-400 mb-2">
            Se alguma delas for a categoria certa, use-a — nada será criado e o produto vai direto para ela.
          </p>

          {proposal.globalSimilar.map((c) => (
            <div key={c.anymarketId} className="flex items-center justify-between gap-2 py-1">
              <span className="text-slate-300">
                {c.fullPath}{' '}
                <span className="text-slate-500">
                  · {Math.round(c.score * 100)}% parecido · #{c.anymarketId}
                </span>
              </span>
              <button
                onClick={() => onUseExisting?.(c)}
                className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold border"
                style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}
              >
                Usar esta
              </button>
            </div>
          ))}
        </div>
      )}

      {proposal.rejectedCandidates?.length > 0 && (
        <details className="text-xs mb-3">
          <summary className="cursor-pointer text-slate-400">
            Quase-duplicatas descartadas ({proposal.rejectedCandidates.length})
          </summary>
          <div className="mt-1.5 pl-3 space-y-0.5">
            {proposal.rejectedCandidates.map((c, i) => (
              <div key={`${c.anymarketId}-${i}`} className="text-slate-400">
                {c.fullPath} <span className="text-slate-600">({c.metric} {c.score})</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {proposal.nameViolations?.length > 0 && (
        <div className="text-xs mb-3" style={{ color: '#fbbf24' }}>
          {proposal.nameViolations.map((v, i) => (
            <div key={i}>⚠ {v.message}</div>
          ))}
        </div>
      )}

      {/* O que exatamente o botão vai fazer. Sem isto, "Confirmar e substituir (cria 1)"
          não diz O QUE cria, nem sob qual pai, nem para onde o produto vai. */}
      <div
        className="rounded-lg px-3 py-2.5 mb-3 text-xs"
        style={{ background: 'rgba(79,70,229,0.10)', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        <p className="font-bold text-indigo-300 mb-1">Ao confirmar, o CRIA vai:</p>
        <ol className="space-y-0.5 text-slate-300 list-decimal list-inside">
          {proposal.missingTail?.map((n, i) => (
            <li key={n.name}>
              criar a categoria <strong>{n.name}</strong>
              {i === 0
                ? proposal.reusedPrefix?.length
                  ? ` dentro de ${proposal.reusedPrefix[proposal.reusedPrefix.length - 1].name}`
                  : ' como DEPARTAMENTO novo (nível 0)'
                : ` dentro de ${proposal.missingTail[i - 1].name}`}
            </li>
          ))}
          <li>
            mover este produto para <strong>{proposal.proposedPath?.[proposal.proposedPath.length - 1]}</strong>
            {proposal.currentCategory?.fullPath ? (
              <span className="text-slate-500"> (sai de {proposal.currentCategory.fullPath})</span>
            ) : null}
          </li>
        </ol>
      </div>

      {!proposal.fullyExisting && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(255,255,255,0.03)', color: '#9a9ab0' }}
        >
          Criar categoria no AnyMarket não é reversível pelo CRIA. Já a troca de categoria do produto é: fica
          registrada com desfazer de 1 clique na aba Logs. Categoria nova nasce sem de-para de canal — o passo de
          vínculo por canal aparece aqui mesmo depois de aplicar, e sem ele o produto não publica nos marketplaces.
        </div>
      )}

      {proposal.reasoning && <p className="text-[11px] text-slate-500 mt-3 italic">{proposal.reasoning}</p>}
    </div>
  )
}
