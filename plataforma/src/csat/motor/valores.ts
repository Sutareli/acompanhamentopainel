/** Tipos e regras de comparação/conversão do Excel (com a conversão número→texto do Excel em português: vírgula decimal). */
export class XErr { constructor(public code: string) {} toString() { return this.code } }
export const NA = new XErr('#N/A'), VALUE = new XErr('#VALUE!'), REF = new XErr('#REF!'), DIV0 = new XErr('#DIV/0!'), NUM = new XErr('#NUM!'), NAME = new XErr('#NAME?')
export type Esc = number | string | boolean | XErr | null   // null = célula vazia
export interface Ref { kind: 'ref'; sheet: string; r1: number; c1: number; r2: number; c2: number }
export type Mat = Esc[][]
export type Val = Esc | Ref | Mat
export const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && (v as Ref).kind === 'ref'
export const isMat = (v: unknown): v is Mat => Array.isArray(v)
export const isErr = (v: unknown): v is XErr => v instanceof XErr
export const mkRef = (sheet: string, r1: number, c1: number, r2 = r1, c2 = c1): Ref => ({ kind: 'ref', sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) })

/** Número → texto como o Excel em pt-BR (formato Geral: até 15 dígitos significativos, vírgula decimal). */
export function numTexto(n: number): string {
  if (!isFinite(n)) return '#NUM!'
  if (n === 0) return '0'
  const a = Math.abs(n)
  let s: string
  if (a >= 1e15 || a < 1e-9) { s = n.toExponential(9).replace(/\.?0+e/, 'E').replace('e', 'E'); const m = s.match(/E([+-])(\d+)$/); if (m) s = s.replace(/E[+-]\d+$/, 'E' + m[1] + m[2].padStart(2, '0')) }
  else { s = String(+n.toPrecision(15)); if (/e/i.test(s)) s = Number(s).toFixed(20).replace(/0+$/, '').replace(/\.$/, '') }
  return s.replace('.', ',')
}
export function toStr(v: Esc): string | XErr {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return numTexto(v)
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO'
  return v
}
/** Texto numérico → número (aceita vírgula ou ponto decimal, como VALUE em pt-BR, e datas dd/mm/aaaa). */
export function parseNum(s: string): number | null {
  const t = s.trim(); if (t === '') return null
  if (/^[+-]?\d+([.,]\d+)?([eE][+-]?\d+)?%?$/.test(t)) { const pct = t.endsWith('%'); const n = Number(t.replace('%', '').replace(',', '.')); return pct ? n / 100 : n }
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  const d = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (d) { const s0 = serialDe(+d[3], +d[2], +d[1]); if (s0 === null) return null; return s0 + ((+(d[4] || 0)) * 3600 + (+(d[5] || 0)) * 60 + (+(d[6] || 0))) / 86400 }
  return null
}
export function toNum(v: Esc): number | XErr {
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') { const n = parseNum(v); return n === null ? VALUE : n }
  return v
}
export function toBool(v: Esc): boolean | XErr {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') { const u = v.toUpperCase(); if (u === 'TRUE' || u === 'VERDADEIRO') return true; if (u === 'FALSE' || u === 'FALSO') return false; return VALUE }
  return v
}
const tipoOrd = (v: Esc) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0)
/** Comparação do Excel: números < textos < lógicos; textos sem diferenciar maiúsculas. Vazio vale 0 ou "" conforme o outro lado. */
export function cmp(a: Esc, b: Esc): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const ta = tipoOrd(a), tb = tipoOrd(b)
  if (ta !== tb) return ta - tb
  if (typeof a === 'number') return a < (b as number) ? -1 : a > (b as number) ? 1 : 0
  if (typeof a === 'string') { const x = a.toLowerCase(), y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 }
  return (a ? 1 : 0) - (b ? 1 : 0)
}

// ---------- datas (número de série do Excel, sistema 1900) ----------
const DIA_MS = 86400000, BASE = Date.UTC(1899, 11, 30)
export function serialDe(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d); if (isNaN(t)) return null
  return Math.round((t - BASE) / DIA_MS)
}
export function dataDe(serial: number): { y: number; m: number; d: number; wd: number; H: number; M: number; S: number } {
  const dias = Math.floor(serial); const frac = serial - dias
  const t = new Date(BASE + dias * DIA_MS)
  let secs = Math.round(frac * 86400); if (secs >= 86400) secs = 86399
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay(), H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60 }
}
