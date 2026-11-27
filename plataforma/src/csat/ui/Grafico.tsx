/** Gráficos do Excel (barras, linhas, dispersão e combinação com eixo secundário) desenhados em SVG a partir da definição do arquivo. */
import { formatar } from '../motor/formato'
import { Esc, isErr } from '../motor/valores'
import { cor, FONTE, largura, ptPx, quebrar } from './medida'

interface Tx { sz?: string | null; b?: string | null; c?: string | null }
interface DL { showVal?: string | null; pos?: string | null; numFmt?: string | null; tx?: Tx | null; delete?: string | null }
interface Ref0 { f?: string | null; fmt?: string | null; lit?: string }
interface Serie { tx?: Ref0 | null; fill?: string | null; line?: { c?: string | null; w?: string | null; dash?: string | null } | null; dLbls?: DL | null; cat?: Ref0 | null; val?: Ref0 | null; marker?: { symbol?: string | null; size?: string | null; fill?: string | null; line?: { c?: string | null } | null }; dPt?: { idx: string | null; fill: string | null }[] }
interface Plot { type: string; barDir?: string | null; gap?: string | null; overlap?: string | null; axIds: string[]; series: Serie[] }
interface Eixo { type: string; id: string; delete?: string | null; pos?: string | null; min?: string | null; max?: string | null; orient?: string | null; numFmt?: string | null; major?: boolean; gridLine?: { c?: string | null } | null; majorUnit?: string | null; tx?: Tx | null; line?: { c?: string | null } | null; crosses?: string | null }
export interface ChartSpec { plots: Plot[]; axes: Eixo[]; legend: { pos?: string | null; tx?: Tx | null } | null }
export interface Fonte { serie: (f: string) => Esc[]; texto: (f: string) => string }

const fsz = (t?: Tx | null, d = 9) => ptPx(t?.sz ? +t.sz / 100 : d)
const num = (v: Esc) => (typeof v === 'number' ? v : null)
function escala(min: number, max: number, fixMin?: number, fixMax?: number, unit?: number) {
  let lo = fixMin ?? Math.min(0, min), hi = fixMax ?? max
  if (fixMax === undefined) {
    if (hi <= lo) hi = lo + 1
    const span = hi - lo
    const u0 = unit ?? (() => { const raw = span / 5; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p })()
    hi = Math.ceil((max + span * 0.05) / u0) * u0
    if (hi <= max) hi += u0
    return { lo, hi, u: u0 }
  }
  const span = hi - lo
  const u = unit ?? (() => { const raw = span / 5; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p })()
  return { lo, hi, u }
}
function txt(x: number, y: number, s: string, t: Tx | null | undefined, anchor: 'start' | 'middle' | 'end', base: 'auto' | 'middle' | 'hanging' = 'auto', cor0?: string, key?: string | number) {
  return <text key={key} x={x} y={y} textAnchor={anchor} dominantBaseline={base} fontFamily={FONTE} fontSize={fsz(t, 9)} fontWeight={t?.b === '1' ? 700 : 400} fill={cor0 ?? (t?.c ? '#' + t.c : '#595959')}>{s}</text>
}

export default function Grafico({ spec, w, h, fonte }: { spec: ChartSpec; w: number; h: number; fonte: Fonte }) {
  const eixo = (id: string) => spec.axes.find((a) => a.id === id)
  const nomeSerie = (s: Serie) => (s.tx?.lit ?? (s.tx?.f ? fonte.texto(s.tx.f) : ''))
  // categorias (do primeiro conjunto que tiver)
  const s0 = spec.plots.flatMap((p) => p.series).find((s) => s.cat?.f)
  const catAx = spec.axes.find((a) => a.type === 'catAx')
  const catsRaw = s0?.cat?.f ? fonte.serie(s0.cat.f) : []
  const scatter = spec.plots[0].type === 'scatterChart'
  const vals = (s: Serie) => (s.val?.f ? fonte.serie(s.val.f) : [])
  const nCat = scatter ? 0 : Math.max(catsRaw.length, ...spec.plots.flatMap((p) => p.series.map((s) => vals(s).length)))
  const catFmt = s0?.cat?.fmt ?? (catAx?.numFmt && catAx.numFmt !== 'General' ? catAx.numFmt : undefined)
  const cats = Array.from({ length: nCat }, (_, i) => { const v = catsRaw[i]; return v === null || v === undefined || isErr(v) ? '' : formatar(v, catFmt ?? (typeof v === 'number' ? 'General' : undefined)) })
  const horizontal = spec.plots.some((p) => p.type === 'barChart' && p.barDir === 'bar')

  const pad = 6
  // margem interna da área de plotagem (o Excel reserva espaço para os rótulos de dados acima dos pontos)
  const temRotTopo = spec.plots.some((q) => q.series.some((s) => s.dLbls?.showVal === '1' && (q.type !== 'barChart' || q.barDir !== 'bar')))
  let top = pad + (temRotTopo ? 14 : 4), bottom = h - pad, left = pad, right = w - pad
  // legenda
  const legItems = spec.legend ? spec.plots.flatMap((p) => p.series.map((s) => ({ nome: nomeSerie(s), s, tipo: p.type }))) : []
  const legH = spec.legend ? fsz(spec.legend.tx, 8.5) + 8 : 0
  if (spec.legend?.pos === 't') top += legH
  if (spec.legend?.pos === 'b') bottom -= legH
  // eixos de valor visíveis
  const valAxes = spec.axes.filter((a) => a.type === 'valAx')
  const primario = valAxes.find((a) => a.id === spec.plots[0].axIds[1]) ?? valAxes[0]
  const secundario = spec.plots.length > 1 ? eixo(spec.plots[1].axIds[1]) : undefined
  const xVal = scatter ? eixo(spec.plots[0].axIds[0]) : undefined
  // dados de cada eixo
  const dadosDe = (axId: string) => spec.plots.filter((p) => p.axIds[1] === axId).flatMap((p) => p.series.flatMap((s) => vals(s).map(num).filter((x): x is number => x !== null)))
  const esc = (a: Eixo | undefined) => {
    if (!a) return { lo: 0, hi: 1, u: 0.25 }
    const d = dadosDe(a.id); const mx = d.length ? Math.max(...d) : 1, mn = d.length ? Math.min(...d) : 0
    return escala(mn, mx, a.min != null ? +a.min : undefined, a.max != null ? +a.max : undefined, a.majorUnit ? +a.majorUnit : undefined)
  }
  const E1 = esc(primario), E2 = secundario ? esc(secundario) : null
  const fmtEixo = (a: Eixo | undefined, v: number) => formatar(v, a?.numFmt && a.numFmt !== 'General' ? a.numFmt : 'General')
  const ticks = (E: { lo: number; hi: number; u: number }) => { const t: number[] = []; for (let v = E.lo; v <= E.hi + E.u * 1e-6; v += E.u) t.push(+v.toFixed(10)); return t }
  const mostra = (a?: Eixo) => !!a && a.delete !== '1'
  const fsCat = fsz(catAx?.tx, 8.5)
  // espaço dos rótulos de valor
  if (!horizontal && mostra(primario)) left += Math.max(...ticks(E1).map((v) => largura(fmtEixo(primario, v), fsz(primario?.tx, 8.5)))) + 6
  if (!horizontal && secundario && mostra(secundario) && E2) right -= Math.max(...ticks(E2).map((v) => largura(fmtEixo(secundario, v), fsz(secundario?.tx, 8.5)))) + 6
  if (scatter && mostra(spec.axes.find((a) => a.id === spec.plots[0].axIds[1]))) { /* já reservado */ }

  // ------- barras horizontais -------
  if (horizontal) {
    const p = spec.plots[0]
    const maxLab = (right - left) * 0.42
    const linhasCat = cats.map((c) => quebrar(c, maxLab, fsCat).slice(0, 3))
    const labW = Math.min(maxLab, Math.max(0, ...linhasCat.flat().map((l) => largura(l, fsCat)))) + 6
    const x0 = left + labW, x1 = right - 4
    const n = Math.max(1, nCat), bandH = (bottom - top) / n
    const gap = +(p.gap ?? 150) / 100, ov = +(p.overlap ?? 0) / 100, ns = p.series.length
    const grpH = bandH / (1 + gap), barH = grpH / (ns - (ns - 1) * ov), step = barH * (1 - ov)
    const maxEsc = E1.hi, minEsc = E1.lo
    const X = (v: number) => x0 + ((v - minEsc) / (maxEsc - minEsc)) * (x1 - x0)
    const ordemInv = catAx?.orient === 'maxMin'
    const els: JSX.Element[] = []
    cats.forEach((_, i) => {
      const idx = ordemInv ? i : n - 1 - i
      const yb = top + idx * bandH + (bandH - grpH) / 2
      const ls = linhasCat[i]; const lh = fsCat * 1.15
      ls.forEach((l, k) => els.push(txt(x0 - 5, top + idx * bandH + bandH / 2 + (k - (ls.length - 1) / 2) * lh, l, catAx?.tx, 'end', 'middle', undefined, `c${i}-${k}`)))
      p.series.forEach((s, j) => {
        const v = num(vals(s)[i] ?? null); if (v === null) return
        const y = yb + j * step
        const fill = s.dPt?.find((d) => +(d.idx ?? -1) === i)?.fill ?? s.fill
        els.push(<rect key={`b${i}-${j}`} x={X(Math.max(minEsc, 0))} y={y} width={Math.max(0, X(v) - X(Math.max(minEsc, 0)))} height={barH} fill={cor(fill)} />)
        if (s.dLbls?.showVal === '1') { const t = formatar(v, s.val?.fmt ?? undefined); if (t) els.push(txt(X(v) + 3, y + barH / 2, t, s.dLbls.tx, 'start', 'middle', undefined, `l${i}-${j}`)) }
      })
    })
    if (catAx?.line?.c && catAx.line.c !== 'none') els.push(<line key="ax" x1={x0} x2={x0} y1={top} y2={bottom} stroke={cor(catAx.line.c)} />)
    return <svg width={w} height={h} style={{ overflow: 'visible' }}>{legenda()}{els}</svg>
  }

  // ------- colunas / linhas / dispersão (eixo X horizontal) -------
  let catLines: string[][] = []
  let x0 = left, x1 = right
  if (!scatter) {
    const bandW0 = (x1 - x0) / Math.max(1, nCat)
    catLines = cats.map((c) => quebrar(c, bandW0 - 2, fsCat))
    const nl = Math.min(3, Math.max(1, ...catLines.map((l) => l.length)))
    bottom -= nl * fsCat * 1.15 + 4
  } else bottom -= fsCat * 1.2 + 4
  const yAx = (E: { lo: number; hi: number }) => (v: number) => bottom - ((v - E.lo) / (E.hi - E.lo)) * (bottom - top)
  const Y1 = yAx(E1), Y2 = E2 ? yAx(E2) : Y1
  const els: JSX.Element[] = []
  // grades
  const gradeAx = [primario, secundario].find((a) => a?.major)
  if (gradeAx) { const E = gradeAx === secundario && E2 ? E2 : E1; const Y = gradeAx === secundario ? Y2 : Y1; ticks(E).forEach((v, i) => els.push(<line key={'g' + i} x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={cor(gradeAx.gridLine?.c ?? 'D9D9D9')} strokeWidth={0.75} />)) }
  if (mostra(primario) && !scatter) ticks(E1).forEach((v, i) => els.push(txt(x0 - 4, Y1(v), fmtEixo(primario, v), primario?.tx, 'end', 'middle', undefined, 'yl' + i)))
  if (secundario && E2 && mostra(secundario)) ticks(E2).forEach((v, i) => els.push(txt(x1 + 4, Y2(v), fmtEixo(secundario, v), secundario.tx, 'start', 'middle', undefined, 'yr' + i)))
  // eixo X
  let X: (i: number) => number
  if (scatter) {
    const xs = spec.plots[0].series.flatMap((s) => { const xv = s.cat?.f ? fonte.serie(s.cat.f) : []; const yv = vals(s); return xv.map((x, i) => (num(yv[i] ?? null) !== null ? num(x) : null)).filter((x): x is number => x !== null) })
    const u = xVal?.majorUnit ? +xVal.majorUnit : 1
    const lo = xs.length ? Math.floor(Math.min(...xs) / u) * u : 0, hi = xs.length ? Math.max(lo + u, Math.ceil(Math.max(...xs) / u) * u) : u
    const Ys = spec.axes.find((a) => a.id === spec.plots[0].axIds[1])
    if (mostra(Ys)) { const wl = Math.max(...ticks(E1).map((v) => largura(fmtEixo(Ys, v), fsz(Ys?.tx, 8.5)))) + 6; x0 = left + wl; ticks(E1).forEach((v, i) => els.push(txt(x0 - 4, Y1(v), fmtEixo(Ys, v), Ys?.tx, 'end', 'middle', undefined, 'sy' + i))) }
    if (gradeAx) { els.length = 0; ticks(E1).forEach((v, i) => els.push(<line key={'g' + i} x1={x0} x2={x1} y1={Y1(v)} y2={Y1(v)} stroke={cor(gradeAx.gridLine?.c ?? 'D9D9D9')} strokeWidth={0.75} />)); if (mostra(Ys)) ticks(E1).forEach((v, i) => els.push(txt(x0 - 4, Y1(v), fmtEixo(Ys, v), Ys?.tx, 'end', 'middle', undefined, 'sy' + i))) }
    const XS = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0)
    for (let v = lo; v <= hi + 1e-9; v += u) els.push(txt(XS(v), bottom + 4, formatar(v, xVal?.numFmt ?? 'General'), xVal?.tx, 'middle', 'hanging', undefined, 'x' + v))
    if (xVal?.line?.c && xVal.line.c !== 'none') els.push(<line key="xa" x1={x0} x2={x1} y1={bottom} y2={bottom} stroke={cor(xVal.line.c)} />)
    spec.plots[0].series.forEach((s, j) => {
      const xv = s.cat?.f ? fonte.serie(s.cat.f) : []; const yv = vals(s)
      const pts = xv.map((x, i) => ({ x: num(x), y: num(yv[i] ?? null) })).filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null)
      desenhaLinha(els, s, pts.map((p) => [XS(p.x), Y1(p.y), p.y]), 'sc' + j)
    })
    return <svg width={w} height={h} style={{ overflow: 'visible' }}>{legenda()}{els}</svg>
  }
  const bandW = (x1 - x0) / Math.max(1, nCat)
  X = (i: number) => x0 + bandW * (i + 0.5)
  // barras
  for (const p of spec.plots.filter((q) => q.type === 'barChart')) {
    const Y = p.axIds[1] === secundario?.id ? Y2 : Y1, E = p.axIds[1] === secundario?.id && E2 ? E2 : E1
    const gap = +(p.gap ?? 150) / 100, ov = +(p.overlap ?? 0) / 100, ns = p.series.length
    const grpW = bandW / (1 + gap), barW = grpW / (ns - (ns - 1) * ov), step = barW * (1 - ov)
    p.series.forEach((s, j) => vals(s).forEach((v0, i) => {
      const v = num(v0); if (v === null) return
      const xb = x0 + i * bandW + (bandW - grpW) / 2 + j * step
      const base = Y(Math.max(E.lo, 0))
      const fill = s.dPt?.find((d) => +(d.idx ?? -1) === i)?.fill ?? s.fill
      els.push(<rect key={`b${j}-${i}`} x={xb} y={Math.min(Y(v), base)} width={barW} height={Math.abs(base - Y(v))} fill={cor(fill)} />)
      if (s.dLbls?.showVal === '1') { const t = formatar(v, s.val?.fmt ?? undefined); if (t) els.push(txt(xb + barW / 2, Y(v) - 3, t, s.dLbls.tx, 'middle', 'auto', undefined, `bl${j}-${i}`)) }
    }))
  }
  // linhas
  for (const p of spec.plots.filter((q) => q.type === 'lineChart')) {
    const Y = p.axIds[1] === secundario?.id ? Y2 : Y1
    p.series.forEach((s, j) => { const pts = vals(s).map((v, i) => [X(i), num(v)] as const).filter((q): q is readonly [number, number] => q[1] !== null).map((q) => [q[0], Y(q[1]), q[1]] as [number, number, number]); desenhaLinha(els, s, pts, `ln${p.axIds[1]}-${j}`) })
  }
  // eixo de categorias
  if (catAx?.line?.c && catAx.line.c !== 'none') els.push(<line key="ca" x1={x0} x2={x1} y1={bottom} y2={bottom} stroke={cor(catAx.line.c)} />)
  catLines.forEach((ls, i) => ls.slice(0, 3).forEach((l, k) => els.push(txt(X(i), bottom + 4 + k * fsCat * 1.15, l, catAx?.tx, 'middle', 'hanging', undefined, `ct${i}-${k}`))))
  return <svg width={w} height={h} style={{ overflow: 'visible' }}>{legenda()}{els}</svg>

  function desenhaLinha(out: JSX.Element[], s: Serie, pts: [number, number, number][], key: string) {
    const lc = s.line?.c && s.line.c !== 'none' ? s.line.c : null
    const lw = s.line?.w ? +s.line.w / 12700 * 4 / 3 : 2
    if (lc && pts.length > 1) out.push(<polyline key={key + 'l'} points={pts.map((p) => p[0] + ',' + p[1]).join(' ')} fill="none" stroke={cor(lc)} strokeWidth={lw} strokeDasharray={s.line?.dash && s.line.dash !== 'solid' ? `${lw * 3},${lw * 2}` : undefined} strokeLinejoin="round" />)
    const mk = s.marker; const r = mk?.size ? (+mk.size * 4) / 3 / 2 : 3
    pts.forEach((p, i) => {
      if (mk && mk.symbol !== 'none') out.push(<circle key={key + 'm' + i} cx={p[0]} cy={p[1]} r={r} fill={cor(mk.fill ?? lc)} stroke={cor(mk.line?.c ?? mk.fill ?? lc)} strokeWidth={1} />)
      if (s.dLbls?.showVal === '1') { const t = formatar(p[2], s.val?.fmt ?? undefined); if (t) out.push(txt(p[0], p[1] - r - 3, t, s.dLbls.tx, 'middle', 'auto', undefined, key + 't' + i)) }
    })
  }
  function legenda() {
    if (!spec.legend || !legItems.length) return null
    const fs = fsz(spec.legend.tx, 8.5)
    const items = legItems.map((it) => ({ ...it, w: 14 + 4 + largura(it.nome, fs) + 14 }))
    const tot = items.reduce((a, b) => a + b.w, 0)
    let x = (w - tot) / 2; const y = spec.legend.pos === 'b' ? h - pad - fs / 2 - 2 : pad + fs / 2 + 2
    return <g>{items.map((it, i) => { const x0l = x; x += it.w; const c = it.tipo === 'lineChart' ? it.s.line?.c : it.s.fill
      return <g key={'lg' + i}>{it.tipo === 'lineChart' ? <><line x1={x0l} x2={x0l + 14} y1={y} y2={y} stroke={cor(c)} strokeWidth={2} strokeDasharray={it.s.line?.dash && it.s.line.dash !== 'solid' ? '4,3' : undefined} />{it.s.marker && <circle cx={x0l + 7} cy={y} r={3} fill={cor(it.s.marker.fill ?? c)} />}</> : <rect x={x0l + 2} y={y - 4} width={9} height={9} fill={cor(c)} />}{txt(x0l + 18, y, it.nome, spec.legend!.tx, 'start', 'middle')}</g> })}</g>
  }
}
