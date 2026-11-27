/** Leitor de fórmulas do Excel (sintaxe en-US gravada no arquivo) → árvore. */
export type Node =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'err'; v: string }
  | { t: 'cell'; sheet?: string; r: number; c: number; ar: boolean; ac: boolean }            // A1 (ar/ac = absoluto)
  | { t: 'area'; sheet?: string; r1: number; c1: number; r2: number; c2: number; ar1: boolean; ac1: boolean; ar2: boolean; ac2: boolean }   // A1:B2, A:B
  | { t: 'name'; v: string }
  | { t: 'sref'; table: string; spec: SRef }
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'un'; op: string; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'empty' }
export interface SRef { thisRow: boolean; headers: boolean; all: boolean; data: boolean; col1?: string; col2?: string }

const colNum = (s: string) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n }

interface Tok { k: string; v: string }
function tokenize(src: string): Tok[] {
  const s = src.startsWith('=') ? src.slice(1) : src
  const out: Tok[] = []; let i = 0
  const isIdStart = (ch: string) => /[A-Za-z_\\À-ÿ]/.test(ch)
  while (i < s.length) {
    const ch = s[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue }
    if (ch === '"') { let j = i + 1, v = ''; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue } break } v += s[j++] } out.push({ k: 'str', v }); i = j + 1; continue }
    if (ch === '#') { const m = s.slice(i).match(/^#(N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!)/); if (m) { out.push({ k: 'err', v: m[0] }); i += m[0].length; continue } }
    if (/[0-9.]/.test(ch)) { const m = s.slice(i).match(/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/); if (m) { out.push({ k: 'num', v: m[0] }); i += m[0].length; continue } }
    if (ch === "'") { let j = i + 1, v = ''; while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue } break } v += s[j++] } i = j + 1; if (s[i] === '!') { out.push({ k: 'sheet', v }); i++ } continue }
    if (s.startsWith('<>', i) || s.startsWith('<=', i) || s.startsWith('>=', i)) { out.push({ k: 'op', v: s.slice(i, i + 2) }); i += 2; continue }
    if ('+-*/^&=<>%'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue }
    if (ch === '(' || ch === ')' || ch === ',' || ch === ':' || ch === '{' || ch === '}' || ch === ';') { out.push({ k: ch, v: ch }); i++; continue }
    if (ch === '$' || isIdStart(ch)) {
      // identificador: nome, função, referência, tabela[...] ou Planilha!
      let j = i; while (j < s.length && /[A-Za-z0-9_.$\\À-ÿ]/.test(s[j])) j++
      let id = s.slice(i, j)
      if (s[j] === '[') {   // referência estruturada: casa colchetes
        let depth = 0, k = j
        for (; k < s.length; k++) { if (s[k] === "'" ) { k++; continue } if (s[k] === '[') depth++; else if (s[k] === ']') { depth--; if (depth === 0) break } }
        out.push({ k: 'sref', v: id + s.slice(j, k + 1) }); i = k + 1; continue
      }
      if (s[j] === '!') { out.push({ k: 'sheet', v: id }); i = j + 1; continue }
      if (s[j] === '(') { out.push({ k: 'fn', v: id.toUpperCase().replace(/^_XLFN\./, '').replace(/^_XLWS\./, '') }); i = j; continue }
      out.push({ k: 'id', v: id }); i = j; continue
    }
    throw new Error('Caractere inesperado na fórmula: ' + ch + ' em ' + src)
  }
  return out
}

function parseSRef(txt: string): { table: string; spec: SRef } {
  const b = txt.indexOf('['); const table = txt.slice(0, b); let inner = txt.slice(b + 1, -1)
  const spec: SRef = { thisRow: false, headers: false, all: false, data: false }
  const items: string[] = []
  if (!inner.startsWith('[')) items.push(inner)
  else { const re = /\[((?:'.|[^\]])*)\]/g; let m; const rest = inner; while ((m = re.exec(rest))) items.push(m[1]); if (/\]:\[/.test(inner)) { spec.col1 = items[items.length - 2]; spec.col2 = items[items.length - 1] } }
  const cols: string[] = []
  for (const it0 of items) {
    const it = it0.replace(/'(.)/g, '$1')
    if (it === '#This Row') spec.thisRow = true
    else if (it === '#Headers') spec.headers = true
    else if (it === '#All') spec.all = true
    else if (it === '#Data') spec.data = true
    else if (it !== '') cols.push(it)
  }
  if (!spec.col2) { spec.col1 = cols[0]; spec.col2 = cols[0] } else { spec.col1 = spec.col1!.replace(/'(.)/g, '$1'); spec.col2 = spec.col2!.replace(/'(.)/g, '$1') }
  return { table, spec }
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/, COL_RE = /^(\$?)([A-Za-z]{1,3})$/, ROW_RE = /^(\$?)(\d+)$/

export function parse(src: string): Node {
  const toks = tokenize(src); let p = 0
  const peek = () => toks[p], next = () => toks[p++]
  const expect = (k: string) => { const t = next(); if (!t || t.k !== k) throw new Error(`Esperava ${k} em ${src}`); return t }
  function primary(): Node {
    const t = next(); if (!t) throw new Error('Fórmula incompleta: ' + src)
    if (t.k === 'num') return { t: 'num', v: Number(t.v) }
    if (t.k === 'str') return { t: 'str', v: t.v }
    if (t.k === 'err') return { t: 'err', v: t.v }
    if (t.k === '(') { const e = expr(); expect(')'); return e }
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) return { t: 'un', op: t.v, a: unaryOperand() }
    if (t.k === 'fn') {
      expect('('); const args: Node[] = []
      if (peek()?.k !== ')') {
        for (;;) {
          if (peek()?.k === ',' ) { args.push({ t: 'empty' }); next(); continue }
          if (peek()?.k === ')') { args.push({ t: 'empty' }); break }
          args.push(expr())
          if (peek()?.k === ',') { next(); if (peek()?.k === ')') { args.push({ t: 'empty' }); break } continue }
          break
        }
      }
      expect(')'); return { t: 'fn', name: t.v, args }
    }
    if (t.k === 'sref') { const r = parseSRef(t.v); return { t: 'sref', table: r.table, spec: r.spec } }
    if (t.k === 'sheet') { const nx = next(); return refFrom(nx, t.v) }
    if (t.k === 'id') return refFrom(t, undefined)
    throw new Error('Token inesperado ' + t.k + ' ' + t.v + ' em ' + src)
  }
  function unaryOperand(): Node { return postfix(primary()) }
  function refFrom(t: Tok, sheet?: string): Node {
    const v = t.v
    const up = v.toUpperCase()
    if (!sheet && (up === 'TRUE' || up === 'FALSE')) return { t: 'bool', v: up === 'TRUE' }
    let m = v.match(REF_RE)
    if (m) {
      const a: Node = { t: 'cell', sheet, r: +m[4], c: colNum(m[2]), ar: !!m[3], ac: !!m[1] }
      if (peek()?.k === ':' && toks[p + 1] && (toks[p + 1].k === 'id' || toks[p + 1].k === 'num')) {
        const save = p; next(); const t2 = next(); const m2 = t2.v.match(REF_RE)
        if (m2) return { t: 'area', sheet, r1: a.r, c1: a.c, r2: +m2[4], c2: colNum(m2[2]), ar1: a.ar, ac1: a.ac, ar2: !!m2[3], ac2: !!m2[1] }
        p = save
      }
      return a
    }
    m = v.match(COL_RE)
    if (m && peek()?.k === ':') { const save = p; next(); const t2 = next(); const m2 = t2?.v.match(COL_RE); if (m2) return { t: 'area', sheet, r1: 1, c1: colNum(m[2]), r2: 1048576, c2: colNum(m2[2]), ar1: true, ac1: !!m[1], ar2: true, ac2: !!m2[1] }; p = save }
    m = (t.k === 'num' ? t.v : v).match(ROW_RE)
    if (m && peek()?.k === ':') { const save = p; next(); const t2 = next(); const m2 = t2?.v.match(ROW_RE); if (m2) return { t: 'area', sheet, r1: +m[2], c1: 1, r2: +m2[2], c2: 16384, ar1: !!m[1], ac1: true, ar2: !!m2[1], ac2: true }; p = save }
    return { t: 'name', v }
  }
  function postfix(n: Node): Node {
    for (;;) {
      const t = peek()
      if (t && t.k === 'op' && t.v === '%') { next(); n = { t: 'pct', a: n }; continue }
      if (t && t.k === ':') { next(); const b = primary(); n = { t: 'bin', op: ':', a: n, b }; continue }
      return n
    }
  }
  const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }
  function binary(minP: number): Node {
    let left = postfix(primary())
    for (;;) {
      const t = peek(); if (!t || t.k !== 'op' || !(t.v in PREC)) break
      const pr = PREC[t.v]; if (pr < minP) break
      next(); const right = binary(t.v === '^' ? pr : pr + 1)
      left = { t: 'bin', op: t.v, a: left, b: right }
    }
    return left
  }
  function expr(): Node { return binary(1) }
  const r = expr()
  if (p < toks.length) throw new Error('Sobrou texto na fórmula: ' + src + ' @ ' + toks[p].v)
  return r
}
