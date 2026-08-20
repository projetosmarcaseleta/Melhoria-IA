import { useMemo, useState } from 'react'
import Icon from './icons/Icon'
import { Badge, Button, IconButton, TypeBadge, Meter, DiffText } from './ui/primitives'
import { typeBadgeOf, statusOf, blockReason, titleMeter, TITLE_MAX } from './ui/productTokens'
import { collectViolations } from '../utils/validationUtils'
import { diffSummary, htmlToText, hasBlockHtml, plainTextToHtml } from '../utils/diffUtils'

/**
 * Um produto na fila de revisão: linha compacta que expande para o editor.
 *
 * Antes cada produto era um card fixo de ~600px com quatro quadrantes. Com os
 * 50-200 produtos por lote que o fluxo assume, isso dava ~40 telas de rolagem
 * sem paginação, sem colapso do que já foi aprovado e sem teclado. Aqui a fila
 * é escaneável (linha de ~44px) e o editor completo abre só no item em que o
 * operador está trabalhando.
 *
 * O título é apresentado como "atual vs. gerado" em painéis rotulados — o diff
 * palavra-por-palavra ficou disponível num modo à parte, porque misturar texto
 * riscado com texto novo na mesma frase confundia mais do que ajudava.
 */

const TITLE_MODES = [
  { key: 'compare', label: 'Atual / Gerado', icon: 'columns', hint: 'Compara o título atual com o gerado' },
  { key: 'diff', label: 'Diferenças', icon: 'layers', hint: 'Marca palavra por palavra o que saiu e o que entrou' },
]

const DESC_MODES = [
  { key: 'preview', label: 'Prévia', icon: 'eye', hint: 'Como vai aparecer no anúncio' },
  { key: 'diff', label: 'Diferenças', icon: 'layers', hint: 'O que mudou em relação à descrição atual' },
  { key: 'html', label: 'HTML', icon: 'code', hint: 'Editar o HTML na mão' },
]

export default function ReviewProductRow({
  product: p,
  isSelected,
  isExpanded,
  isFocused,
  fieldSel,
  titleFeedback,
  descFeedback,
  descView,
  categoryEnabled,
  isLoading,
  onToggleSelect,
  onToggleExpand,
  onToggleField,
  onSetDescView,
  onEditTitle,
  onEditDescription,
  onFeedback,
  onRedo,
  onCategory,
}) {
  const [titleView, setTitleView] = useState('compare')

  const st = statusOf(p)
  const motivo = blockReason(p)
  const violations = collectViolations(p)
  const titleLen = (p.newTitle ?? '').length
  const meter = titleMeter(titleLen)

  const descBefore = useMemo(() => htmlToText(p.description), [p.description])
  const descAfter = useMemo(() => htmlToText(p.newDescription), [p.newDescription])
  const descChange = useMemo(() => diffSummary(descBefore, descAfter), [descBefore, descAfter])

  // A descrição gerada veio como HTML de verdade? Se não, a prévia mostraria um
  // parágrafo corrido — que é exatamente o que o marketplace exibiria.
  const descIsHtml = useMemo(() => hasBlockHtml(p.newDescription), [p.newDescription])
  const descPreviewHtml = useMemo(
    () => (descIsHtml ? (p.newDescription || '<em>—</em>') : plainTextToHtml(p.newDescription)),
    [descIsHtml, p.newDescription]
  )

  const titleGenId = p.titleGenerationId
  const descGenId = p.descGenerationId
  const rowFeedback = titleFeedback ?? descFeedback

  const FeedbackButtons = ({ genId, current }) => (
    <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
      <button
        type="button"
        onClick={() => onFeedback(genId, 'approved')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] font-semibold transition-all ${
          current === 'approved' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-300'
        }`}
      >
        <Icon name="check" size={12} />Aprovar
      </button>
      <button
        type="button"
        onClick={() => onFeedback(genId, 'rejected')}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] font-semibold transition-all ${
          current === 'rejected' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-rose-300'
        }`}
      >
        <Icon name="x" size={12} />Rejeitar
      </button>
    </div>
  )

  const ModeSwitch = ({ modes, value, onChange }) => (
    <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          title={m.hint}
          onClick={() => onChange(m.key)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] font-semibold transition-all ${
            value === m.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <Icon name={m.icon} size={12} />
          <span className="hidden sm:inline">{m.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div
      data-selected={isSelected}
      data-focused={isFocused}
      className={`border-b border-white/5 last:border-b-0 transition-colors ${
        isSelected ? 'bg-indigo-500/[0.07]' : ''
      } ${isFocused ? 'shadow-[inset_2px_0_0_var(--accent-indigo)]' : ''}`}
    >
      {/* ── Linha compacta ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02]">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          aria-label={`Selecionar produto ${p.id}`}
          className="w-4 h-4 shrink-0 rounded border-slate-700 bg-slate-950 accent-indigo-600 cursor-pointer"
        />

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Recolher produto' : 'Expandir produto'}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-all"
        >
          <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>

        <button type="button" onClick={onToggleExpand} className="flex-1 min-w-0 text-left flex flex-col gap-0.5">
          <span className="flex items-center gap-2 min-w-0">
            <span className="t-mono text-slate-500 shrink-0">{p.id}</span>
            {/* Título gerado, limpo: as marcas de diff na fila poluíam a leitura. */}
            <span className="text-[13px] text-white truncate min-w-0">
              {p.newTitle || <span className="t-meta italic">sem título gerado</span>}
            </span>
          </span>

          {!isExpanded && (
            <span className="flex items-center gap-2.5 flex-wrap">
              {descChange.changed && (
                <span className="t-meta flex items-center gap-1">
                  <Icon name="fileText" size={11} />
                  descrição: +{descChange.added} / −{descChange.removed} palavras
                </span>
              )}
              {violations.length > 0 && (
                <span className="text-[12px] font-medium text-amber-300 flex items-center gap-1">
                  <Icon name="alert" size={11} />
                  {violations.length} ponto(s) a revisar
                </span>
              )}
              {motivo && (
                <span className="text-[12px] text-rose-300/90 flex items-center gap-1 truncate max-w-[320px]" title={motivo}>
                  <Icon name="lock" size={11} />
                  {motivo}
                </span>
              )}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {p.newTitle && <div className="hidden lg:block"><Meter value={titleLen} max={TITLE_MAX} meter={meter} /></div>}

          {rowFeedback && (
            <Badge
              tone={rowFeedback === 'approved' ? 'success' : rowFeedback === 'rejected' ? 'danger' : 'warning'}
              icon={rowFeedback === 'approved' ? 'check' : rowFeedback === 'rejected' ? 'x' : 'pencil'}
            >
              {rowFeedback === 'approved' ? 'Aprovado' : rowFeedback === 'rejected' ? 'Rejeitado' : 'Editado'}
            </Badge>
          )}

          <div className="hidden md:flex items-center gap-1.5">
            <TypeBadge badge={typeBadgeOf(p)} />
            <Badge tone={st.tone} icon={st.icon}>{st.text}</Badge>
          </div>

          <IconButton
            icon="check"
            label="Aprovar este produto (título e descrição)"
            variant="success"
            onClick={() => {
              if (titleGenId) onFeedback(titleGenId, 'approved')
              if (descGenId) onFeedback(descGenId, 'approved')
            }}
          />
          <IconButton
            icon="refresh"
            label="Gerar novamente com IA"
            variant="ghost"
            disabled={isLoading}
            onClick={() => onRedo(p)}
          />
        </div>
      </div>

      {/* ── Editor expandido ───────────────────────────────────────── */}
      {isExpanded && (
        <div className="bg-slate-950/40 border-t border-slate-800/70 animate-fadeIn">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/70">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="t-label">Mostrar</span>
              {[
                { field: 'titulo', label: 'Título', icon: 'tag' },
                { field: 'descricao', label: 'Descrição', icon: 'fileText' },
              ].map((f) => (
                <button
                  key={f.field}
                  type="button"
                  onClick={() => onToggleField(f.field)}
                  aria-pressed={fieldSel[f.field]}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border transition-all ${
                    fieldSel[f.field]
                      ? 'bg-indigo-600/20 border-indigo-500/70 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon name={f.icon} size={12} />
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {categoryEnabled && (
                <Button size="sm" variant="outline" icon="folder" disabled={isLoading} onClick={() => onCategory(p)}>
                  Categoria
                </Button>
              )}
              <Button size="sm" variant="outline" icon="refresh" disabled={isLoading} onClick={() => onRedo(p)}>
                Gerar novamente
              </Button>
            </div>
          </div>

          {motivo && (
            <div className="flex items-start gap-2 px-4 py-2.5 border-b border-rose-500/20 bg-rose-500/[0.06]">
              <Icon name="lock" size={14} className="text-rose-400 mt-0.5" />
              <p className="text-[12px] text-rose-200/90">
                <strong className="font-semibold">Não pode ser publicado pela API.</strong> {motivo}. Use
                {' '}<em>Só aprovar</em> para o CRIA aprender e edite este produto no painel da AnyMarket.
              </p>
            </div>
          )}

          {violations.length > 0 && (
            <div className="px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.06] space-y-1.5">
              <p className="text-[12px] font-semibold text-amber-300 flex items-center gap-1.5">
                <Icon name="alert" size={13} />
                {violations.length} ponto{violations.length > 1 ? 's' : ''} que precisa
                {violations.length > 1 ? 'm' : ''} de revisão
              </p>
              <ul className="space-y-1">
                {violations.map((v, i) => (
                  <li key={i} className="text-[12px] text-slate-300 flex items-start gap-2 leading-snug">
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-950 border border-slate-700 text-slate-400">
                      {v.field === 'titulo' ? 'Título' : 'Descrição'}
                    </span>
                    <span>{v.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Título ─────────────────────────────────────────────── */}
          {fieldSel.titulo && (
            <div className="px-4 py-3.5 border-b border-slate-800/70 space-y-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="t-label">Título</span>
                <div className="flex items-center gap-2">
                  <ModeSwitch modes={TITLE_MODES} value={titleView} onChange={setTitleView} />
                  <Meter value={titleLen} max={TITLE_MAX} meter={meter} />
                  {titleGenId && <FeedbackButtons genId={titleGenId} current={titleFeedback} />}
                </div>
              </div>

              {titleView === 'diff' ? (
                <p className="text-[13px] leading-relaxed p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <DiffText before={p.title} after={p.newTitle ?? ''} mode="full" />
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
                    <p className="t-label px-3 py-1.5 border-b border-slate-800">Título atual</p>
                    <p className="px-3 py-2.5 text-[13px] text-slate-300 leading-snug">
                      {p.title || <span className="t-meta italic">—</span>}
                    </p>
                  </div>
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden">
                    <p className="t-label px-3 py-1.5 border-b border-indigo-500/20 text-indigo-300/80">
                      Título gerado (IA)
                    </p>
                    <div className="px-3 py-2.5">
                      <input
                        type="text"
                        value={p.newTitle ?? ''}
                        onChange={(e) => onEditTitle(p.id, e.target.value)}
                        disabled={isLoading}
                        aria-label="Título gerado"
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-[13px] text-white font-medium focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              <p className="t-meta">{meter.hint}</p>
            </div>
          )}

          {/* ── Descrição ──────────────────────────────────────────── */}
          {fieldSel.descricao && (
            <div className="px-4 py-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="t-label">Descrição</span>
                <div className="flex items-center gap-2">
                  <ModeSwitch modes={DESC_MODES} value={descView} onChange={(m) => onSetDescView(p.id, m)} />
                  {descGenId && <FeedbackButtons genId={descGenId} current={descFeedback} />}
                </div>
              </div>

              {/* O prompt exige HTML; quando não vem, o marketplace mostra tudo
                  num parágrafo só — então o aviso é o conteúdo honesto aqui. */}
              {descView === 'preview' && p.newDescription && !descIsHtml && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07]">
                  <Icon name="alert" size={13} className="text-amber-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-amber-200/90">
                      <strong className="font-semibold">A descrição veio sem formatação HTML.</strong> A prévia
                      abaixo mostra as quebras de linha do texto gerado, mas o que vai ser publicado é texto
                      puro — o marketplace exibiria tudo num parágrafo corrido.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    icon="code"
                    disabled={isLoading}
                    title="Transforma as quebras de linha em <p> e <br>, exatamente como a prévia mostra"
                    onClick={() => onEditDescription(p.id, plainTextToHtml(p.newDescription))}
                  >
                    Converter em HTML
                  </Button>
                </div>
              )}

              {descView === 'diff' ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 max-h-80 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap">
                  <DiffText before={descBefore} after={descAfter} mode="full" />
                </div>
              ) : descView === 'html' ? (
                <textarea
                  value={p.newDescription ?? ''}
                  onChange={(e) => onEditDescription(p.id, e.target.value)}
                  disabled={isLoading}
                  rows={12}
                  aria-label="HTML da descrição gerada"
                  className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-[12px] text-white font-mono leading-relaxed focus:outline-none focus:border-emerald-500 transition-all resize-y"
                />
              ) : (
                /* A prévia do anúncio é a estrela: fica com o dobro da largura
                   da descrição atual, que serve só de referência. */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
                    <p className="t-label px-3 py-1.5 border-b border-slate-800">Descrição atual</p>
                    <div
                      className="rich-text p-3 max-h-80 overflow-y-auto opacity-80"
                      dangerouslySetInnerHTML={{ __html: p.description || '<em>—</em>' }}
                    />
                  </div>

                  <div className="lg:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-950/10 overflow-hidden">
                    <p className="t-label px-3 py-1.5 border-b border-emerald-500/20 text-emerald-300/80 flex items-center gap-1.5">
                      <Icon name="eye" size={11} />
                      Como vai aparecer no anúncio
                    </p>
                    <div
                      className="rich-text p-4 max-h-80 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: descPreviewHtml || '<em>—</em>' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
