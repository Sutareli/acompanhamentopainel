/** Formatos de número do Excel exibidos como no Excel em português (vírgula decimal, ponto de milhar, meses em pt). */
import { dataDe, Esc, isErr, numTexto } from './valores'

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function secoes(fmt: string): string[] {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '"') { q = !q; cur += ch; continue }
    if (!q && ch === '\\') { cur += ch + (fmt[i + 1] ?? ''); i++; continue }
    if (!q && ch === ';') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur); return out
}
const ehData = (s: string) => /(^|[^"\\])[dmyhs]/i.test(s.replace(/"[^"]*"/g, '').replace(/\\./g, ''))

function grupo(intStr: string) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.') }

function fmtNumero(v: number, sec: string): string {
  // separa partes literais e o "núcleo" numérico
  let pre = '', core = '', post = '', i = 0, fase = 0
  const lit = (s: string) => { if (fase === 0) pre += s; else post += s }
  while (i < sec.length) {
    const ch = sec[i]
    if (ch === '"') { const j = sec.indexOf('"', i + 1); lit(sec.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? sec.length : j + 1; continue }
    if (ch === '\\') { lit(sec[i + 1] ?? ''); i += 2; continue }
    if (ch === '_') { lit(' '); i += 2; continue }
    if (ch === '*') { i += 2; continue }
    if (ch === '[') { const j = sec.indexOf(']', i); i = j + 1; continue }
    if ('0#?,.'.includes(ch)) { if (fase === 2) { post += ch; i++; continue } fase = 1; core += ch; i++; continue }
    if (ch === '%') { if (fase === 1) fase = 2; lit('%'); i++; continue }
    if (fase === 1) fase = 2
    lit(ch); i++
  }
  const pct = (sec.replace(/"[^"]*"/g, '').match(/%/g) || []).length
  let x = v * Math.pow(100, pct)
  if (!core) return pre + post
  const dot = core.indexOf('.')
  const intP = dot >= 0 ? core.slice(0, dot) : core, decP = dot >= 0 ? core.slice(dot + 1) : ''
  const nDec = (decP.match(/[0#?]/g) || []).length, minDec = (decP.match(/0/g) || []).length
  const usaMil = intP.includes(',')
  const minInt = (intP.match(/0/g) || []).length
  const neg = x < 0; x = Math.abs(x)
  let s = (Math.round(x * Math.pow(10, nDec) + 1e-9) / Math.pow(10, nDec)).toFixed(nDec)
  let [ip, dp = ''] = s.split('.')
  if (nDec > minDec) dp = dp.replace(new RegExp('0{0,' + (nDec - minDec) + '}$'), '')
  if (ip === '0' && minInt === 0) ip = ''
  if (ip.length < minInt) ip = ip.padStart(minInt, '0')
  if (usaMil) ip = grupo(ip)
  return (neg ? '-' : '') + pre + ip + (dp ? ',' + dp : '') + post
}

function fmtData(v: number, sec: string): string {
  const d = dataDe(v); let out = '', i = 0
  const tem = (re: RegExp) => re.test(sec)
  const ampm = tem(/AM\/PM/i)
  const toks: string[] = []
  while (i < sec.length) {
    const ch = sec[i]
    if (ch === '"') { const j = sec.indexOf('"', i + 1); toks.push('"' + sec.slice(i + 1, j)); i = j + 1; continue }
    if (ch === '\\') { toks.push('"' + (sec[i + 1] ?? '')); i += 2; continue }
    if (ch === '[') { const j = sec.indexOf(']', i); i = j + 1; continue }
    const m = sec.slice(i).match(/^(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM)/i)
    if (m) { toks.push(m[0].toLowerCase()); i += m[0].length; continue }
    toks.push('"' + ch); i++
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.startsWith('"')) { out += t.slice(1); continue }
    const prevH = toks.slice(0, k).reverse().find((x) => !x.startsWith('"'))
    const nextS = toks.slice(k + 1).find((x) => !x.startsWith('"'))
    const minuto = (t === 'm' || t === 'mm') && ((prevH && /^h/.test(prevH)) || (nextS && /^s/.test(nextS)))
    switch (t) {
      case 'yyyy': out += d.y; break
      case 'yy': out += String(d.y).slice(-2); break
      case 'mmmmm': out += MES[d.m - 1][0]; break
      case 'mmmm': out += MES_L[d.m - 1]; break
      case 'mmm': out += MES[d.m - 1]; break
      case 'mm': out += minuto ? String(d.M).padStart(2, '0') : String(d.m).padStart(2, '0'); break
      case 'm': out += minuto ? d.M : d.m; break
      case 'dddd': case 'ddd': out += DIA[d.wd]; break
      case 'dd': out += String(d.d).padStart(2, '0'); break
      case 'd': out += d.d; break
      case 'hh': out += String(ampm ? ((d.H + 11) % 12) + 1 : d.H).padStart(2, '0'); break
      case 'h': out += ampm ? ((d.H + 11) % 12) + 1 : d.H; break
      case 'ss': out += String(d.S).padStart(2, '0'); break
      case 's': out += d.S; break
      case 'am/pm': out += d.H < 12 ? 'AM' : 'PM'; break
    }
  }
  return out
}

/** Formato "data curta" do Excel (código 14, gravado como mm-dd-yy) aparece como dd/mm/aaaa no Excel em português. */
const LOCAL: Record<string, string> = { 'mm-dd-yy': 'dd/mm/yyyy', 'm/d/yyyy': 'dd/mm/yyyy', 'd-mmm-yy': 'dd/mmm/yy', 'mmm-yy': 'mmm/yy', 'h:mm': 'hh:mm' }

export function formatar(v: Esc, fmt?: string): string {
  if (v === null) return ''
  if (isErr(v)) return v.code
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO'
  const f0 = fmt && fmt !== 'General' ? (LOCAL[fmt] ?? fmt) : ''
  if (typeof v === 'string') { const ss = f0 ? secoes(f0) : []; if (ss.length >= 4 && ss[3].includes('@')) return ss[3].replace(/@/g, v).replace(/"/g, ''); return v }
  if (!f0) return geral(v)
  const ss = secoes(f0)
  let sec: string, val = v
  if (ss.length === 1) sec = ss[0]
  else if (v > 0 || (v === 0 && ss.length < 3)) sec = ss[0]
  else if (v < 0) { sec = ss[1] ?? ss[0]; val = ss.length > 1 ? -v : v }
  else sec = ss[2]
  if (sec === '') return ''
  if (/^General$/i.test(sec)) return (v < 0 && ss.length > 1 ? '-' : '') + geral(val)
  if (ehData(sec)) return fmtData(val, sec)
  return fmtNumero(val, sec)
}
function geral(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e11 || a < 1e-9)) return numTexto(+v.toPrecision(6))
  // célula com formato Geral mostra até ~10 dígitos visíveis
  const s = numTexto(+v.toPrecision(11))
  return s
}
/** FIXED(n; casas) do Excel em pt-BR (ponto de milhar e vírgula decimal). */
export function fixed(n: number, casas: number, semMil: boolean): string {
  const f = (semMil ? '0' : '#,##0') + (casas > 0 ? '.' + '0'.repeat(casas) : '')
  if (casas < 0) { const p = Math.pow(10, -casas); n = Math.round(n / p) * p; return formatar(n, semMil ? '0' : '#,##0') }
  return formatar(n, f)
}
