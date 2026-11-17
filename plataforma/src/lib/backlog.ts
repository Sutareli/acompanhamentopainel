export const STATUS = ['Atrasado', 'Novo Prazo', 'Em andamento', 'A Iniciar', 'Concluído'] as const
export type Status = (typeof STATUS)[number]
/** Cores sólidas (chips, barras) e pastéis (painel escuro, como na planilha de acompanhamento). */
export const STATUS_COLOR: Record<Status, string> = { 'Atrasado': '#dc2626', 'Novo Prazo': '#d97706', 'Em andamento': '#2563eb', 'A Iniciar': '#64748b', 'Concluído': '#16a34a' }
export const STATUS_PASTEL: Record<Status, string> = { 'Atrasado': '#ff8a8a', 'Novo Prazo': '#fde9b0', 'Em andamento': '#aebfe8', 'A Iniciar': '#cbd5e1', 'Concluído': '#b7e1a8' }

export interface Melhoria {
  id: string; modulo: string; melhoria: string; descricao: string | null; descricao_detalhada: string | null
  objetivo: string | null; objetivo_detalhado: string | null; as_is: string | null; to_be: string | null
  prioridade: number; status: Status; percentual_concluido: number; responsavel: string | null
  data_inicio: string | null; data_termino: string | null; data_conclusao?: string | null; observacoes: string | null
  criado_por: string | null; criado_em: string; atualizado_em: string
  origem?: 'manual' | 'chamado'; chamado_chave?: string | null; chamado_status?: string | null
  tipo_backlog?: 'melhoria' | 'correcao'; codigo_base?: number | null; ordem_top?: number | null
  fase?: Fase; data_ideia?: string | null; data_priorizacao?: string | null; data_especificacao?: string | null; data_abertura?: string | null
  data_homologacao?: string | null; numero_chamado?: string | null; responsavel_id?: string | null; sla_chamado_dias_uteis?: number | null; sla_dev_dias_corridos?: number | null
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


/** Funil do processo de MELHORIAS (7 etapas): Ideia → Priorização → Especificação → Chamado aberto → Desenvolvimento → Homologação → Produção. */
export const FASES = ['ideia', 'priorizada', 'especificacao', 'chamado_aberto', 'em_desenvolvimento', 'homologacao', 'producao'] as const
export type Fase = (typeof FASES)[number]
export interface FaseInfo { k: Fase; label: string; curto: string; icon: string; cor: string; campo: 'data_ideia' | 'data_priorizacao' | 'data_especificacao' | 'data_abertura' | 'data_inicio' | 'data_homologacao' | 'data_conclusao'; dataLabel: string; ajuda: string }
export const FASE_INFO: FaseInfo[] = [
  { k: 'ideia', label: 'Ideia', curto: 'Ideia', icon: '💡', cor: '#64748b', campo: 'data_ideia', dataLabel: 'Ideia registrada em', ajuda: 'Ideia pensada e alocada no painel, aguardando a reunião semanal.' },
  { k: 'priorizada', label: 'Priorização', curto: 'Priorização', icon: '🗳️', cor: '#7c3aed', campo: 'data_priorizacao', dataLabel: 'Priorizada em reunião em', ajuda: 'Debatida na reunião semanal: criticidade e prioridade definidas.' },
  { k: 'especificacao', label: 'Especificação', curto: 'Especif.', icon: '📝', cor: '#db2777', campo: 'data_especificacao', dataLabel: 'Especificação concluída em', ajuda: 'Escopo e regras da melhoria sendo especificados para o chamado.' },
  { k: 'chamado_aberto', label: 'Chamado aberto', curto: 'Chamado', icon: '🎫', cor: '#0891b2', campo: 'data_abertura', dataLabel: 'Chamado aberto em', ajuda: 'Chamado aberto conforme a criticidade, aguardando o desenvolvimento.' },
  { k: 'em_desenvolvimento', label: 'Desenvolvimento', curto: 'Desenv.', icon: '🛠️', cor: '#2563eb', campo: 'data_inicio', dataLabel: 'Desenvolvimento iniciado em', ajuda: 'Em desenvolvimento: acompanhar prazo, andamento e etapas.' },
  { k: 'homologacao', label: 'Homologação', curto: 'Homolog.', icon: '🧪', cor: '#d97706', campo: 'data_homologacao', dataLabel: 'Entrou em homologação em', ajuda: 'Desenvolvimento entregue: validação (homologação) antes de ir para produção.' },
  { k: 'producao', label: 'Produção', curto: 'Produção', icon: '✅', cor: '#16a34a', campo: 'data_conclusao', dataLabel: 'Entrou em produção em', ajuda: 'Melhoria em produção (concluída).' },
]
export const faseInfo = (k?: string | null) => FASE_INFO.find((f) => f.k === k) || FASE_INFO[0]
export const faseIdx = (k?: string | null) => Math.max(0, FASES.indexOf((k || 'ideia') as Fase))
/** Andamento da melhoria = posição na etapa do funil: Ideia 0% · Priorização 17% · Especificação 33% · Chamado aberto 50% · Desenvolvimento 67% · Homologação 83% · Produção 100%. */
export const pctDaFase = (k?: string | null) => Math.round((faseIdx(k) * 100) / (FASES.length - 1))
export const faseDe = (m: Pick<Melhoria, 'fase' | 'status'>): Fase => (m.fase as Fase) || (m.status === 'Concluído' ? 'producao' : m.status === 'A Iniciar' ? 'ideia' : 'em_desenvolvimento')
/** Etapas em que a melhoria está "em andamento" do lado do desenvolvimento. */
export const emDev = (k: Fase) => k === 'em_desenvolvimento' || k === 'homologacao'
/** Prazo de entrega vencido (a melhoria ainda não está em produção). */
export const vencida = (m: Melhoria, hoje: string) => !!m.data_termino && m.data_termino < hoje && faseDe(m) !== 'producao'
export const dataDaFase = (m: Melhoria, k: Fase): string | null => (k === 'producao' && faseDe(m) !== 'producao' ? null : (m[faseInfo(k).campo] as string | null | undefined) || null)
/** Quantos dias (corridos) entre duas datas aaaa-mm-dd. */
export const diasEntre = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a))
