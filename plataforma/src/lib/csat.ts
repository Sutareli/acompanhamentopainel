/** C-SAT Rocco — leitura da exportação de C-SAT do Rocco e do QUADRO (hierarquia), regras de cálculo e agregações (funções puras).
 *  Método: C-SAT = (qtd notas 4 + qtd notas 5) ÷ total de respostas (neutras incluídas no total). */
import { hnorm, parseCsv, parseData } from './chamados'

export type Visao = 'performance' | 'executiva'
export const VISAO_LABEL: Record<Visao, string> = { performance: 'Performance', executiva: 'Executiva' }
export const VISAO_SUB: Record<Visao, string> = { performance: 'respondida pelos operadores', executiva: 'respondida pelos gestores' }

export interface CsatResp { id?: number; chave: string; visao: Visao; data: string; usuario: string | null; pergunta: string | null; nota: number; comentario: string | null; carga_id?: number | null }
export interface QuadroRow { almope: string; nome: string | null; supervisor: string | null; coordenador: string | null; gerente: string | null; site: string | null; cargo: string | null; operacao: string | null }

// ---------------- leitura ----------------
/** Primeira linha que parece cabeçalho (≥ 2 células preenchidas e não numéricas) entre as 15 primeiras. */
export function linhaCabecalho(t: string[][]): number {
  for (let i = 0; i < Math.min(15, t.length); i++) {
    const txt = t[i].filter((c) => c.trim() !== '' && !/^[\d.,/:\- ]+$/.test(c.trim()))
    if (txt.length >= 2) return i
  }
  return 0
}

export const CAMPOS = ['id', 'data', 'usuario', 'nota', 'pergunta', 'comentario', 'visao'] as const
export type Campo = typeof CAMPOS[number]
export const CAMPO_LABEL: Record<Campo, string> = { id: 'ID da resposta (opcional)', data: 'Data da resposta', usuario: 'Usuário (liga com ALMOPE do QUADRO)', nota: 'Nota (1 a 5)', pergunta: 'Pergunta (opcional)', comentario: 'Comentário (opcional)', visao: 'Visão: Performance/Executiva (opcional)' }

const NOMES: Record<Campo, RegExp> = {
  id: /^(id|idresposta|idpesquisa|idavaliacao|protocolo|codigo|cod)$/,
  data: /(^data|^dt|datahora|respondid|criadoem|^dia$|date)/,
  usuario: /(usuario|login|almope|matricula|^user|operador|colaborador)/,
  nota: /(nota|avaliacao|score|csat|satisfacao|^resposta$|rating)/,
  pergunta: /(pergunta|questao|question|criterio|topico)/,
  comentario: /(coment|observ|sugest|justific|feedback|motivo)/,
  visao: /(visao|tipopesquisa|pesquisa|publico|tipo$|perfil)/,
}
const ehNota = (v: string) => /^\s*[1-5]([.,]0+)?\s*$/.test(v)

/** Sugere a coluna de cada campo pelo nome do cabeçalho (e, para a nota, pelo conteúdo). -1 = não encontrada. */
export function sugerirColunas(head: string[], dados: string[][]): Record<Campo, number> {
  const h = head.map(hnorm); const usado = new Set<number>()
  const r = {} as Record<Campo, number>
  const ordem: Campo[] = ['id', 'nota', 'data', 'usuario', 'pergunta', 'comentario', 'visao']
  for (const c of ordem) {
    let i = h.findIndex((x, k) => !usado.has(k) && x !== '' && NOMES[c].test(x))
    if (c === 'nota' && i >= 0 && !conteudoNota(dados, i)) i = -1
    if (c === 'nota' && i < 0) i = h.findIndex((_, k) => !usado.has(k) && conteudoNota(dados, k))
    r[c] = i; if (i >= 0) usado.add(i)
  }
  return r
}
function conteudoNota(dados: string[][], i: number) {
  const v = dados.slice(0, 300).map((l) => (l[i] ?? '').trim()).filter(Boolean)
  return v.length > 0 && v.filter(ehNota).length / v.length >= 0.7
}

/** Texto da coluna de visão → visão. Gestor/Supervisor/Coordenador/Executiva → executiva · Operador/Performance → performance. */
export function visaoDe(v: string | undefined): Visao | null {
  const s = hnorm(v ?? ''); if (!s) return null
  if (/exec|gest|super|coord|geren|lider|diret/.test(s)) return 'executiva'
  if (/perf|oper|atend|agent|analist/.test(s)) return 'performance'
  return null
}

/** Chave estável de uma resposta (para acumular o histórico sem duplicar ao reenviar a mesma base ou bases que se sobrepõem). */
export function chaveDe(p: { id?: string | null; visao: Visao; dataRaw: string; usuario: string | null; pergunta: string | null; nota: number; comentario: string | null }, ocorrencia: number): string {
  if (p.id) return `id:${p.id}|${p.visao}|${(p.pergunta ?? '').toLowerCase()}`
  return [p.visao, p.dataRaw.trim(), (p.usuario ?? '').toLowerCase(), (p.pergunta ?? '').toLowerCase(), p.nota, (p.comentario ?? '').trim().toLowerCase().slice(0, 200), ocorrencia].join('|')
}

/** visaoFixa = toda a base é dessa visão (ignora a coluna) · notasExtras = outras colunas de nota (base “larga”: uma coluna por pergunta; o cabeçalho vira a pergunta). */
export interface Mapa { cols: Record<Campo, number>; visaoFixa: Visao | null; notasExtras?: number[] }
export interface LeituraCsat { rows: CsatResp[]; ignoradas: number; semVisao: number; avisos: string[]; erro: string | null }

const limpo = (s: string | undefined) => { const t = (s ?? '').replace(/​/g, '').trim(); return t === '' ? null : t }

export function montarRespostas(head: string[], dados: string[][], m: Mapa): LeituraCsat {
  const { cols } = m
  const g = (r: string[], c: Campo) => (cols[c] >= 0 ? r[cols[c]] : undefined)
  if (cols.nota < 0) return { rows: [], ignoradas: 0, semVisao: 0, avisos: [], erro: 'Escolha a coluna da nota.' }
  if (cols.data < 0) return { rows: [], ignoradas: 0, semVisao: 0, avisos: [], erro: 'Escolha a coluna da data.' }
  if (!m.visaoFixa && cols.visao < 0) return { rows: [], ignoradas: 0, semVisao: 0, avisos: [], erro: 'Diga se a base é Performance ou Executiva (ou escolha a coluna que indica a visão).' }
  const rows: CsatResp[] = []; const vistos = new Map<string, number>(); let ign = 0, semVisao = 0
  const largas = (m.notasExtras ?? []).filter((i) => i >= 0 && i !== cols.nota)
  const colsNota = [cols.nota, ...largas]
  for (const r of dados) {
    const dRaw = g(r, 'data') ?? ''
    const data = parseData(dRaw)
    const visao = m.visaoFixa ?? visaoDe(g(r, 'visao'))
    for (const cn of colsNota) {
      const nRaw = (r[cn] ?? '').trim()
      if (largas.length && nRaw === '') continue   // base larga: pergunta sem resposta nessa linha
      if (!ehNota(nRaw) || !data) { ign++; continue }
      if (!visao) { semVisao++; continue }
      const nota = Math.round(+nRaw.replace(',', '.'))
      const pergunta = largas.length ? limpo(head[cn]) : limpo(g(r, 'pergunta'))
      const base = { id: limpo(g(r, 'id')), visao, dataRaw: dRaw, usuario: limpo(g(r, 'usuario')), pergunta, nota, comentario: limpo(g(r, 'comentario')) }
      const k0 = chaveDe(base, 0); const oc = (vistos.get(k0) ?? 0) + 1; vistos.set(k0, oc)
      rows.push({ chave: base.id ? (oc > 1 ? `${k0}|${oc}` : k0) : chaveDe(base, oc), visao, data, usuario: base.usuario, pergunta, nota, comentario: base.comentario })
    }
  }
  const avisos: string[] = []
  if (ign) avisos.push(`${ign} linha(s) sem nota de 1 a 5 ou sem data válida foram ignoradas.`)
  if (semVisao) avisos.push(`${semVisao} linha(s) sem visão reconhecida (Performance/Executiva) foram ignoradas.`)
  if (cols.usuario < 0) avisos.push('Sem coluna de usuário: as respostas não terão site, supervisor e nome (ligação com o QUADRO).')
  return { rows, ignoradas: ign, semVisao, avisos, erro: rows.length ? null : 'Nenhuma resposta válida encontrada.' }
}

/** QUADRO: precisa da coluna ALMOPE; as demais são opcionais. */
export function lerQuadro(t: string[][]): { rows: QuadroRow[]; erro: string | null } {
  const hi = linhaCabecalho(t); const head = (t[hi] || []).map(hnorm); const dados = t.slice(hi + 1)
  const ach = (re: RegExp) => head.findIndex((h) => re.test(h))
  const c = { almope: ach(/^(almope|usuario|login)$/), nome: ach(/^(nome|nomecompleto|colaborador|nomecolaborador)$/), supervisor: ach(/supervisor/), coordenador: ach(/coordenador/), gerente: ach(/gerente/), site: ach(/^site/), cargo: ach(/^(cargo|funcao)/), operacao: ach(/(operacao|cliente|celula|ilha)/) }
  if (c.almope < 0) return { rows: [], erro: 'Não encontrei a coluna ALMOPE no QUADRO.' }
  const m = new Map<string, QuadroRow>()
  for (const r of dados) {
    const a = limpo(r[c.almope]); if (!a) continue
    const v = (k: keyof typeof c) => (c[k] >= 0 ? limpo(r[c[k]]) : null)
    m.set(a.toLowerCase(), { almope: a.toLowerCase(), nome: v('nome'), supervisor: v('supervisor'), coordenador: v('coordenador'), gerente: v('gerente'), site: v('site'), cargo: v('cargo'), operacao: v('operacao') })
  }
  return { rows: [...m.values()], erro: m.size ? null : 'O QUADRO não tem linhas com ALMOPE.' }
}

/** Texto CSV → tabela (reaproveita o leitor da base de chamados). */
export const tabelaCsv = (texto: string) => parseCsv(texto)

// ---------------- cálculo ----------------
export interface Kpis { total: number; n1: number; n2: number; n3: number; n4: number; n5: number; satisfeitos: number; neutros: number; insatisfeitos: number; csat: number | null; media: number | null }
export function kpis(rs: { nota: number }[]): Kpis {
  const c = [0, 0, 0, 0, 0, 0]; for (const r of rs) if (r.nota >= 1 && r.nota <= 5) c[r.nota]++
  const total = c[1] + c[2] + c[3] + c[4] + c[5]
  const sat = c[4] + c[5]
  return { total, n1: c[1], n2: c[2], n3: c[3], n4: c[4], n5: c[5], satisfeitos: sat, neutros: c[3], insatisfeitos: c[1] + c[2], csat: total ? (sat / total) * 100 : null, media: total ? (c[1] + 2 * c[2] + 3 * c[3] + 4 * c[4] + 5 * c[5]) / total : null }
}
export const fmtPct = (v: number | null, casas = 1) => (v === null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%')

export interface Grupo { nome: string; k: Kpis; usuarios: number }
/** Agrupa e calcula o C-SAT de cada grupo; ordena por total de respostas (maior → menor). */
export function agrupar<T extends { nota: number; usuario?: string | null }>(rs: T[], f: (r: T) => string | null, vazio = '(sem informação)'): Grupo[] {
  const m = new Map<string, { nome: string; itens: T[] }>()
  for (const r of rs) { const v = (f(r) ?? '').trim() || vazio; const k = v.toLowerCase(); const g = m.get(k); if (g) g.itens.push(r); else m.set(k, { nome: v, itens: [r] }) }
  return [...m.values()].map((g) => ({ nome: g.nome, k: kpis(g.itens), usuarios: new Set(g.itens.map((x) => (x.usuario ?? '').toLowerCase()).filter(Boolean)).size })).sort((a, b) => b.k.total - a.k.total || a.nome.localeCompare(b.nome, 'pt-BR'))
}
export const mesDe = (d: string) => d.slice(0, 7)
