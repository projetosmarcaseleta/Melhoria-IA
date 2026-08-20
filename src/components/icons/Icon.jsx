/**
 * Conjunto de ícones em SVG inline (traço, 24x24, herda `currentColor`).
 *
 * Substitui o uso de emoji como sistema de ícones: emoji muda de desenho por
 * sistema operacional, não tem controle de peso/tamanho e colidia em
 * significado (👁️ era ao mesmo tempo a aba "Revisão" e o botão "mostrar
 * token"). Segue a convenção que já existia em `icons/CriaSymbol.jsx`.
 */

const PATHS = {
  // ── Navegação ──────────────────────────────────────────────
  box: ['M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z', 'M3.3 7 12 12l8.7-5', 'M12 22V12'],
  review: ['M3 6.5h11', 'M3 12h7', 'M3 17.5h5', 'M14.5 15.5l2.5 2.5 4.5-5'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  zap: ['M13 2 4 14h6l-1 8 9-12h-6l1-8z'],
  chart: ['M3 3v18h18', 'M7.5 15.5l3.5-4.5 3 3 5.5-7'],
  crown: ['M3 7.5l4.5 4L12 4l4.5 7.5 4.5-4V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5z'],
  help: ['M9.2 9.3a3 3 0 1 1 4.1 2.8c-.8.4-1.3 1.1-1.3 2v.4', 'M12 17.6h.01'],
  list: ['M8 6h13M8 12h13M8 18h13', 'M3.5 6h.01M3.5 12h.01M3.5 18h.01'],

  // ── Ações ──────────────────────────────────────────────────
  sparkles: ['M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z', 'M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9z'],
  refresh: ['M20.5 12a8.5 8.5 0 1 1-2.6-6.1', 'M20.5 3.5v5h-5'],
  send: ['M21.5 2.5 10.8 13.2', 'M21.5 2.5l-6.8 19-3.9-8.3-8.3-3.9 19-6.8z'],
  check: ['M20 6.5 9.2 17.3l-5.2-5.2'],
  checkCircle: ['M8.2 12.2l2.6 2.6 5-5', 'CIRCLE:12,12,9.2'],
  x: ['M18 6 6 18M6 6l12 12'],
  xCircle: ['M14.8 9.2l-5.6 5.6M9.2 9.2l5.6 5.6', 'CIRCLE:12,12,9.2'],
  trash: ['M3.5 6.5h17', 'M8.5 6.5V4.6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.9', 'M18.5 6.5l-.9 13.2a1.8 1.8 0 0 1-1.8 1.7H8.2a1.8 1.8 0 0 1-1.8-1.7L5.5 6.5', 'M10 11v6M14 11v6'],
  download: ['M20.5 15.5v3.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.6', 'M7.5 10.5l4.5 4.5 4.5-4.5', 'M12 15V3.5'],
  upload: ['M20.5 15.5v3.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.6', 'M16.5 8 12 3.5 7.5 8', 'M12 3.5V15'],
  plus: ['M12 5.5v13M5.5 12h13'],
  stop: ['M7 7h10v10H7z'],
  archive: ['M3.5 3.5h17v4.5h-17z', 'M5.5 8v11.5a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8V8', 'M10 12h4'],
  pencil: ['M12 20.5h8.5', 'M16.8 3.7a2.1 2.1 0 0 1 3 3L7.5 19 3.5 20l1-4L16.8 3.7z'],
  code: ['M8.5 8 4 12.2l4.5 4.2', 'M15.5 8 20 12.2l-4.5 4.2', 'M13.5 4.5l-3 15'],
  columns: ['M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z', 'M12 4.5v15'],

  // ── Estado / objetos ───────────────────────────────────────
  key: ['M20.5 3.5l-2 2', 'M13.4 10.6 18.5 5.5l3 3-3.5 3.5-3-3', 'CIRCLE:8,16,4.6'],
  lock: ['M5.5 10.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z', 'M8.2 10.5V7a3.8 3.8 0 0 1 7.6 0v3.5'],
  alert: ['M10.3 4 2.2 18.2A2 2 0 0 0 3.9 21.2h16.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17.2h.01'],
  info: ['M12 16.5v-5.2', 'M12 8h.01', 'CIRCLE:12,12,9.2'],
  clock: ['M12 7.2V12l3.4 2', 'CIRCLE:12,12,9.2'],
  folder: ['M21.5 18.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4.6l2 3h8.4a2 2 0 0 1 2 2z'],
  fileText: ['M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5z', 'M14 3v5.5h5.5', 'M8.5 13.5h7M8.5 17h4.5'],
  tag: ['M20.4 13.2 12.6 21 3.5 11.9V4a1 1 0 0 1 1-1h7.9l8 8a2 2 0 0 1 0 2.2z', 'M7.6 7.6h.01'],
  database: ['M3.5 5.5v13c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-13', 'M3.5 12c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3', 'ELLIPSE:12,5.5,8.5,3'],
  link: ['M10.2 13.8a4.5 4.5 0 0 0 6.7.4l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6', 'M13.8 10.2a4.5 4.5 0 0 0-6.7-.4l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6'],
  compass: ['M16.2 7.8l-2.9 6.9-6.9 2.9 2.9-6.9 6.9-2.9z', 'CIRCLE:12,12,9.2'],
  layers: ['M12 2.5 2.8 7 12 11.5 21.2 7 12 2.5z', 'M2.8 12 12 16.5l9.2-4.5', 'M2.8 17 12 21.5l9.2-4.5'],
  building: ['M4.5 21V4.5a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5V21', 'M14.5 8.5h3a1.5 1.5 0 0 1 1.5 1.5V21', 'M2.5 21h19', 'M8 7.5h2.5M8 11.5h2.5M8 15.5h2.5'],
  search: ['M20.5 20.5l-4.4-4.4', 'CIRCLE:11,11,6.6'],
  filter: ['M21 4H3l7.2 8.6V19l3.6 1.8v-8.2L21 4z'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'CIRCLE:12,12,3'],
  eyeOff: ['M3 3l18 18', 'M10.7 5.7a9.6 9.6 0 0 1 1.3-.2c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.3 3.1', 'M6.4 6.4A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.6-.7', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  logout: ['M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 16.5l4.5-4.5L16 7.5', 'M20.5 12h-11'],
  gear: ['M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z', 'CIRCLE:12,12,3'],

  // ── Direção ────────────────────────────────────────────────
  chevronDown: ['M6 9.5l6 6 6-6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronLeft: ['M14.5 6l-6 6 6 6'],
  arrowRight: ['M4.5 12h15M13.5 6l6 6-6 6'],
  arrowLeft: ['M19.5 12h-15M10.5 6l-6 6 6 6'],
}

/** Traduz a notação compacta de PATHS num elemento SVG. */
function renderShape(d, i) {
  if (d.startsWith('CIRCLE:')) {
    const [cx, cy, r] = d.slice(7).split(',')
    return <circle key={i} cx={cx} cy={cy} r={r} />
  }
  if (d.startsWith('ELLIPSE:')) {
    const [cx, cy, rx, ry] = d.slice(8).split(',')
    return <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />
  }
  return <path key={i} d={d} />
}

export default function Icon({ name, size = 16, strokeWidth = 1.9, className = '', title }) {
  const shapes = PATHS[name]
  if (!shapes) {
    if (import.meta.env?.DEV) console.warn(`[Icon] Ícone desconhecido: "${name}"`)
    return null
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {shapes.map(renderShape)}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(PATHS)
