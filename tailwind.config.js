/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta oficial CRIA (ver cria-brand-book.pdf, seção 06)
        cria: {
          blue: '#336CFF',
          violet: '#6337F1',
          navy: '#111A46',
          cyan: '#35B9FF',
          ice: '#F5F7FC',
        },
        brand: {
          50: '#eef3ff',
          100: '#dde6ff',
          500: '#336CFF',
          600: '#4a4ff0',
          700: '#6337F1',
        },
        // `indigo` é a cor de destaque usada em toda a UI (botões, abas ativas,
        // bordas de foco). Sobrescrita aqui para herdar a identidade CRIA
        // (azul -> violeta) sem precisar editar cada componente individualmente.
        indigo: {
          50: '#eef3ff',
          100: '#dde6ff',
          200: '#b9ccff',
          300: '#8aa8ff',
          400: '#5c82ff',
          500: '#336CFF', // CRIA Blue
          600: '#4a4ff0',
          700: '#6337F1', // CRIA Violet
          800: '#4c2bc4',
          900: '#382296',
          950: '#111A46', // CRIA Navy
        },
        // `slate` é usada como fundo/borda do tema escuro. Reafinada com viés
        // navy (em vez de cinza neutro) para casar com o fundo CRIA Navy.
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#3f4a72',
          700: '#293464',
          800: '#1a2350',
          900: '#111A46', // CRIA Navy
          950: '#0a0e2c',
        },
      },
    },
  },
  plugins: [],
}
