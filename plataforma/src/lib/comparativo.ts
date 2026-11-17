import { diasNoMes } from './chamados'

/** Regras do comparativo de chamados (funções puras, testadas em tests/). */
export type Per = 'mes' | 'q1' | 'q2' | `ate${number}`

/** Dia do mês (1–31) de uma data AAAA-MM-DD. */
const diaDe = (ref: string) => +ref.slice(8, 10)
/** O dia pertence ao período? mes = todos · q1 = 1–15 · q2 = 16+ · ateN = 1..N */
export const naPeriodo = (ref: string, p: Per) => p === 'mes' || (p === 'q1' ? diaDe(ref) <= 15 : p === 'q2' ? diaDe(ref) >= 16 : diaDe(ref) <= +p.slice(3))
/** Fração do mês que o período representa (a meta mensal é proporcional ao recorte). */
export const fatorPeriodo = (mes: string, p: Per) => (p === 'mes' ? 1 : p === 'q1' || p === 'q2' ? 0.5 : Math.min(1, +p.slice(3) / diasNoMes(mes)))

export interface Resumo { total: number; pctPrazo: number | null }
export type Veredito = 'melhorou' | 'piorou' | 'misto' | 'estavel' | 'sem_base'
export interface Resultado { veredito: Veredito; varTotal: number; dPrazo: number | null; sTotal: -1 | 0 | 1; sPrazo: -1 | 0 | 1 }

/** Menos chamados = melhor; mais % no prazo = melhor. Diferença < 5% no volume ou < 2 p.p. no prazo conta como estável. */
export function compara(atual: Resumo, base: Resumo): Resultado {
  const varTotal = base.total ? (atual.total - base.total) / base.total : 0
  const dPrazo = atual.pctPrazo !== null && base.pctPrazo !== null ? (atual.pctPrazo - base.pctPrazo) * 100 : null
  const sTotal: -1 | 0 | 1 = Math.abs(varTotal) < 0.05 ? 0 : varTotal < 0 ? 1 : -1
  const sPrazo: -1 | 0 | 1 = dPrazo === null || Math.abs(dPrazo) < 2 ? 0 : dPrazo > 0 ? 1 : -1
  const score = sTotal + sPrazo
  const veredito: Veredito = base.total === 0 ? 'sem_base' : score > 0 ? 'melhorou' : score < 0 ? 'piorou' : sTotal !== 0 ? 'misto' : 'estavel'
  return { veredito, varTotal, dPrazo, sTotal, sPrazo }
}
