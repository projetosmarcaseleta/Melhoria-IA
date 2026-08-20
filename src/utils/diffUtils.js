/**
 * Diff palavra-por-palavra para mostrar, na hora da decisão, o que a IA mudou.
 *
 * O projeto já renderizava diff (react-diff-viewer em LogEntry.jsx), mas só
 * DEPOIS de publicar, no log de auditoria — na tela onde o operador aprova não
 * havia nenhum destaque, ele comparava os dois textos a olho. Aqui a saída é
 * leve o suficiente para caber numa linha de lista compacta.
 */

/** Quebra em palavras preservando os espaços, para remontar o texto sem perdas. */
function tokenize(text) {
  return (text ?? '').split(/(\s+)/).filter((t) => t !== '')
}

/**
 * Diff por palavras via LCS (matriz de programação dinâmica).
 * Retorna `[{ type: 'same' | 'add' | 'del', text }]`.
 *
 * O custo é O(n·m); títulos e descrições de anúncio ficam na casa das centenas
 * de palavras, então `MAX_TOKENS` só protege contra uma descrição gigante
 * travar a renderização da lista.
 */
const MAX_TOKENS = 1200

export function wordDiff(before, after) {
  const a = tokenize(before)
  const b = tokenize(after)

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    // Fallback: sem diff fino, devolve os dois blocos inteiros.
    const out = []
    if (a.length) out.push({ type: 'del', text: a.join('') })
    if (b.length) out.push({ type: 'add', text: b.join('') })
    return out
  }

  // lcs[i][j] = tamanho da maior subsequência comum entre a[i..] e b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const raw = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { raw.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { raw.push({ type: 'del', text: a[i] }); i++ }
    else { raw.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < a.length) { raw.push({ type: 'del', text: a[i] }); i++ }
  while (j < b.length) { raw.push({ type: 'add', text: b[j] }); j++ }

  // Junta trechos vizinhos do mesmo tipo para gerar menos elementos na tela.
  const merged = []
  for (const tk of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === tk.type) last.text += tk.text
    else merged.push({ ...tk })
  }
  return merged
}

/** Só a versão nova, com as palavras acrescentadas marcadas (para linhas compactas). */
export function additionsOnly(before, after) {
  return wordDiff(before, after).filter((t) => t.type !== 'del')
}

/** Quantas palavras entraram e saíram — usado no resumo da linha da lista. */
export function diffSummary(before, after) {
  let added = 0
  let removed = 0
  for (const t of wordDiff(before, after)) {
    const words = t.text.trim() ? t.text.trim().split(/\s+/).length : 0
    if (t.type === 'add') added += words
    if (t.type === 'del') removed += words
  }
  return { added, removed, changed: added > 0 || removed > 0 }
}

/** Texto puro a partir de HTML, para diff e prévia de descrição em uma linha. */
export function htmlToText(html) {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * O texto tem estrutura HTML de bloco?
 *
 * O prompt de descrição exige HTML (`<p>`, `<strong>`, `<ul>`, `<li>` — ver
 * `promptResolver.js`), mas o modelo às vezes devolve texto puro com quebras de
 * linha. Nesse caso a prévia renderizada aparece como um parágrafo corrido — e
 * é assim que o marketplace vai exibir também, então o certo é avisar, não
 * embelezar escondido.
 */
export function hasBlockHtml(text) {
  return /<\s*(p|div|ul|ol|li|br|table|tr|td|h[1-6])\b[^>]*>/i.test(text ?? '')
}

/** Converte texto puro com quebras de linha em HTML de parágrafos. */
export function plainTextToHtml(text) {
  const escaped = (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\n{2,}/)
    .map((bloco) => `<p>${bloco.replace(/\n/g, '<br>')}</p>`)
    .join('')
}
