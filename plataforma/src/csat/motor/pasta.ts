/** Motor de cálculo: executa as fórmulas originais da planilha Rocco_CSAT_Dashboard (mesmo resultado do Excel). */
import { parse, Node, SRef } from './parser'
import { cmp, dataDe, DIV0, Esc, isErr, isMat, isRef, Mat, mkRef, NA, NAME, NUM, numTexto, parseNum, REF, Ref, serialDe, toBool, toNum, toStr, Val, VALUE, XErr } from './valores'
import { fixed, formatar } from './formato'

export interface Tabela { sheet: string; c0: number; r0: number; c1: number; r1: number; cols: string[]; calc: Record<string, string>; data: boolean }
export interface ModeloFolha { cells: Record<string, [number, ...unknown[]]>; maxRow: number; maxCol: number }
export interface Modelo { sheets: Record<string, ModeloFolha & Record<string, unknown>>; tables: Record<string, Tabela>; names: Record<string, string>; styles: unknown[]; order: string[] }

interface Celula { f?: string; ast?: Node; v?: Esc }
const K = (r: number, c: number) => r * 16384 + c
const MAXR = 1048576

class Folha {
  cells = new Map<number, Celula>()
  maxRow = 0; maxCol = 0
  constructor(public nome: string) {}
  set(r: number, c: number, cel: Celula) { this.cells.set(K(r, c), cel); if (r > this.maxRow) this.maxRow = r; if (c > this.maxCol) this.maxCol = c }
}

interface Ctx { sheet: string; r: number; c: number }
type Fn = (args: Node[], ctx: Ctx, P: Pasta, fixo?: Map<number, Esc>) => Val

const astCache = new Map<string, Node>()
function ast(f: string): Node { let a = astCache.get(f); if (!a) { a = parse(f); astCache.set(f, a) } return a }

export class Pasta {
  folhas = new Map<string, Folha>()
  tabelas: Record<string, Tabela> = {}
  nomes: Record<string, string> = {}
  private memo = new Map<string, Map<number, Esc>>()
  private dep = new Map<string, Map<number, boolean>>()   // célula depende de alguma entrada?
  private calc = new Map<string, Set<number>>()
  private pilha: boolean[] = []
  entradas = new Set<string>()   // "Folha|r|c"
  private entK = new Map<string, Set<number>>()
  private estaticos = new Map<string, Map<string, number>>()   // índices de busca de faixas sem fórmula
  porCalculo = new Map<string, unknown>()            // caches válidos até o próximo recálculo
  avaliacoes = 0

  constructor(m: Modelo) {
    for (const [nome, fm] of Object.entries(m.sheets)) {
      const f = new Folha(nome)
      for (const [k, e] of Object.entries(fm.cells)) {
        const [r, c] = k.split(',').map(Number)
        const f0 = e[2] as string | undefined, v0 = e[1] as Esc | undefined
        if (f0) f.set(r, c, { f: f0 }); else if (v0 !== undefined && v0 !== null) f.set(r, c, { v: v0 as Esc })
      }
      f.maxRow = Math.max(f.maxRow, fm.maxRow); f.maxCol = Math.max(f.maxCol, fm.maxCol)
      this.folhas.set(nome, f)
    }
    this.tabelas = JSON.parse(JSON.stringify(m.tables))
    this.nomes = { ...m.names }
  }

  /** Linhas de dados de uma tabela de dados (Base de Dados): valores das colunas de entrada; as colunas calculadas recebem a fórmula da tabela. */
  carregarTabela(nome: string, linhas: Record<string, Esc>[]) {
    const t = this.tabelas[nome]; const f = this.folhas.get(t.sheet)!
    for (const k of [...f.cells.keys()]) if (Math.floor(k / 16384) > t.r0) f.cells.delete(k)
    const n = Math.max(1, linhas.length)
    t.r1 = t.r0 + n
    t.cols.forEach((col, j) => {
      const c = t.c0 + j, form = t.calc[col]
      for (let i = 0; i < n; i++) {
        const r = t.r0 + 1 + i
        if (form) f.set(r, c, { f: form })
        else { const v = linhas[i]?.[col]; if (v !== undefined && v !== null && v !== '') f.set(r, c, { v }) }
      }
    })
    f.maxRow = t.r1
    this.recalcular(true)
  }
  /** Folha só de valores (quadros): linha 1 = cabeçalho. */
  carregarValores(sheet: string, linhas: Esc[][], primeiraLinha = 2) {
    const f = this.folhas.get(sheet)!
    for (const k of [...f.cells.keys()]) if (Math.floor(k / 16384) >= primeiraLinha) f.cells.delete(k)
    linhas.forEach((lin, i) => lin.forEach((v, j) => { if (v !== null && v !== undefined && v !== '') f.set(primeiraLinha + i, j + 1, { v }) }))
    f.maxRow = Math.max(primeiraLinha - 1, primeiraLinha - 1 + linhas.length)
    this.estaticos.clear(); this.recalcular(true)
  }
  definir(sheet: string, r: number, c: number, v: Esc) {
    const f = this.folhas.get(sheet)!
    if (v === null || v === '') f.cells.delete(K(r, c)); else f.set(r, c, { v })
    if (this.entradas.has(`${sheet}|${r}|${c}`)) this.recalcular(false); else { this.estaticos.clear(); this.recalcular(true) }
  }
  /** Grava um valor fixo sem recalcular (use recalcular(true) depois de várias gravações). */
  gravar(sheet: string, r: number, c: number, v: Esc) { const f = this.folhas.get(sheet); if (!f) return; if (v === null || v === '') f.cells.delete(K(r, c)); else f.set(r, c, { v }) }
  marcarEntrada(sheet: string, r: number, c: number) { this.entradas.add(`${sheet}|${r}|${c}`); let s = this.entK.get(sheet); if (!s) { s = new Set(); this.entK.set(sheet, s) } s.add(K(r, c)); this.recalcular(true) }
  /** total = descarta tudo; senão só o que depende das entradas (filtros). */
  recalcular(total: boolean) {
    this.porCalculo.clear()
    if (total) { this.memo.clear(); this.dep.clear(); return }
    for (const [s, m] of this.dep) { const mm = this.memo.get(s); if (!mm) continue; for (const [k, d] of m) if (d) { mm.delete(k); m.delete(k) } }
  }

  // ---------------- leitura de células ----------------
  valor(sheet: string, r: number, c: number): Esc {
    const k = K(r, c)
    let mm = this.memo.get(sheet); if (!mm) { mm = new Map(); this.memo.set(sheet, mm) }
    const hit = mm.get(k)
    if (hit !== undefined || mm.has(k)) { if (this.dep.get(sheet)?.get(k)) this.marcaDep(); return hit as Esc }
    if (this.entK.get(sheet)?.has(k)) this.marcaDep()
    const f = this.folhas.get(sheet); if (!f) return REF
    const cel = f.cells.get(k)
    if (!cel) return null
    if (cel.f === undefined) return cel.v ?? null
    let em = this.calc.get(sheet); if (!em) { em = new Set(); this.calc.set(sheet, em) }
    if (em.has(k)) return 0   // referência circular
    em.add(k); this.pilha.push(false)
    let v: Esc
    try { v = this.escalar(this.ev(cel.ast ?? (cel.ast = ast(cel.f)), { sheet, r, c }), { sheet, r, c }) }
    catch (e) { v = e instanceof XErr ? e : VALUE; if (!(e instanceof XErr)) console.warn('Erro na fórmula', sheet, r, c, cel.f, e) }
    const d = this.pilha.pop()!; em.delete(k)
    if (v === null) v = 0   // fórmula que aponta para vazio devolve 0
    mm.set(k, v)
    if (d) { let dm = this.dep.get(sheet); if (!dm) { dm = new Map(); this.dep.set(sheet, dm) } dm.set(k, true); this.marcaDep() }
    this.avaliacoes++
    return v
  }
  private marcaDep() { if (this.pilha.length) this.pilha[this.pilha.length - 1] = true }
  /** Cache válido até o próximo recálculo, que guarda também se o conteúdo depende das entradas (filtros). */
  memoCalc<T>(key: string, build: () => T): T {
    const h = this.porCalculo.get(key) as { v: T; d: boolean } | undefined
    if (h) { if (h.d) this.marcaDep(); return h.v }
    this.pilha.push(false)
    let v: T, d: boolean
    try { v = build() } finally { d = this.pilha.pop()! }
    this.porCalculo.set(key, { v, d }); if (d) this.marcaDep()
    return v
  }
  temFormula(sheet: string, r: number, c: number) { return this.folhas.get(sheet)?.cells.get(K(r, c))?.f !== undefined }

  /** Faixa → matriz de valores (limitada à área usada da folha). */
  mat(ref: Ref): Mat {
    const f = this.folhas.get(ref.sheet); if (!f) throw REF
    const r2 = Math.min(ref.r2, Math.max(f.maxRow, ref.r1)), c2 = Math.min(ref.c2, Math.max(f.maxCol, ref.c1))
    const out: Mat = []
    for (let r = ref.r1; r <= r2; r++) { const lin: Esc[] = []; for (let c = ref.c1; c <= c2; c++) lin.push(this.valor(ref.sheet, r, c)); out.push(lin) }
    return out
  }
  limitar(ref: Ref): Ref { const f = this.folhas.get(ref.sheet)!; return { ...ref, r2: Math.min(ref.r2, Math.max(f.maxRow, ref.r1)), c2: Math.min(ref.c2, Math.max(f.maxCol, ref.c1)) } }
  /** Coluna/linha única → lista de valores (com a posição). */
  lista(v: Val): Esc[] {
    const m = isRef(v) ? this.mat(this.limitar(v)) : isMat(v) ? v : [[v]]
    if (m.length === 1) return m[0]
    if (m.every((l) => l.length === 1)) return m.map((l) => l[0])
    return m.flat()
  }
  plano(v: Val): Esc[] { if (isRef(v)) return this.mat(v).flat(); if (isMat(v)) return v.flat(); return [v] }

  escalar(v: Val, ctx: Ctx): Esc {
    if (isRef(v)) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.valor(v.sheet, v.r1, v.c1)
      // interseção implícita
      if (v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return this.valor(v.sheet, ctx.r, v.c1)
      if (v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return this.valor(v.sheet, v.r1, ctx.c)
      return VALUE
    }
    if (isMat(v)) return v.length ? v[0][0] : VALUE
    return v
  }

  // ---------------- avaliação ----------------
  ev(n: Node, ctx: Ctx): Val {
    switch (n.t) {
      case 'num': return n.v
      case 'str': return n.v
      case 'bool': return n.v
      case 'err': return new XErr(n.v)
      case 'empty': return null
      case 'cell': return mkRef(n.sheet ?? ctx.sheet, n.r, n.c)
      case 'area': return mkRef(n.sheet ?? ctx.sheet, n.r1, n.c1, n.r2, n.c2)
      case 'name': return this.nome(n.v, ctx)
      case 'sref': return this.sref(n.table, n.spec, ctx)
      case 'pct': return this.mapa1(this.ev(n.a, ctx), ctx, (x) => { const v = toNum(x); return isErr(v) ? v : v / 100 })
      case 'un': { const a = this.ev(n.a, ctx); return this.mapa1(a, ctx, (x) => { const v = toNum(x); return isErr(v) ? v : n.op === '-' ? -v : v }) }
      case 'bin': return this.bin(n.op, n.a, n.b, ctx)
      case 'fn': { const f = FN[n.name]; if (!f) { console.warn('Função não implementada', n.name); return NAME } return f(n.args, ctx, this) }
    }
  }
  nome(v: string, ctx: Ctx): Val {
    const f = this.nomes[v]
    if (f === undefined) { if (this.tabelas[v]) return this.sref(v, { thisRow: false, headers: false, all: false, data: true }, ctx); return NAME }
    return this.ev(ast(f), ctx)
  }
  sref(tn: string, s: SRef, ctx: Ctx): Ref {
    const t = this.tabelas[tn]; if (!t) throw REF
    const ci1 = s.col1 ? t.cols.indexOf(s.col1) : 0, ci2 = s.col2 ? t.cols.indexOf(s.col2) : t.cols.length - 1
    if (ci1 < 0 || ci2 < 0) throw REF
    const c1 = t.c0 + ci1, c2 = t.c0 + ci2
    if (s.thisRow) return mkRef(t.sheet, ctx.r, c1, ctx.r, c2)
    if (s.headers) return mkRef(t.sheet, t.r0, c1, t.r0, c2)
    if (s.all) return mkRef(t.sheet, t.r0, c1, t.r1, c2)
    return mkRef(t.sheet, t.r0 + 1, c1, t.r1, c2)
  }
  /** Valor para operação elemento a elemento: faixa de 1 célula vira escalar; faixa maior vira matriz. */
  arr(v: Val): Esc | Mat { if (isRef(v)) { if (v.r1 === v.r2 && v.c1 === v.c2) return this.valor(v.sheet, v.r1, v.c1); return this.mat(v) } return v }
  mapa1(v: Val, _ctx: Ctx, f: (x: Esc) => Esc): Esc | Mat { const a = this.arr(v); if (isMat(a)) return a.map((l) => l.map(f)); return f(a) }
  mapa2(a0: Val, b0: Val, f: (x: Esc, y: Esc) => Esc): Esc | Mat {
    const a = this.arr(a0), b = this.arr(b0)
    if (!isMat(a) && !isMat(b)) return f(a, b)
    const A = isMat(a) ? a : [[a]], B = isMat(b) ? b : [[b]]
    const R = Math.max(A.length, B.length), C = Math.max(A[0]?.length ?? 1, B[0]?.length ?? 1)
    const pick = (M: Mat, r: number, c: number): Esc => { const rr = M.length === 1 ? 0 : r, cc = M[0].length === 1 ? 0 : c; return M[rr]?.[cc] ?? NA }
    const out: Mat = []
    for (let r = 0; r < R; r++) { const l: Esc[] = []; for (let c = 0; c < C; c++) l.push(f(pick(A, r, c), pick(B, r, c))); out.push(l) }
    return out
  }
  bin(op: string, an: Node, bn: Node, ctx: Ctx): Val {
    if (op === ':') {
      const a = this.ev(an, ctx), b = this.ev(bn, ctx)
      if (!isRef(a) || !isRef(b)) throw VALUE
      return mkRef(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2))
    }
    const a = this.ev(an, ctx), b = this.ev(bn, ctx)
    return this.mapa2(a, b, (x, y) => opBin(op, x, y))
  }
}

function opBin(op: string, x: Esc, y: Esc): Esc {
  if (op === '&') { if (isErr(x)) return x; if (isErr(y)) return y; return (toStr(x) as string) + (toStr(y) as string) }
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    if (isErr(x)) return x; if (isErr(y)) return y
    const c = cmp(x, y)
    switch (op) { case '=': return c === 0; case '<>': return c !== 0; case '<': return c < 0; case '>': return c > 0; case '<=': return c <= 0; default: return c >= 0 }
  }
  const a = toNum(x), b = toNum(y)
  if (isErr(a)) return a; if (isErr(b)) return b
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b === 0 ? DIV0 : a / b
    case '^': return Math.pow(a, b)
  }
  return VALUE
}

// ---------------- critérios (CONT.SE etc.) ----------------
interface Crit { op: string; v: Esc; wild?: RegExp; numV?: number | null }
function wildRe(s: string): RegExp {
  let re = ''
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '~' && i + 1 < s.length) { re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue } if (ch === '*') re += '[\\s\\S]*'; else if (ch === '?') re += '[\\s\\S]'; else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  return new RegExp('^' + re + '$', 'i')
}
function critDe(c: Esc): Crit {
  if (typeof c === 'number' || typeof c === 'boolean' || c === null) return { op: '=', v: c ?? '', numV: typeof c === 'number' ? c : null }
  if (isErr(c)) return { op: '=', v: c }
  const m = c.match(/^(<=|>=|<>|<|>|=)?([\s\S]*)$/)!
  const op = m[1] || '=', rest = m[2]
  const n = parseNum(rest)
  const cr: Crit = { op, v: n !== null && rest.trim() !== '' ? n : rest, numV: n }
  if ((op === '=' || op === '<>') && typeof cr.v === 'string' && /[*?~]/.test(cr.v)) cr.wild = wildRe(cr.v)
  return cr
}
function casa(cel: Esc, cr: Crit): boolean {
  const { op, v } = cr
  if (op === '=' || op === '<>') {
    let eq: boolean
    if (cr.wild) eq = typeof cel === 'string' && cr.wild.test(cel)
    else if (v === '') eq = cel === null || cel === ''
    else if (typeof v === 'number') eq = (typeof cel === 'number' && cel === v) || (typeof cel === 'string' && parseNum(cel) === v)
    else if (typeof v === 'boolean') eq = cel === v
    else if (isErr(v)) eq = isErr(cel) && cel.code === v.code
    else eq = typeof cel === 'string' && cel.toLowerCase() === (v as string).toLowerCase()
    return op === '=' ? eq : !eq
  }
  if (cel === null || isErr(cel)) return false
  if (typeof v === 'number') { if (typeof cel !== 'number') return false } else if (typeof v === 'string') { if (typeof cel !== 'string') return false }
  const c = cmp(cel, v)
  return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0
}
const chaveCel = (v: Esc): string => (v === null || v === '' ? 'b' : typeof v === 'number' ? 'n' + v : typeof v === 'string' ? (parseNum(v) !== null && /^\s*[+-]?\d/.test(v) ? 'n' + parseNum(v) : 's' + v.toLowerCase()) : typeof v === 'boolean' ? 'l' + v : 'e' + v.code)

/** Máscara (posições que atendem o critério) de uma faixa, com cache por recálculo. */
function mascara(P: Pasta, ref: Ref | Mat, crit: Esc): Uint8Array {
  const cr = critDe(crit)
  const build = () => {
    const vals = isRef(ref) ? P.plano(P.limitar(ref)) : (ref as Mat).flat()
    const m = new Uint8Array(vals.length)
    for (let i = 0; i < vals.length; i++) m[i] = casa(vals[i], cr) ? 1 : 0
    return m
  }
  if (!isRef(ref)) return build()
  return P.memoCalc(`m|${ref.sheet}|${ref.r1}|${ref.c1}|${ref.r2}|${ref.c2}|${typeof crit}|${String(crit)}`, build)
}
/** CONT.SE de igualdade em coluna única: índice por valor + busca binária (rápido para contagens "acumuladas" linha a linha). */
function contaIgual(P: Pasta, ref: Ref, crit: Esc): number | null {
  if (ref.c1 !== ref.c2) return null
  const cr = critDe(crit); if (cr.op !== '=' || cr.wild || cr.v === '') return null
  const f = P.folhas.get(ref.sheet)!
  const idx = P.memoCalc(`i|${ref.sheet}|${ref.c1}`, () => {
    const m = new Map<string, number[]>()
    for (let r = 1; r <= f.maxRow; r++) { const v = P.valor(ref.sheet, r, ref.c1); const k = chaveCel(v); let a = m.get(k); if (!a) { a = []; m.set(k, a) } a.push(r) }
    return m
  })
  const k = typeof cr.v === 'number' ? 'n' + cr.v : typeof cr.v === 'string' ? 's' + cr.v.toLowerCase() : chaveCel(cr.v)
  const a = idx.get(k); if (!a) return 0
  const lo = lb(a, ref.r1), hi = lb(a, Math.min(ref.r2, f.maxRow) + 1)
  return hi - lo
}
const lb = (a: number[], x: number) => { let l = 0, h = a.length; while (l < h) { const m = (l + h) >> 1; if (a[m] < x) l = m + 1; else h = m } return l }

// ---------------- funções ----------------
const ev = (P: Pasta, n: Node | undefined, ctx: Ctx): Val => (n ? P.ev(n, ctx) : null)
const esc = (P: Pasta, n: Node | undefined, ctx: Ctx): Esc => (n ? P.escalar(P.ev(n, ctx), ctx) : null)
const num = (P: Pasta, n: Node | undefined, ctx: Ctx): number => { const v = toNum(esc(P, n, ctx)); if (isErr(v)) throw v; return v }
const str = (P: Pasta, n: Node | undefined, ctx: Ctx): string => { const v = esc(P, n, ctx); if (isErr(v)) throw v; return toStr(v) as string }
/** Função escalar que se aplica elemento a elemento quando recebe matriz/faixa (comportamento em fórmulas matriciais). */
function lift(f: (...xs: Esc[]) => Esc, nArgs?: number): Fn {
  return (args, ctx, P) => {
    const vs = args.map((a) => P.arr(P.ev(a, ctx)))
    const mi = vs.findIndex(isMat)
    if (mi < 0) return f(...(vs as Esc[]))
    const R = Math.max(...vs.map((v) => (isMat(v) ? v.length : 1))), C = Math.max(...vs.map((v) => (isMat(v) ? v[0].length : 1)))
    const out: Mat = []
    for (let r = 0; r < R; r++) { const l: Esc[] = []; for (let c = 0; c < C; c++) l.push(f(...vs.map((v) => (isMat(v) ? v[v.length === 1 ? 0 : r]?.[v[0].length === 1 ? 0 : c] ?? NA : v)))); out.push(l) }
    return out
  }
}
const sN = (x: Esc): number => { const v = toNum(x); if (isErr(v)) throw v; return v }
const sS = (x: Esc): string => { if (isErr(x)) throw x; return toStr(x) as string }
const safe = (f: (...xs: Esc[]) => Esc) => (...xs: Esc[]): Esc => { try { return f(...xs) } catch (e) { if (e instanceof XErr) return e; throw e } }
const L = (f: (...xs: Esc[]) => Esc, n?: number) => lift(safe(f), n)

function roundX(x: number, d: number) { const p = Math.pow(10, d); const y = Math.abs(x) * p; const r = Math.round(y + 1e-9 * Math.max(1, y)); return Math.sign(x) * r / p }
function searchIn(find: string, within: string, start: number, wild: boolean): number {
  const w = within.toLowerCase(), f = find.toLowerCase()
  if (!wild || !/[*?~]/.test(f)) { const i = w.indexOf(f, start - 1); return i < 0 ? -1 : i + 1 }
  const re = new RegExp(wildRe(f).source.slice(1, -1), 'i')
  const m = re.exec(within.slice(start - 1)); return m ? m.index + start : -1
}
function trimX(s: string) { return s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ') }
function properX(s: string) { return s.toLowerCase().replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase()) }
function nums(P: Pasta, args: Node[], ctx: Ctx): number[] {
  const out: number[] = []
  for (const a of args) {
    if (a.t === 'empty') continue
    const v = P.ev(a, ctx)
    if (isRef(v) || isMat(v)) { for (const x of P.plano(v)) { if (isErr(x)) throw x; if (typeof x === 'number') out.push(x) } }
    else { const n = toNum(v); if (isErr(n)) throw n; out.push(n) }
  }
  return out
}
/** Critério que é uma faixa/matriz (ex.: CONT.SES(col; col)) devolve uma matriz de resultados, um por elemento. */
function critArray(P: Pasta, args: Node[], ctx: Ctx, from: number): { pos: number; vals: Mat } | null {
  for (let i = from + 1; i < args.length; i += 2) { const v = P.arr(P.ev(args[i], ctx)); if (isMat(v)) return { pos: i, vals: v } }
  return null
}
function ifsMask(P: Pasta, args: Node[], ctx: Ctx, from: number, fixo?: Map<number, Esc>): { m: Uint8Array | null; tam: number } {
  let m: Uint8Array | null = null, tam = 0
  for (let i = from; i + 1 < args.length; i += 2) {
    const r = P.ev(args[i], ctx); const c = fixo?.has(i + 1) ? fixo.get(i + 1)! : esc(P, args[i + 1], ctx)
    const rr = isRef(r) ? r : isMat(r) ? r : null; if (!rr) throw VALUE
    const mk = mascara(P, rr, c)
    if (!m) { m = new Uint8Array(mk); tam = mk.length } else { if (mk.length !== m.length) throw VALUE; for (let k = 0; k < m.length; k++) m[k] &= mk[k] }
  }
  return { m, tam }
}
function kth(P: Pasta, args: Node[], ctx: Ctx, large: boolean): Esc {
  const v = P.ev(args[0], ctx); const k = num(P, args[1], ctx)
  const arr = P.plano(v); for (const x of arr) if (isErr(x)) return x
  const ns = arr.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
  const kk = Math.ceil(k); if (kk < 1 || kk > ns.length) return NUM
  return large ? ns[ns.length - kk] : ns[kk - 1]
}
/** CORRESP exato com índice: faixas de valores (quadros) ficam indexadas de vez; colunas com fórmula, até o próximo recálculo. */
function matchIdx(P: Pasta, look: Esc, ref: Ref): Esc | undefined {
  const n = (ref.r2 - ref.r1 + 1) * (ref.c2 - ref.c1 + 1)
  if (n < 200 || (ref.r1 !== ref.r2 && ref.c1 !== ref.c2) || isErr(look) || (typeof look === 'string' && /[*?~]/.test(look))) return undefined
  const est = (P as unknown as { estaticos: Map<string, Map<string, number>> }).estaticos
  const key = `${ref.sheet}|${ref.r1}|${ref.c1}|${ref.r2}|${ref.c2}`
  const fix = ref.sheet.startsWith('Quadro')
  const build = () => {
    const m = new Map<string, number>(); const arr = P.lista(ref)
    arr.forEach((v, i) => { if (v === null || isErr(v)) return; const k = typeof v === 'number' ? 'n' + v : typeof v === 'string' ? 's' + v.toLowerCase() : 'l' + v; if (!m.has(k)) m.set(k, i) })
    return m
  }
  let idx: Map<string, number>
  if (fix) { idx = est.get(key) ?? build(); est.set(key, idx) } else idx = P.memoCalc('x|' + key, build)
  const k = typeof look === 'number' ? 'n' + look : typeof look === 'string' ? 's' + look.toLowerCase() : 'l' + look
  if (look === null) return NA
  const i = idx.get(k); return i === undefined ? NA : i + 1
}
function matchX(P: Pasta, look: Esc, arr: Esc[], tipo: number, _ref: Ref | null): Esc {
  if (isErr(look)) return look
  if (tipo === 0) {
    const wild = typeof look === 'string' && /[*?~]/.test(look) ? wildRe(look) : null
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (wild) { if (typeof v === 'string' && wild.test(v)) return i + 1 }
      else if (v !== null && !isErr(v) && typeof v === typeof look && cmp(v, look) === 0) return i + 1
      else if (v === null && look === '') { /* vazio não casa */ }
    }
    return NA
  }
  // aproximado (ordenado)
  let best = -1
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]; if (v === null || isErr(v) || typeof v !== typeof look) continue
    const c = cmp(v, look)
    if (tipo > 0) { if (c <= 0) best = i; else break } else { if (c >= 0) best = i; else break }
  }
  return best < 0 ? NA : best + 1
}

const FN: Record<string, Fn> = {
  IF: (a, ctx, P) => {
    const c = P.arr(P.ev(a[0], ctx))
    if (isMat(c)) { const t = P.arr(ev(P, a[1], ctx)), f = a.length > 2 ? P.arr(ev(P, a[2], ctx)) : false
      return c.map((l, r) => l.map((x, k) => { const b = toBool(x); if (isErr(b)) return b; const s = b ? t : f; return isMat(s) ? (s[s.length === 1 ? 0 : r]?.[s[0].length === 1 ? 0 : k] ?? NA) : (s as Esc) })) }
    const b = toBool(c); if (isErr(b)) return b
    if (b) return a.length > 1 ? (a[1].t === 'empty' ? 0 : P.ev(a[1], ctx)) : true
    return a.length > 2 ? (a[2].t === 'empty' ? 0 : P.ev(a[2], ctx)) : false
  },
  IFERROR: (a, ctx, P) => {
    let v: Val
    try { v = P.ev(a[0], ctx) } catch (e) { if (e instanceof XErr) return ev(P, a[1], ctx); throw e }
    const x = P.arr(v)
    if (isMat(x)) { const alt = P.arr(ev(P, a[1], ctx)); return x.map((l) => l.map((y) => (isErr(y) ? (isMat(alt) ? alt[0][0] : alt) : y))) }
    return isErr(x) ? ev(P, a[1], ctx) : v
  },
  AND: (a, ctx, P) => { let r = true; for (const n of a) { for (const x of P.plano(P.ev(n, ctx))) { if (x === null || typeof x === 'string') continue; const b = toBool(x); if (isErr(b)) return b; r = r && b } } return r },
  OR: (a, ctx, P) => { let r = false; for (const n of a) { for (const x of P.plano(P.ev(n, ctx))) { if (x === null || typeof x === 'string') continue; const b = toBool(x); if (isErr(b)) return b; r = r || b } } return r },
  NOT: L((x) => { const b = toBool(x); return isErr(b) ? b : !b }),
  ISNUMBER: L((x) => typeof x === 'number'),
  NA: () => NA,
  N: (a, ctx, P) => { const v = P.ev(a[0], ctx); const x = isRef(v) ? P.valor(v.sheet, v.r1, v.c1) : isMat(v) ? v[0][0] : v; return typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : isErr(x) ? x : 0 },
  TRIM: L((x) => trimX(sS(x))),
  LOWER: L((x) => sS(x).toLowerCase()),
  UPPER: L((x) => sS(x).toUpperCase()),
  PROPER: L((x) => properX(sS(x))),
  LEN: L((x) => sS(x).length),
  LEFT: L((x, n) => sS(x).slice(0, n === undefined || n === null ? 1 : Math.max(0, Math.floor(sN(n))))),
  RIGHT: L((x, n) => { const s = sS(x), k = n === undefined || n === null ? 1 : Math.floor(sN(n)); return k <= 0 ? '' : s.slice(-k) }),
  MID: L((x, i, n) => { const s = sS(x), st = Math.floor(sN(i)), k = Math.floor(sN(n)); if (st < 1 || k < 0) return VALUE; return s.substr(st - 1, k) }),
  REPT: L((x, n) => sS(x).repeat(Math.max(0, Math.floor(sN(n))))),
  CHAR: L((n) => String.fromCharCode(Math.floor(sN(n)))),
  SUBSTITUTE: L((x, o, nw, inst) => { const s = sS(x), old = sS(o), neu = sS(nw); if (old === '') return s; if (inst === undefined || inst === null) return s.split(old).join(neu); let k = Math.floor(sN(inst)), i = -1; while (k-- > 0) { i = s.indexOf(old, i + 1); if (i < 0) return s } return s.slice(0, i) + neu + s.slice(i + old.length) }),
  SEARCH: L((f, w, st) => { const i = searchIn(sS(f), sS(w), st === undefined || st === null ? 1 : Math.floor(sN(st)), true); return i < 0 ? VALUE : i }),
  FIND: L((f, w, st) => { const s = sS(w), i = s.indexOf(sS(f), (st === undefined || st === null ? 1 : Math.floor(sN(st))) - 1); return i < 0 ? VALUE : i + 1 }),
  VALUE: L((x) => { if (typeof x === 'number') return x; if (x === null) return 0; const n = parseNum(sS(x)); return n === null ? VALUE : n }),
  TEXT: L((x, f) => { if (isErr(x)) return x; const fm = sS(f); const n = typeof x === 'string' ? parseNum(x) : x; return formatar(n === null ? x : (n as Esc), fm) }),
  FIXED: L((x, d, nc) => fixed(sN(x), d === undefined || d === null ? 2 : Math.floor(sN(d)), !!(nc && toBool(nc) === true))),
  INT: L((x) => Math.floor(sN(x))),
  ABS: L((x) => Math.abs(sN(x))),
  SQRT: L((x) => { const n = sN(x); return n < 0 ? NUM : Math.sqrt(n) }),
  ROUND: L((x, d) => roundX(sN(x), Math.floor(sN(d ?? 0)))),
  DATE: L((y, m, d) => { let yy = Math.floor(sN(y)); if (yy < 1900) yy += 1900; const t = Date.UTC(yy, Math.floor(sN(m)) - 1, Math.floor(sN(d))); return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000) }),
  TIME: L((h, m, s) => { const t = (Math.floor(sN(h)) * 3600 + Math.floor(sN(m)) * 60 + Math.floor(sN(s))) / 86400; return t - Math.floor(t) }),
  DAY: L((x) => dataDe(sN(x)).d),
  MONTH: L((x) => dataDe(sN(x)).m),
  YEAR: L((x) => dataDe(sN(x)).y),
  WEEKDAY: L((x, t) => { const wd = dataDe(sN(x)).wd; const tp = t === undefined || t === null ? 1 : Math.floor(sN(t)); return tp === 2 ? (wd === 0 ? 7 : wd) : tp === 3 ? (wd + 6) % 7 : wd + 1 }),
  EDATE: L((x, m) => { const d = dataDe(sN(x)); const tm = d.m - 1 + Math.floor(sN(m)); const y = d.y + Math.floor(tm / 12), mo = ((tm % 12) + 12) % 12; const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); return serialDe(y, mo + 1, Math.min(d.d, dim))! }),
  CHOOSE: (a, ctx, P) => { const i = Math.floor(num(P, a[0], ctx)); if (i < 1 || i >= a.length) return VALUE; return P.ev(a[i], ctx) },
  ROW: (a, ctx, P) => { if (!a.length || a[0].t === 'empty') return ctx.r; const v = P.ev(a[0], ctx); if (!isRef(v)) throw VALUE; if (v.r1 === v.r2) return v.r1; const out: Mat = []; for (let r = v.r1; r <= v.r2; r++) out.push([r]); return out },
  INDEX: (a, ctx, P) => {
    const v = P.ev(a[0], ctx)
    const rn = a.length > 1 && a[1].t !== 'empty' ? num(P, a[1], ctx) : 0
    const cn = a.length > 2 && a[2].t !== 'empty' ? num(P, a[2], ctx) : 0
    if (isRef(v)) {
      const lim = P.limitar(v)
      const h = v.r2 - v.r1 + 1, w = v.c2 - v.c1 + 1
      let r = Math.floor(rn), c = Math.floor(cn)
      if (h === 1 && a.length === 2) { c = r; r = 1 }
      if (r < 0 || c < 0 || r > h || c > w) return REF
      if (r === 0 && c === 0) return v
      if (r === 0) return mkRef(v.sheet, v.r1, v.c1 + c - 1, v.r2, v.c1 + c - 1)
      if (c === 0) return w === 1 ? mkRef(v.sheet, v.r1 + r - 1, v.c1) : mkRef(v.sheet, v.r1 + r - 1, v.c1, v.r1 + r - 1, v.c2)
      void lim
      return mkRef(v.sheet, v.r1 + r - 1, v.c1 + c - 1)
    }
    const m: Mat = isMat(v) ? v : [[v as Esc]]
    let r = Math.floor(rn), c = Math.floor(cn)
    if (m.length === 1 && a.length === 2) { c = r; r = 1 }
    else if (m[0].length === 1 && a.length === 2) c = 1
    if (r === 0 && c === 0) return m
    if (r === 0) return m.map((l) => [l[c - 1] ?? REF])
    if (c === 0) return [m[r - 1] ?? [REF]]
    return m[r - 1]?.[c - 1] ?? REF
  },
  MATCH: (a, ctx, P) => {
    const look = esc(P, a[0], ctx); const r = P.ev(a[1], ctx)
    const tipo = a.length > 2 && a[2].t !== 'empty' ? num(P, a[2], ctx) : 1
    if (isRef(r) && tipo === 0) { const lr = P.limitar(r); const q = matchIdx(P, look, lr); if (q !== undefined) return q; return matchX(P, look, P.lista(lr), tipo, null) }
    return matchX(P, look, P.lista(r), tipo, null)
  },
  LOOKUP: (a, ctx, P) => {
    const look = esc(P, a[0], ctx); const vec = P.lista(P.ev(a[1], ctx)); const res = a.length > 2 ? P.lista(P.ev(a[2], ctx)) : vec
    let best = -1
    for (let i = 0; i < vec.length; i++) { const v = vec[i]; if (v === null || isErr(v) || typeof v !== typeof look) continue; if (cmp(v, look) <= 0) best = i }
    return best < 0 ? NA : res[best] ?? NA
  },
  OFFSET: (a, ctx, P) => {
    const v = P.ev(a[0], ctx); if (!isRef(v)) throw VALUE
    const dr = Math.floor(num(P, a[1], ctx)), dc = Math.floor(num(P, a[2], ctx))
    const h = a.length > 3 && a[3].t !== 'empty' ? Math.floor(num(P, a[3], ctx)) : v.r2 - v.r1 + 1
    const w = a.length > 4 && a[4].t !== 'empty' ? Math.floor(num(P, a[4], ctx)) : v.c2 - v.c1 + 1
    if (h < 1 || w < 1) return REF
    return mkRef(v.sheet, v.r1 + dr, v.c1 + dc, v.r1 + dr + h - 1, v.c1 + dc + w - 1)
  },
  COUNTIF: (a, ctx, P) => {
    const ca = critArray(P, a, ctx, 0)
    if (ca) return ca.vals.map((l) => l.map((x) => FN.COUNTIFS([a[0], { t: 'empty' }], ctx, P, new Map([[1, x]])) as Esc))
    const r = P.ev(a[0], ctx); const c = esc(P, a[1], ctx)
    if (isRef(r)) { const q = contaIgual(P, r, c); if (q !== null) return q }
    const m = mascara(P, isRef(r) ? r : isMat(r) ? r : [[r as Esc]], c); let n = 0; for (const x of m) n += x; return n
  },
  COUNTIFS: (a, ctx, P, fixo?: Map<number, Esc>) => {
    if (!fixo) { const ca = critArray(P, a, ctx, 0); if (ca) return ca.vals.map((l) => l.map((x) => FN.COUNTIFS(a, ctx, P, new Map([[ca.pos, x]])) as Esc)) }
    const { m } = ifsMask(P, a, ctx, 0, fixo); let n = 0; if (m) for (const x of m) n += x; return n
  },
  AVERAGEIFS: (a, ctx, P) => { const vals = P.plano(P.limitar(P.ev(a[0], ctx) as Ref)); const { m } = ifsMask(P, a, ctx, 1); let s = 0, n = 0; vals.forEach((v, i) => { if (m && m[i] && typeof v === 'number') { s += v; n++ } }); return n ? s / n : DIV0 },
  MAXIFS: (a, ctx, P) => { const vals = P.plano(P.limitar(P.ev(a[0], ctx) as Ref)); const { m } = ifsMask(P, a, ctx, 1); let b = -Infinity; vals.forEach((v, i) => { if (m && m[i] && typeof v === 'number' && v > b) b = v }); return b === -Infinity ? 0 : b },
  MINIFS: (a, ctx, P) => { const vals = P.plano(P.limitar(P.ev(a[0], ctx) as Ref)); const { m } = ifsMask(P, a, ctx, 1); let b = Infinity; vals.forEach((v, i) => { if (m && m[i] && typeof v === 'number' && v < b) b = v }); return b === Infinity ? 0 : b },
  SUM: (a, ctx, P) => nums(P, a, ctx).reduce((s, x) => s + x, 0),
  MIN: (a, ctx, P) => { const n = nums(P, a, ctx); return n.length ? Math.min(...n) : 0 },
  MAX: (a, ctx, P) => { const n = nums(P, a, ctx); return n.length ? Math.max(...n) : 0 },
  COUNT: (a, ctx, P) => { let n = 0; for (const x of a) { if (x.t === 'empty') continue; const v = P.ev(x, ctx); for (const y of P.plano(v)) if (typeof y === 'number') n++ } return n },
  COUNTA: (a, ctx, P) => { let n = 0; for (const x of a) { if (x.t === 'empty') continue; const v = P.ev(x, ctx); for (const y of P.plano(v)) if (y !== null) n++ } return n },
  SMALL: (a, ctx, P) => kth(P, a, ctx, false),
  LARGE: (a, ctx, P) => kth(P, a, ctx, true),
  SUMPRODUCT: (a, ctx, P) => {
    const ms = a.map((n) => { const v = P.arr(P.ev(n, ctx)); return isMat(v) ? v.flat() : [v] })
    const len = ms[0].length; let s = 0
    for (let i = 0; i < len; i++) { let p = 1; for (const m of ms) { const x = m[i]; if (isErr(x)) return x; p *= typeof x === 'number' ? x : 0 } s += p }
    return s
  },
  SLOPE: (a, ctx, P) => { const { xs, ys } = pares(P, a, ctx); const n = xs.length; if (n < 2) return DIV0; const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, x) => s + x, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2 } return sxx === 0 ? DIV0 : sxy / sxx },
  RSQ: (a, ctx, P) => { const { xs, ys } = pares(P, a, ctx); const n = xs.length; if (n < 2) return DIV0; const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, x) => s + x, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 } return sxx === 0 || syy === 0 ? DIV0 : (sxy * sxy) / (sxx * syy) },
}
function pares(P: Pasta, a: Node[], ctx: Ctx) {
  const y = P.plano(P.ev(a[0], ctx)), x = P.plano(P.ev(a[1], ctx)); const xs: number[] = [], ys: number[] = []
  for (let i = 0; i < Math.min(x.length, y.length); i++) { if (isErr(x[i])) throw x[i]; if (isErr(y[i])) throw y[i]; if (typeof x[i] === 'number' && typeof y[i] === 'number') { xs.push(x[i] as number); ys.push(y[i] as number) } }
  return { xs, ys }
}
export { formatar, numTexto, MAXR }
