export const STATUS = ['Atrasado', 'Novo Prazo', 'Em andamento', 'A Iniciar', 'Concluído'] as const
export type Status = (typeof STATUS)[number]
/** Cores sólidas (chips, barras) e pastéis (painel escuro, como na planilha de acompanhamento). */
export const STATUS_COLOR: Record<Status, string> = { 'Atrasado': '#dc2626', 'Novo Prazo': '#d97706', 'Em andamento': '#2563eb', 'A Iniciar': '#64748b', 'Concluído': '#16a34a' }
export const STATUS_PASTEL: Record<Status, string> = { 'Atrasado': '#ff8a8a', 'Novo Prazo': '#fde9b0', 'Em andamento': '#aebfe8', 'A Iniciar': '#cbd5e1', 'Concluído': '#b7e1a8' }

export interface Melhoria {
  id: string; modulo: string; melhoria: string; descricao: string | null; descricao_detalhada: string | null
  objetivo: string | null; objetivo_detalhado: string | null; as_is: string | null; to_be: string | null
  prioridade: number; status: Status; percentual_concluido: number; responsavel: string | null
  data_inicio: string | null; data_termino: string | null; observacoes: string | null
  criado_por: string | null; criado_em: string; atualizado_em: string
}
export interface Etapa {
  id: string; melhoria_id: string; ordem: number; como: string; responsavel: string | null
  data_inicio: string | null; data_termino: string | null; novo_prazo: string | null; prazo_realizado: string | null
  percentual_concluido: number; status: Status; observacoes: string | null; criado_em: string; atualizado_em: string
}
export interface Hist {
  id: number; melhoria_id: string; etapa_id: string | null; etapa_nome: string | null; usuario_id: string | null
  campo: string; valor_anterior: string | null; valor_novo: string | null; data_hora: string
}

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000
/** % planejado pelo calendário: parte do período (início→fim) já decorrida hoje. Sem as duas datas → null. */
export function planejadoPct(ini: string | null, fim: string | null, hoje: string): number | null {
  if (!ini || !fim) return null
  const total = dayNum(fim) - dayNum(ini) + 1
  const el = dayNum(hoje) - dayNum(ini) + 1
  return Math.round(Math.max(0, Math.min(1, el / total)) * 100)
}
/** Prazo vigente de uma etapa: o novo prazo, quando existir, senão o término original. */
export const fimEtapa = (e: Pick<Etapa, 'novo_prazo' | 'data_termino'>) => e.novo_prazo || e.data_termino
export const planejadoEtapa = (e: Etapa, hoje: string) => planejadoPct(e.data_inicio, fimEtapa(e), hoje)
export const etapaVencida = (e: Etapa, hoje: string) => { const f = fimEtapa(e); return !!f && f < hoje && e.status !== 'Concluído' }
export const melhoriaVencida = (m: Melhoria, hoje: string) => !!m.data_termino && m.data_termino < hoje && m.status !== 'Concluído'

export interface ItemStat { status: Status; realizado: number; planejado: number | null }
const media = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null)
/** Indicadores do painel: contagem/% por status, realizado, planejado e desempenho (= realizado ÷ planejado, como na planilha). */
export function resumo(items: ItemStat[]) {
  const total = items.length
  const counts = Object.fromEntries(STATUS.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<Status, number>
  const comPlano = items.filter((i) => i.planejado !== null)
  const base = comPlano.length ? comPlano : items
  const realizado = media(base.map((i) => Number(i.realizado)))
  const planejado = comPlano.length ? media(comPlano.map((i) => i.planejado as number)) : null
  const desempenho = realizado !== null && planejado ? realizado / planejado : null
  return { total, counts, realizado, planejado, desempenho, basePlano: comPlano.length }
}
export const fmtDesempenho = (d: number | null) => (d === null ? '—' : d.toFixed(2).replace('.', ','))
