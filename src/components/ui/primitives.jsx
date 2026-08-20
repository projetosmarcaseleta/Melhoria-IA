import Icon from '../icons/Icon'
import { TONE, toneStyle } from './productTokens'
import { wordDiff } from '../../utils/diffUtils'

/**
 * Primitivas visuais compartilhadas.
 *
 * Existem para dar UMA hierarquia à interface: antes, praticamente todo texto
 * era `text-xs`/`text-[10px]` com `font-extrabold` e caixa alta (no ReviewPanel,
 * 52 das 58 declarações de tamanho eram ≤12px), então nada se destacava de
 * nada. Aqui só a ação primária tem peso de ação primária.
 */

// ── Botões ─────────────────────────────────────────────────────────
const VARIANTS = {
  primary:   'text-white border-transparent shadow-lg',
  secondary: 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-100',
  ghost:     'bg-transparent hover:bg-slate-800/70 border-transparent text-slate-300 hover:text-white',
  outline:   'bg-slate-950/60 hover:bg-slate-800 border-slate-700 text-slate-200',
  danger:    'bg-rose-600/15 hover:bg-rose-600/25 border-rose-500/40 text-rose-300',
  success:   'bg-emerald-600/15 hover:bg-emerald-600/25 border-emerald-500/40 text-emerald-300',
}

const SIZES = {
  sm: 'px-2.5 py-1.5 text-[12px] gap-1.5 rounded-lg',
  md: 'px-3.5 py-2 text-[13px] gap-2 rounded-xl',
  lg: 'px-5 py-2.5 text-[13px] gap-2 rounded-xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  count,
  children,
  className = '',
  style,
  ...rest
}) {
  const isPrimary = variant === 'primary'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center border font-semibold transition-all
        disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      style={isPrimary ? { background: 'linear-gradient(135deg, #336cff, #6337f1)', boxShadow: '0 4px 18px rgba(51,108,255,0.3)', ...style } : style}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children && <span>{children}</span>}
      {count > 0 && (
        <span
          className="min-w-[18px] px-1 rounded-full text-[11px] font-bold tabular-nums"
          style={isPrimary ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : { background: 'rgba(255,255,255,0.1)', color: 'inherit' }}
        >
          {count}
        </span>
      )}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 13 : 15} />}
    </button>
  )
}

export function IconButton({ icon, label, variant = 'ghost', size = 30, className = '', ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-lg border transition-all
        disabled:opacity-40 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60
        ${VARIANTS[variant]} ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={size >= 32 ? 16 : 14} />
    </button>
  )
}

// ── Badge ──────────────────────────────────────────────────────────
export function Badge({ tone = 'neutral', icon, children, style, className = '', title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-md text-[11px] font-semibold whitespace-nowrap ${className}`}
      style={style ?? toneStyle(tone)}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  )
}

/** Badge que recebe as cores prontas de `TYPE_BADGE` (cores por tipo de produto). */
export function TypeBadge({ badge }) {
  return (
    <Badge style={{ color: badge.color, background: badge.bg, border: `1px solid ${badge.border}` }}>
      {badge.text}
    </Badge>
  )
}

// ── Superfícies ────────────────────────────────────────────────────
export function Panel({ children, className = '', ...rest }) {
  return (
    <section className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-lg overflow-hidden ${className}`} {...rest}>
      {children}
    </section>
  )
}

export function PanelHeader({ icon, title, hint, children, className = '' }) {
  return (
    <header className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/50 border-b border-slate-800 ${className}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/12 border border-indigo-500/25 text-indigo-300">
            <Icon name={icon} size={15} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="t-card">{title}</h2>
          {hint && <p className="t-meta mt-0.5">{hint}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </header>
  )
}

// ── Medidor de caracteres ──────────────────────────────────────────
export function Meter({ value, max, meter }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="flex items-center gap-2" title={meter.hint}>
      <div className="h-1 w-16 rounded-full overflow-hidden bg-slate-950 border border-slate-800">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: meter.color }} />
      </div>
      <span className="t-mono tabular-nums" style={{ color: meter.color }}>{value}/{max}</span>
    </div>
  )
}

// ── Diff em linha ──────────────────────────────────────────────────
/**
 * Renderiza o diff palavra-por-palavra. `mode='inline'` esconde as remoções
 * (usado na linha compacta, onde só cabe a versão nova); `mode='full'` mostra
 * as duas, para a leitura atenta no card expandido.
 */
export function DiffText({ before, after, mode = 'inline', className = '' }) {
  const parts = wordDiff(before, after)
  const visible = mode === 'inline' ? parts.filter((p) => p.type !== 'del') : parts

  if (!visible.length) return <span className="t-meta italic">—</span>

  return (
    <span className={className}>
      {visible.map((p, i) => {
        if (p.type === 'same') return <span key={i}>{p.text}</span>
        if (p.type === 'add') return <mark key={i} className="diff-add">{p.text}</mark>
        return <del key={i} className="diff-del">{p.text}</del>
      })}
    </span>
  )
}

// ── Estado vazio ───────────────────────────────────────────────────
export function EmptyState({ icon = 'box', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-8 bg-slate-900 border border-slate-800 rounded-2xl animate-fadeIn">
      <span className="w-12 h-12 rounded-2xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="t-page">{title}</h3>
      {children && <p className="t-body max-w-md">{children}</p>}
      {action}
    </div>
  )
}

// ── Dica de teclado ────────────────────────────────────────────────
export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>
}

export { TONE }
