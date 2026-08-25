import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import PipelineChannelsStage from './PipelineChannelsStage'
import PipelineAttributesStage from './PipelineAttributesStage'
import Icon from './icons/Icon'
import { Button, IconButton } from './ui/primitives'

/**
 * Assistente em etapas para processar um lote de produtos: Título & Descrição →
 * Categoria → Canais (de-para) → Atributos. Ver docs/PLANO_WIZARD_PIPELINE.md.
 *
 * Decisões (2026-08-20): o LOTE inteiro avança junto por etapa (não produto a
 * produto); a seleção de quais etapas rodar é feita a cada execução, via
 * checklist inicial — sem padrão salvo por cliente.
 *
 * Só a etapa "Canais" está de fato implementada aqui (reaproveita o resolver
 * automático já validado em `ChannelBindingPanel`/`PipelineChannelsStage`). As
 * outras três continuam nos fluxos existentes — o wizard só orienta para lá,
 * para não fingir uma funcionalidade que ainda não existe em lote.
 */
const STAGES = [
  {
    key: 'content',
    numero: 1,
    icone: 'pencil',
    titulo: 'Título & Descrição',
    descricao: 'Gerar e aprovar título/descrição com IA para os produtos selecionados.',
  },
  {
    key: 'category',
    numero: 2,
    icone: 'folder',
    titulo: 'Categoria',
    descricao: 'Sugerir e aprovar a categoria do AnyMarket para os produtos selecionados.',
  },
  {
    key: 'channels',
    numero: 3,
    icone: 'link',
    titulo: 'Canais (de-para)',
    descricao: 'Vincular a categoria de cada produto às categorias nativas dos marketplaces ativos.',
  },
  {
    key: 'attributes',
    numero: 4,
    icone: 'fileText',
    titulo: 'Atributos',
    descricao: 'Preencher os atributos obrigatórios (e opcionais) exigidos por cada canal vinculado.',
  },
]

const PLACEHOLDER_POR_ETAPA = {
  content: 'Use a aba Revisão para gerar e aprovar título/descrição destes produtos — essa etapa ainda usa o fluxo de hoje.',
  category: 'Abra um produto na aba Revisão e use o botão "Categoria" para sugerir e aprovar — essa etapa ainda usa o fluxo de hoje.',
}

export default function PipelineWizard({ clientId, products, onClose, initialStages = null }) {
  const defaultStages = { content: true, category: true, channels: true, attributes: true }
  const [fase, setFase] = useState(initialStages ? 'executando' : 'checklist')
  const [runStages, setRunStages] = useState(initialStages ?? defaultStages)
  const [stepIndex, setStepIndex] = useState(0)

  const etapasAtivas = useMemo(() => STAGES.filter((s) => runStages[s.key]), [runStages])
  const etapaAtual = etapasAtivas[stepIndex] ?? null

  const alternarEtapa = (key) => setRunStages((prev) => ({ ...prev, [key]: !prev[key] }))

  const iniciar = () => {
    setStepIndex(0)
    setFase('executando')
  }

  // Quando initialStages é fornecido, começa já na fase executando no step correto
  const stepAtivo = useMemo(() => {
    if (!initialStages) return stepIndex
    const idx = etapasAtivas.findIndex((s) => initialStages[s.key])
    return idx >= 0 ? idx : 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const avancar = () => {
    if (stepIndex >= etapasAtivas.length - 1) {
      onClose?.()
      return
    }
    setStepIndex((i) => i + 1)
  }

  const voltar = () => setStepIndex((i) => Math.max(0, i - 1))

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-slideUp">

        <header className="flex items-center justify-between gap-3 px-5 py-4 shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-500/12 border border-indigo-500/25 text-indigo-300">
              <Icon name="compass" size={16} />
            </span>
            <div>
              <h3 className="t-card">Processamento em etapas</h3>
              <p className="t-meta">{products.length} produto(s) selecionado(s)</p>
            </div>
          </div>
          <IconButton icon="x" label="Fechar assistente" onClick={onClose} />
        </header>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {fase === 'checklist' && (
            <div>
              <p className="t-body mb-4">
                Quais etapas você quer rodar neste lote? Desmarque o que não se aplica — a próxima execução
                começa de novo com tudo marcado.
              </p>

              <div className="space-y-2">
                {STAGES.map((s) => {
                  const on = Boolean(runStages[s.key])
                  return (
                    <label
                      key={s.key}
                      className={`flex items-start gap-3 rounded-xl p-3 cursor-pointer border transition-all ${
                        on ? 'bg-indigo-500/[0.07] border-indigo-500/30' : 'bg-white/[0.02] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => alternarEtapa(s.key)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950 accent-indigo-600 cursor-pointer"
                      />
                      <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${
                        on ? 'bg-indigo-500/15 text-indigo-300' : 'bg-slate-950 text-slate-500'
                      }`}>
                        <Icon name={s.icone} size={14} />
                      </span>
                      <span className="min-w-0">
                        <span className="block t-card">{s.numero}. {s.titulo}</span>
                        <span className="block t-meta mt-0.5">{s.descricao}</span>
                      </span>
                    </label>
                  )
                })}
              </div>

              <Button
                variant="primary"
                size="lg"
                icon="arrowRight"
                className="w-full mt-5"
                onClick={iniciar}
                disabled={!etapasAtivas.length}
              >
                {etapasAtivas.length
                  ? `Iniciar (${etapasAtivas.length} etapa${etapasAtivas.length > 1 ? 's' : ''})`
                  : 'Iniciar processamento'}
              </Button>
            </div>
          )}

          {fase === 'executando' && etapaAtual && (
            <div>
              <p className="flex items-center gap-2 t-label mb-3">
                <Icon name={etapaAtual.icone} size={13} />
                Etapa {stepIndex + 1} de {etapasAtivas.length} · {etapaAtual.titulo}
              </p>

              {etapaAtual.key === 'channels' ? (
                <PipelineChannelsStage clientId={clientId} products={products} />
              ) : etapaAtual.key === 'attributes' ? (
                <PipelineAttributesStage clientId={clientId} products={products} />
              ) : (
                <div className="rounded-xl px-4 py-10 text-center border border-dashed border-slate-700 bg-white/[0.02] space-y-2">
                  <Icon name="info" size={20} className="mx-auto text-slate-500" />
                  <p className="t-card">Etapa ainda não migrada para o assistente em lote</p>
                  <p className="t-meta max-w-md mx-auto">{PLACEHOLDER_POR_ETAPA[etapaAtual.key]}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {fase === 'executando' && (
          <footer className="px-5 py-3.5 flex items-center justify-between gap-3 shrink-0 border-t border-slate-800">
            <div className="flex items-center gap-1.5">
              {etapasAtivas.map((s, i) => (
                <span
                  key={s.key}
                  title={s.titulo}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={
                    i === stepIndex
                      ? { background: 'var(--accent-indigo)', color: '#fff' }
                      : i < stepIndex
                      ? { background: 'rgba(16,185,129,0.2)', color: '#34d399' }
                      : { background: 'rgba(255,255,255,0.06)', color: '#64748b' }
                  }
                >
                  {i < stepIndex ? <Icon name="check" size={11} /> : s.numero}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" icon="arrowLeft" onClick={voltar} disabled={stepIndex === 0}>
                Voltar
              </Button>
              {/* Pular e Avançar chamam o mesmo handler: o registro de "pulei de
                  propósito" (pipeline_skips, §2.2 do plano) ainda não existe, então
                  hoje pular é literalmente seguir sem fazer nada nesta etapa. */}
              <Button size="sm" variant="ghost" onClick={avancar} title="Segue para a próxima etapa sem executar esta">
                Pular esta etapa
              </Button>
              <Button size="sm" variant="primary" iconRight={stepIndex >= etapasAtivas.length - 1 ? undefined : 'arrowRight'} onClick={avancar}>
                {stepIndex >= etapasAtivas.length - 1 ? 'Concluir' : 'Avançar'}
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body
  )
}
