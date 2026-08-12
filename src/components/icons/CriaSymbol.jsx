/**
 * Reconstrução em SVG do símbolo do CRIA (robô com antena, recorte inferior,
 * gradiente CRIA Blue -> CRIA Violet) — ver cria-brand-book.pdf, seção 04/05.
 * Placeholder até o recorte oficial do ícone isolado (PNG/SVG transparente)
 * ser fornecido — trocar por <img src="/cria-symbol.svg" /> quando disponível.
 */
export default function CriaSymbol({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="CRIA"
    >
      <defs>
        <linearGradient id="criaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#336CFF" />
          <stop offset="100%" stopColor="#6337F1" />
        </linearGradient>
        <mask id="criaHeadMask">
          <rect x="0" y="0" width="200" height="200" fill="black" />
          <rect x="25" y="25" width="150" height="150" rx="55" fill="white" />
          <rect x="58" y="58" width="84" height="84" rx="28" fill="black" />
          <rect x="118" y="122" width="62" height="53" fill="black" />
        </mask>
      </defs>

      {/* Antena */}
      <line x1="148" y1="42" x2="164" y2="18" stroke="url(#criaGradient)" strokeWidth="9" strokeLinecap="round" />
      <circle cx="167" cy="13" r="11" fill="url(#criaGradient)" />

      {/* Cabeça (anel com recorte inferior) */}
      <rect x="0" y="0" width="200" height="200" fill="url(#criaGradient)" mask="url(#criaHeadMask)" />

      {/* Olhos */}
      <path d="M68,108 q11,-18 22,0" stroke="#111A46" strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M110,108 q11,-18 22,0" stroke="#111A46" strokeWidth="9" fill="none" strokeLinecap="round" />
    </svg>
  )
}
