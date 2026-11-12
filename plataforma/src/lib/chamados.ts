/** Base de chamados do "Pareto backlog": leitura do CSV da planilha, normalização e agregações (funções puras). */
export interface Chamado {
  id: string; id_chamado: string | null; data_identificacao: string | null; data_ref: string
  categoria: string | null; subcategoria: string | null; tipo: string | null; item_sintoma: string | null
  sistema_ofensor: string | null; cliente: string | null; site: string | null; status: string | null; prazo: string | null
  responsavel: string | null; empresa_responsavel: string | null; responsavel_rocco: string | null; fase: string | null
}
export type ChamadoImport = Omit<Chamado, 'id'>

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const mesKey = (d: string) => d.slice(0, 7)
export const mesLabel = (k: string) => `${MESES[+k.slice(5, 7) - 1]}/${k.slice(2, 4)}`
export const mesAnterior = (k: string) => { const y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
export const diasNoMes = (k: string) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate()

/** Quinzena do dia de referência: 1 = dias 1 a 15 · 2 = dia 16 até o fim do mês. */
export const quinzenaDe = (ref: string) => (+ref.slice(8, 10) <= 15 ? 1 : 2)
/** Semanas do mês (segunda a domingo; a 1ª e a última podem ser parciais). */
export function semanasDoMes(mes: string) {
  const dim = diasNoMes(mes), pri = (new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1, 1)).getUTCDay() + 6) % 7 // 0 = segunda
  const n = Math.floor((dim - 1 + pri) / 7) + 1
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, ini: Math.max(1, i * 7 - pri + 1), fim: Math.min(dim, (i + 1) * 7 - pri) }))
}
export const semanaDe = (ref: string) => {
  const pri = (new Date(Date.UTC(+ref.slice(0, 4), +ref.slice(5, 7) - 1, 1)).getUTCDay() + 6) % 7
  return Math.floor((+ref.slice(8, 10) - 1 + pri) / 7) + 1
}

// ---------------- CSV ----------------
/** Lê CSV (separador , ; ou tab detectado na 1ª linha; aspas duplas; quebras de linha dentro de aspas). */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const first = text.split(/\r?\n/, 1)[0] || ''
  let inQ = false; const cnt: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in cnt) cnt[ch]++ }
  const delim = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []; let row: string[] = [], f = ''; inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else inQ = false } else f += c
    } else if (c === '"') inQ = true
    else if (c === delim) { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = [] }
    else f += c
  }
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export const hnorm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const clean = (s: string | undefined) => { const t = (s ?? '').replace(/​/g, '').trim(); return t === '' ? null : t }

/** dd/mm/aaaa, aaaa-mm-dd (com ou sem hora) ou número de série do Excel → aaaa-mm-dd. */
export function parseData(v: string | undefined): string | null {
  const s = (v ?? '').trim(); if (!s) return null
  let y: number, m: number, d: number, r: RegExpMatchArray | null
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +r[1]; m = +r[2]; d = +r[3] }
  else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000 }
  else if (/^\d{5}(\.\d+)?$/.test(s)) { const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate() }
  else return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const mesNum = (v: string | undefined): number | null => {
  const s = hnorm(v ?? ''); if (!s) return null
  if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 12) return +s
  const i = MESES.findIndex((m) => m.toLowerCase() === s); if (i >= 0) return i + 1
  const j = MESES_LONGOS.indexOf(s); return j >= 0 ? j + 1 : null
}
/** Tipos em CAIXA ALTA ("CONFIGURAÇÃO") viram "Configuração", para somar com a grafia normal. */
const tipoNorm = (t: string | null) => (t && t.length > 1 && t === t.toLocaleUpperCase('pt-BR') ? t.charAt(0) + t.slice(1).toLocaleLowerCase('pt-BR') : t)

export interface Leitura { rows: ChamadoImport[]; ignoradas: number; avisos: string[]; erro: string | null }
/** Converte a aba "base" exportada em CSV (cabeçalhos originais) nas linhas da tabela backlog_chamados. */
export function lerBase(text: string): Leitura {
  const t = parseCsv(text)
  if (t.length < 2) return { rows: [], ignoradas: 0, avisos: [], erro: 'O arquivo está vazio ou sem linhas de dados.' }
  const idx: Record<string, number> = {}
  t[0].forEach((h, i) => { const k = hnorm(h); if (k && !(k in idx)) idx[k] = i })
  const g = (r: string[], k: string) => (k in idx ? r[idx[k]] : undefined)
  if (!('dataidentificacao' in idx) && !('mesref' in idx)) return { rows: [], ignoradas: 0, avisos: [], erro: 'Não encontrei as colunas "DATA IDENTIFICAÇÃO" ou "MÊS_REF". Exporte a aba "base" com a linha de cabeçalhos original.' }
  const faltam = ['categoria', 'subcategoria', 'tipo', 'tratadodentrodoprazo'].filter((k) => !(k in idx))
  const rows: ChamadoImport[] = []; let ignoradas = 0; let semRef = 0
  for (const r of t.slice(1)) {
    const ident = parseData(g(r, 'dataidentificacao'))
    let ref: string | null = null
    const mm = mesNum(g(r, 'mesref')), dd = +(g(r, 'dia') || 0)
    if (mm && dd >= 1) {
      const ano = +(clean(g(r, 'anoref')) || (ident ? ident.slice(0, 4) : 0))
      if (ano && dd <= diasNoMes(`${ano}-${String(mm).padStart(2, '0')}`)) ref = `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
    if (!ref) { ref = ident; if (ident && mm) semRef++ }
    if (!ref) { ignoradas++; continue }
    const prazoRaw = (clean(g(r, 'tratadodentrodoprazo')) || '').toLowerCase()
    rows.push({
      id_chamado: clean(g(r, 'id')), data_identificacao: ident, data_ref: ref,
      categoria: clean(g(r, 'categoria')), subcategoria: clean(g(r, 'subcategoria')), tipo: tipoNorm(clean(g(r, 'tipo'))),
      item_sintoma: clean(g(r, 'itemsintoma')), sistema_ofensor: clean(g(r, 'sistemaofensor')), cliente: clean(g(r, 'cliente')),
      site: clean(g(r, 'site')), status: clean(g(r, 'status')),
      responsavel: clean(g(r, 'responsavel')), empresa_responsavel: clean(g(r, 'empresaresponsavel')), responsavel_rocco: clean(g(r, 'responsavelrocco')), fase: clean(g(r, 'fase')),
      prazo: prazoRaw === 'dentro do prazo' ? 'Dentro do prazo' : prazoRaw === 'fora do prazo' ? 'Fora do prazo' : null,
    })
  }
  const avisos: string[] = []
  const semResp = ['responsavel', 'empresaresponsavel', 'responsavelrocco'].filter((k) => !(k in idx))
  if (semResp.length) avisos.push('Sem as colunas de responsável (' + semResp.join(', ') + '): o detalhamento “Quem é responsável” ficará incompleto. Use o CSV com RESPONSÁVEL, EMPRESA RESPONSÁVEL e RESPONSÁVEL ROCCO.')
  if (faltam.length) avisos.push('Colunas não encontradas (ficarão vazias): ' + faltam.join(', ') + '.')
  if (ignoradas) avisos.push(`${ignoradas} linha(s) sem data válida foram ignoradas.`)
  if (semRef) avisos.push(`${semRef} linha(s) com MÊS_REF/DIA inválidos usaram a data de identificação.`)
  return { rows, ignoradas, avisos, erro: rows.length ? null : 'Nenhuma linha com data válida foi encontrada.' }
}

// ---------------- agregações ----------------
export const noPrazo = (c: Chamado) => (c.prazo || '').trim().toLowerCase() === 'dentro do prazo'
const k = (s: string | null) => (s ?? '').trim().toLowerCase()
export interface Barra { nome: string; qtd: number }
/** Contagem por rótulo (sem diferenciar maiúsculas), maior → menor; vazios vão para `vazios`. */
export function contar(items: Chamado[], f: (c: Chamado) => string | null): { barras: Barra[]; vazios: number } {
  const m = new Map<string, Barra>(); let vazios = 0
  for (const c of items) {
    const v = f(c); if (!v || !v.trim()) { vazios++; continue }
    const key = k(v); const b = m.get(key)
    if (b) b.qtd++; else m.set(key, { nome: v.trim(), qtd: 1 })
  }
  return { barras: [...m.values()].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR')), vazios }
}
/** Pareto: barras já ordenadas + % acumulado sobre o total das barras. */
export function pareto(barras: Barra[]) {
  const total = barras.reduce((a, b) => a + b.qtd, 0); let ac = 0
  return barras.map((b) => { ac += b.qtd; return { ...b, pct: total ? (b.qtd / total) * 100 : 0, acum: total ? (ac / total) * 100 : 0 } })
}
export function porDia(items: Chamado[], mes: string): number[] {
  const a = new Array(diasNoMes(mes)).fill(0)
  for (const c of items) if (mesKey(c.data_ref) === mes) a[+c.data_ref.slice(8, 10) - 1]++
  return a
}
export interface KpiMes { total: number; noPrazo: number; pctPrazo: number | null; tipos: number; subcategorias: number }
export function kpis(items: Chamado[]): KpiMes {
  const total = items.length, np = items.filter(noPrazo).length
  return { total, noPrazo: np, pctPrazo: total ? np / total : null, tipos: contar(items, (c) => c.tipo).barras.length, subcategorias: contar(items, (c) => c.subcategoria).barras.length }
}

// ---------------- responsabilidade e chamados abertos ----------------
/** Chamado aberto = ainda sem desfecho: A iniciar, Em andamento ou Suspenso (fora: Concluído, Cancelado e Improcedente). */
export const aberto = (c: Chamado) => !!(c.status || '').trim() && !/conclu|cancel|improced/i.test(c.status || '')
export const statusNome = (c: Chamado) => (c.status || '').replace(/^\s*\d+\s*-\s*/, '').trim() || '—'
export const SEM_RESP = '(não informado)'
export const empresaDe = (c: Chamado) => (c.empresa_responsavel || '').trim() || SEM_RESP
export const respDe = (c: Chamado) => (c.responsavel || '').trim() || SEM_RESP
export const roccoDe = (c: Chamado) => (c.responsavel_rocco || '').trim() || SEM_RESP
export function diasEmAberto(c: Chamado, hoje: string): number {
  const d = c.data_identificacao || c.data_ref
  return Math.max(0, Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 86400000))
}
export interface Grupo { nome: string; total: number; abertos: number; noPrazo: number; comPrazo: number }
/** Agrupa por chave e devolve total, abertos e % no prazo (ordenado do maior para o menor total). */
export function agrupar(items: Chamado[], chave: (c: Chamado) => string): Grupo[] {
  const m = new Map<string, Grupo>()
  for (const c of items) {
    const k = chave(c); const g = m.get(k) || { nome: k, total: 0, abertos: 0, noPrazo: 0, comPrazo: 0 }
    g.total++; if (aberto(c)) g.abertos++
    if (c.prazo) { g.comPrazo++; if (noPrazo(c)) g.noPrazo++ }
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome))
}
