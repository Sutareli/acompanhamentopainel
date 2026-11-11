/** Regras de negócio e utilitários puros (sem acesso a rede). */

export const TZ = 'America/Fortaleza'

export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
export const fmtDate = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
export const fmtMin = (m: number) => {
  const a = Math.abs(Math.round(m))
  const h = Math.floor(a / 60)
  return (m < 0 ? '−' : '') + (h ? h + 'h ' : '') + (a % 60) + 'min'
}
export const fmtSec = (s: number) => {
  s = Math.max(0, Math.round(s))
  return Math.floor(s / 3600) + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

/** Lança erro legível quando a chamada ao Supabase falha. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chk(r: { data: any; error: any }): any {
  if (r.error) throw new Error(r.error.message || 'Erro de comunicação com o banco de dados.')
  return r.data
}

export type Crit = 'alta' | 'media' | 'baixa'
export type StatusGeral = 'a_iniciar' | 'em_andamento' | 'concluido' | 'concluido_parcial' | 'cancelado'
export type Perfil = 'chefe_do_chefe' | 'chefe' | 'gestor' | 'analista' | 'guardiao'
export const PERFIL_LABEL: Record<Perfil, string> = { chefe_do_chefe: 'Chefe do chefe', chefe: 'Chefe', gestor: 'Gestor', analista: 'Analista', guardiao: 'Guardião' }
export const PERFIS = Object.keys(PERFIL_LABEL) as Perfil[]
/** Quem pode CONSULTAR as jornadas de todos (somente leitura). Espelha is_viewer_all() no banco. */
export const canViewAll = (p?: Perfil) => p === 'chefe_do_chefe' || p === 'chefe' || p === 'gestor'
export const CRIT_LABEL: Record<Crit, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
export const CRIT_COLOR: Record<Crit, string> = { alta: '#dc2626', media: '#f59e0b', baixa: '#3b82f6' }
export const STATUS_LABEL: Record<StatusGeral, string> = { a_iniciar: 'A iniciar', em_andamento: 'Em andamento', concluido: 'Concluído', concluido_parcial: 'Concluído c/ cancelamentos', cancelado: 'Cancelado' }
export const STATUS_COLOR: Record<StatusGeral, string> = { a_iniciar: '#94a3b8', em_andamento: '#2563eb', concluido: '#16a34a', concluido_parcial: '#0d9488', cancelado: '#f87171' }

export interface Micro {
  id: string; criticidade: Crit; responsavel_id: string; responsavel_nome: string; criado_por: string
  demanda: string; resumo: string | null; data_target: string; quantidade: number
  a_iniciar: number; em_andamento: number; concluido: number; cancelado: number
  observacoes: string | null; criado_em: string; atualizado_em: string; mes_referencia: string
  status_geral: StatusGeral; atrasada: boolean; pct_conclusao: number | null
}

export interface MicroInput {
  demanda: string; responsavel_id: string; data_target: string
  quantidade: number; a_iniciar: number; em_andamento: number; concluido: number; cancelado: number
}

/** Valida o formulário antes de enviar. O banco valida de novo (CHECK soma_confere). */
export function validateMicro(f: MicroInput): string | null {
  if (!f.demanda.trim()) return 'Informe a demanda.'
  if (!f.responsavel_id) return 'Selecione o responsável.'
  if (!f.data_target) return 'Informe a Data Target.'
  const n = [f.quantidade, f.a_iniciar, f.em_andamento, f.concluido, f.cancelado]
  if (n.some((x) => !Number.isInteger(x) || x < 0)) return 'As quantidades devem ser números inteiros, sem valores negativos.'
  if (f.quantidade < 1) return 'A quantidade total deve ser de pelo menos 1.'
  const s = f.a_iniciar + f.em_andamento + f.concluido + f.cancelado
  if (s > f.quantidade) return `A soma dos status (${s}) ultrapassa a quantidade total (${f.quantidade}).`
  if (s < f.quantidade) return `A soma dos status (${s}) é menor que a quantidade total (${f.quantidade}). Distribua todas as unidades.`
  return null
}

/**
 * Status geral — espelho exato de md_status() no banco (a fonte da verdade é o banco; isto serve à prévia do formulário).
 * cancelado: todas canceladas · concluido: todas concluídas (cancelamento parcial NUNCA conclui) ·
 * concluido_parcial: nada pendente/em andamento, com concluídas e canceladas · a_iniciar: nada iniciado/concluído ·
 * em_andamento: qualquer outra combinação.
 */
export function statusGeral(a: number, e: number, c: number, x: number, q: number): StatusGeral {
  if (x === q) return 'cancelado'
  if (c === q) return 'concluido'
  if (a === 0 && e === 0) return 'concluido_parcial'
  if (e === 0 && c === 0) return 'a_iniciar'
  return 'em_andamento'
}

/** Distribuição textual quando há combinação de situações. */
export function distribuicao(m: Pick<Micro, 'a_iniciar' | 'em_andamento' | 'concluido' | 'cancelado'>): string {
  const p: string[] = []
  if (m.a_iniciar) p.push(`${m.a_iniciar} a iniciar`)
  if (m.em_andamento) p.push(`${m.em_andamento} em andamento`)
  if (m.concluido) p.push(`${m.concluido} concluído${m.concluido > 1 ? 's' : ''}`)
  if (m.cancelado) p.push(`${m.cancelado} cancelado${m.cancelado > 1 ? 's' : ''}`)
  return p.join(' · ')
}

export const BLOCK_COLORS = ['#12295a', '#0e7490', '#7c3aed', '#ea580c', '#0f766e']
export const BLOCK_ICONS = ['🌅', '✉️', '🔎', '💡', '✅']

const G1 = '3.1 Validação da ferramenta — 30 min'
const G2 = '3.2 Acompanhamento dos analistas — 30 min'
export const DEFAULT_BLOCKS: { nome: string; min: number; objetivo: string; tasks: { descricao: string; grupo?: string }[] }[] = [
  { nome: 'Início do dia', min: 60, objetivo: 'Preparar o dia e identificar prioridades.', tasks: [
    'Validar urgências com os analistas', 'Consultar agenda do Microsoft Teams', 'Identificar reuniões próximas ou longas',
    'Identificar oportunidades de atuação imediata', 'Organizar a mesa', 'Abrir e organizar e-mails', 'Preparar ferramentas de trabalho',
  ].map((descricao) => ({ descricao })) },
  { nome: 'Leitura e ajustes', min: 60, objetivo: 'Organizar comunicações e questões administrativas.', tasks: [
    'Ler e-mails', 'Identificar demandas urgentes', 'Responder e-mails necessários', 'Direcionar demandas para as filas',
    'Ajustar ponto dos analistas', 'Ajustar o próprio ponto',
  ].map((descricao) => ({ descricao })) },
  { nome: 'Validação e acompanhamento', min: 60, objetivo: 'Validar a ferramenta ROCCO e acompanhar os analistas.', tasks: [
    ...['Avaliar qualitativamente a ferramenta ROCCO', 'Identificar falhas', 'Identificar inconsistências', 'Registrar oportunidades de melhoria', 'Registrar ideias de correção'].map((descricao) => ({ descricao, grupo: G1 })),
    ...['Consultar base de microatividades', 'Verificar atividades realizadas', 'Identificar pendências', 'Avaliar andamento das demandas', 'Registrar oportunidades de orientação'].map((descricao) => ({ descricao, grupo: G2 })),
  ] },
  { nome: 'Criação e inovação', min: 60, objetivo: 'Transformar ideias em entregas.', tasks: [
    'Criar planilhas', 'Desenvolver apresentações', 'Criar imagens e materiais visuais', 'Construir ferramentas',
    'Desenvolver melhorias', 'Executar ideias registradas no bloco 3',
  ].map((descricao) => ({ descricao })) },
  { nome: 'Validação final', min: 60, objetivo: 'Fechar o ciclo de trabalho.', tasks: [
    'Conferir pendências', 'Verificar solicitações da liderança', 'Identificar atrasos', 'Fazer correções', 'Revisar entregas', 'Registrar próximos passos',
  ].map((descricao) => ({ descricao })) },
]

/** CSV com ';' e BOM UTF-8: abre corretamente no Excel em português. */
export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => {
    const s = String(c ?? '')
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(';')).join('\r\n')
}

export function download(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: mime }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
