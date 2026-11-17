import { faseDe, Melhoria } from './backlog'

/** SLA das etapas de Melhorias. Cada melhoria tem o seu (colunas sla_* em backlog_melhorias), editável só por Analista Sr e Gerente. */
export interface SlaCfg { chamado_dias_uteis: number; dev_dias_corridos: number }
export const SLA_PADRAO: SlaCfg = { chamado_dias_uteis: 3, dev_dias_corridos: 15 }
/** SLA da melhoria (padrão 3 dias úteis / 15 corridos quando não definido). */
export const cfgDe = (m: Pick<Melhoria, 'sla_chamado_dias_uteis' | 'sla_dev_dias_corridos'>): SlaCfg => ({ chamado_dias_uteis: m.sla_chamado_dias_uteis ?? SLA_PADRAO.chamado_dias_uteis, dev_dias_corridos: m.sla_dev_dias_corridos ?? SLA_PADRAO.dev_dias_corridos })
export const podeAjustarSla = (p?: string) => p === 'analista_sr' || p === 'gerente'

const dn = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000
const str = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10)
/** Feriados (datas AAAA-MM-DD) descontados dos dias úteis. Carregados da tabela `feriados` (veja useFeriados); ficam vazios nos testes. */
let FERIADOS = new Set<string>()
export const setFeriados = (datas: string[]) => { FERIADOS = new Set(datas) }
const util = (n: number) => { const w = new Date(n * 86400000).getUTCDay(); return w !== 0 && w !== 6 && !FERIADOS.has(str(n)) }

/** Soma N dias úteis (segunda a sexta, sem os feriados cadastrados). A data inicial não conta. */
export function somaDiasUteis(ini: string, n: number): string {
  let d = dn(ini), k = 0
  while (k < n) { d += 1; if (util(d)) k++ }
  return str(d)
}
export const somaDias = (ini: string, n: number) => str(dn(ini) + n)
/** Dias úteis entre a (exclusive) e b (inclusive); negativo se b < a. */
export function diasUteisEntre(a: string, b: string): number {
  if (a === b) return 0
  const s = a < b ? 1 : -1; let d = dn(a), k = 0; const f = dn(b)
  while (d !== f) { d += s; if (util(d)) k += s }
  return k
}

export type SlaEtapa = 'chamado_aberto' | 'em_desenvolvimento'
export interface Sla {
  etapa: SlaEtapa; inicio: string; venc: string
  estado: 'no_prazo' | 'vence_hoje' | 'atrasado'
  /** dias restantes (≥0) ou de atraso (>0, quando atrasado), na unidade do SLA */
  n: number
  unidade: 'úteis' | 'corridos'
  txt: string; cor: string; regra: string
}
const regraDe = (e: SlaEtapa, c: SlaCfg) => e === 'chamado_aberto' ? `${c.chamado_dias_uteis} dias úteis para iniciar o desenvolvimento` : `${c.dev_dias_corridos} dias corridos para entrar em homologação`
const plural = (n: number, u: string) => `${n} dia${n === 1 ? '' : 's'} ${u === 'úteis' ? (n === 1 ? 'útil' : 'úteis') : (n === 1 ? 'corrido' : 'corridos')}`

/** Vencimento do SLA da etapa. */
export function vencSla(etapa: SlaEtapa, inicio: string, c: SlaCfg) {
  return etapa === 'chamado_aberto' ? somaDiasUteis(inicio, c.chamado_dias_uteis) : somaDias(inicio, c.dev_dias_corridos)
}

/** SLA da etapa ATUAL da melhoria (só Chamado aberto e Desenvolvimento têm SLA). null se não se aplica. */
export function slaAtual(m: Melhoria, hoje: string): Sla | null {
  const c = cfgDe(m)
  const f = faseDe(m)
  if (f !== 'chamado_aberto' && f !== 'em_desenvolvimento') return null
  const inicio = f === 'chamado_aberto' ? m.data_abertura : m.data_inicio
  if (!inicio) return null
  const venc = vencSla(f, inicio, c)
  const un = f === 'chamado_aberto' ? 'úteis' as const : 'corridos' as const
  const falta = f === 'chamado_aberto' ? diasUteisEntre(hoje, venc) : Math.round(dn(venc) - dn(hoje))
  const regra = regraDe(f, c)
  if (hoje > venc) {
    const n = f === 'chamado_aberto' ? diasUteisEntre(venc, hoje) : Math.round(dn(hoje) - dn(venc))
    return { etapa: f, inicio, venc, estado: 'atrasado', n, unidade: un, txt: `SLA vencido há ${plural(Math.max(1, n), un)}`, cor: '#dc2626', regra }
  }
  if (hoje === venc) return { etapa: f, inicio, venc, estado: 'vence_hoje', n: 0, unidade: un, txt: 'SLA vence hoje', cor: '#d97706', regra }
  return { etapa: f, inicio, venc, estado: 'no_prazo', n: falta, unidade: un, txt: `SLA: ${plural(falta, un)} restante${falta === 1 ? '' : 's'}`, cor: falta <= 1 ? '#d97706' : '#16a34a', regra }
}
export const slaAtrasado = (m: Melhoria, hoje: string) => slaAtual(m, hoje)?.estado === 'atrasado'

/** Transições JÁ realizadas: cumpriu o SLA? (para o indicador de cumprimento na visão gerencial) */
export function slaCumprido(m: Melhoria, etapa: SlaEtapa): boolean | null {
  const c = cfgDe(m)
  const ini = etapa === 'chamado_aberto' ? m.data_abertura : m.data_inicio
  const fim = etapa === 'chamado_aberto' ? m.data_inicio : m.data_homologacao
  if (!ini || !fim) return null
  return fim <= vencSla(etapa, ini, c)
}
