/**
 * Medidor de operações do Firestore + disjuntor de indisponibilidade.
 *
 * Existe porque o projeto roda no plano Spark (50k leituras / 20k escritas por dia) e o
 * painel às vezes cai por cota — mas ninguém sabia POR QUAL rota a cota ia embora.
 * Otimizar sem medir é chute; este módulo transforma o chute em número.
 *
 * Duas responsabilidades:
 *
 * 1. CONTAR por rota (leituras, escritas, exclusões), com virada de dia no fuso do
 *    Pacífico — é quando a cota do Firebase realmente reseta, não à meia-noite local.
 *
 * 2. DISJUNTOR: quando vem `RESOURCE_EXHAUSTED`, memorizar que o Firestore está
 *    indisponível por alguns minutos e devolver essa informação imediatamente, sem
 *    tentar de novo.
 *
 * A distinção que sustenta o desenho:
 *   `UNAVAILABLE` / `DEADLINE_EXCEEDED` → transitório, vale uma nova tentativa curta.
 *   `RESOURCE_EXHAUSTED`                → cota diária esgotada. NÃO se resolve com retry:
 *                                          volta na virada do dia. Cada tentativa extra
 *                                          consome mais cota e só atrasa o erro.
 */

const DIA_MS = 24 * 60 * 60 * 1000

/** Códigos gRPC do Firestore que valem nova tentativa. */
const CODIGOS_TRANSITORIOS = new Set([4, 10, 13, 14]) // DEADLINE_EXCEEDED, ABORTED, INTERNAL, UNAVAILABLE
const CODIGO_COTA = 8 // RESOURCE_EXHAUSTED

/** Início do dia corrente no fuso do Pacífico (onde a cota do Firebase vira). */
function chaveDoDiaPacifico(agora = Date.now()) {
  // -08:00 no inverno, -07:00 no verão. A diferença de uma hora não muda a utilidade
  // do contador; o que importa é agrupar pelo mesmo dia em que o Firebase agrupa.
  const offsetPacifico = 8 * 60 * 60 * 1000
  return new Date(agora - offsetPacifico).toISOString().slice(0, 10)
}

class FirestoreMeter {
  constructor({ circuitOpenMs = 5 * 60 * 1000 } = {}) {
    this.circuitOpenMs = circuitOpenMs
    this.dia = chaveDoDiaPacifico()
    this.porRota = new Map()
    this.totais = { reads: 0, writes: 0, deletes: 0 }
    this.quotaErrors = 0
    this.transientErrors = 0
    this.circuitAbertoAte = 0
    this.ultimoErro = null
  }

  _virarDiaSePreciso() {
    const hoje = chaveDoDiaPacifico()
    if (hoje !== this.dia) {
      console.log(`[FirestoreMeter] Virada de dia (${this.dia} → ${hoje}). Totais do dia anterior: ${JSON.stringify(this.totais)}`)
      this.dia = hoje
      this.porRota.clear()
      this.totais = { reads: 0, writes: 0, deletes: 0 }
      this.quotaErrors = 0
      this.transientErrors = 0
      this.circuitAbertoAte = 0
    }
  }

  /**
   * Registra operações. `count` é o número de DOCUMENTOS, não de chamadas: uma query
   * que devolve 58 chunks custa 58 leituras, e é isso que precisa aparecer no contador.
   */
  record(rota, tipo, count = 1) {
    this._virarDiaSePreciso()
    if (!['reads', 'writes', 'deletes'].includes(tipo)) return

    this.totais[tipo] += count

    if (!this.porRota.has(rota)) this.porRota.set(rota, { reads: 0, writes: 0, deletes: 0 })
    this.porRota.get(rota)[tipo] += count
  }

  /** Classifica o erro do Firestore para o chamador decidir o que fazer. */
  classify(err) {
    const codigo = err?.code
    const mensagem = String(err?.message ?? '')

    const ehCota = codigo === CODIGO_COTA || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(mensagem)
    if (ehCota) {
      this._virarDiaSePreciso()
      this.quotaErrors++
      this.ultimoErro = { tipo: 'quota', mensagem, em: new Date().toISOString() }
      this.abrirCircuito()
      return { tipo: 'quota', deveTentarDeNovo: false }
    }

    if (CODIGOS_TRANSITORIOS.has(codigo) || /UNAVAILABLE|DEADLINE_EXCEEDED/i.test(mensagem)) {
      this.transientErrors++
      this.ultimoErro = { tipo: 'transitorio', mensagem, em: new Date().toISOString() }
      return { tipo: 'transitorio', deveTentarDeNovo: true }
    }

    this.ultimoErro = { tipo: 'outro', mensagem, em: new Date().toISOString() }
    return { tipo: 'outro', deveTentarDeNovo: false }
  }

  /**
   * Abre o disjuntor. Evita que cada clique do operador gere nova tentativa durante uma
   * indisponibilidade prolongada — o que enchia o log do PM2 e consumia mais cota.
   */
  abrirCircuito(ms = this.circuitOpenMs) {
    const ate = Date.now() + ms
    if (ate > this.circuitAbertoAte) {
      this.circuitAbertoAte = ate
      console.warn(
        `[FirestoreMeter] Firestore indisponível (cota). Disjuntor aberto por ${Math.round(ms / 1000)}s. Totais do dia: ${JSON.stringify(this.totais)}`
      )
    }
  }

  /** true = não vale a pena tentar agora. */
  circuitoAberto() {
    return Date.now() < this.circuitAbertoAte
  }

  fecharCircuito() {
    this.circuitAbertoAte = 0
  }

  /** Diagnóstico: quem consome a cota, em ordem. */
  stats() {
    this._virarDiaSePreciso()

    const rotas = [...this.porRota.entries()]
      .map(([rota, v]) => ({ rota, ...v, total: v.reads + v.writes + v.deletes }))
      .sort((a, b) => b.total - a.total)

    return {
      dia: this.dia,
      totais: this.totais,
      // Limites do plano Spark, para dar escala ao número.
      limiteSpark: { reads: 50_000, writes: 20_000, deletes: 20_000 },
      percentualUsado: {
        reads: `${((this.totais.reads / 50_000) * 100).toFixed(1)}%`,
        writes: `${((this.totais.writes / 20_000) * 100).toFixed(1)}%`,
        deletes: `${((this.totais.deletes / 20_000) * 100).toFixed(1)}%`,
      },
      erros: { cota: this.quotaErrors, transitorios: this.transientErrors, ultimo: this.ultimoErro },
      disjuntor: this.circuitoAberto()
        ? { aberto: true, reabreEm: `${Math.round((this.circuitAbertoAte - Date.now()) / 1000)}s` }
        : { aberto: false },
      porRota: rotas,
    }
  }

  reset() {
    this.porRota.clear()
    this.totais = { reads: 0, writes: 0, deletes: 0 }
    this.quotaErrors = 0
    this.transientErrors = 0
    this.circuitAbertoAte = 0
    this.ultimoErro = null
  }
}

export const firestoreMeter = new FirestoreMeter()
export default firestoreMeter
