/** Uma aba da planilha desenhada como no Excel: grade de células (larguras, alturas, mesclagens, estilos, formatação condicional),
 *  formas, imagens e gráficos nas posições do arquivo, painéis congelados e listas suspensas (validação de dados). */
import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pasta } from '../motor/pasta'
import { formatar } from '../motor/formato'
import { parse, Node } from '../motor/parser'
import { cmp, dataDe, Esc, isErr, isRef, serialDe, toStr } from '../motor/valores'
import Forma, { FormaSpec } from './Forma'
import Grafico, { ChartSpec } from './Grafico'
import { cor, fonteCss, largura, ptPx } from './medida'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Estilo { fn?: string; fs?: number; b?: 1; i?: 1; u?: 1; fc?: string; bg?: string; bl?: [string, string]; br?: [string, string]; bt?: [string, string]; bb?: [string, string]; h?: string; v?: string; w?: 1; ind?: number; rot?: number; nf?: string }
export interface FolhaModelo {
  cols: number[]; hiddenCols: number[]; rows: Record<string, number>; hiddenRows: number[]; defRow: number; maxRow: number; maxCol: number
  merges: [number, number, number, number][]; cells: Record<string, any[]>; dv: { sqref: string; type: string; f1: string }[]
  cf: any[]; drawings: any[]; freeze: string | null; zoom: number | null; rowTemplate?: Record<string, number>; dataRowHeight?: number
}
export interface ModeloUI { sheets: Record<string, FolhaModelo>; styles: Estilo[] }

const colNum = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n }
function faixa(a: string): [number, number, number, number] {
  const m = a.replace(/\$/g, '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/)!
  const c1 = colNum(m[1]), r1 = +m[2], c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1
  return [r1, c1, r2, c2]
}
const BORDA: Record<string, string> = { thin: '1px solid', medium: '2px solid', thick: '3px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', mediumDashed: '2px dashed', double: '3px double', dashDot: '1px dashed', mediumDashDot: '2px dashed', slantDashDot: '2px dashed', dashDotDot: '1px dotted' }
const bd = (b?: [string, string]) => (b ? `${BORDA[b[0]] ?? '1px solid'} #${b[1]}` : undefined)

/** Avalia uma fórmula de formatação condicional/validação relativa à célula (desloca as referências relativas). */
function deslocar(n: Node, dr: number, dc: number): Node {
  switch (n.t) {
    case 'cell': return { ...n, r: n.ar ? n.r : n.r + dr, c: n.ac ? n.c : n.c + dc }
    case 'area': return { ...n, r1: n.ar1 ? n.r1 : n.r1 + dr, c1: n.ac1 ? n.c1 : n.c1 + dc, r2: n.ar2 ? n.r2 : n.r2 + dr, c2: n.ac2 ? n.c2 : n.c2 + dc }
    case 'fn': return { ...n, args: n.args.map((a) => deslocar(a, dr, dc)) }
    case 'bin': return { ...n, a: deslocar(n.a, dr, dc), b: deslocar(n.b, dr, dc) }
    case 'un': case 'pct': return { ...n, a: deslocar(n.a, dr, dc) }
    default: return n
  }
}

export interface FolhaProps {
  modelo: ModeloUI; nome: string; pasta: Pasta; versao: number
  zoom: number | 'ajustar'; larguraAjuste?: number
  onNav: (aba: string) => void
  onEntrada: (sheet: string, r: number, c: number, v: Esc) => void
  editavel?: (r: number, c: number) => boolean
  onEditar?: (r: number, c: number, v: string) => void
  imagem: (nome: string) => string
  congelar?: [number, number]   // [linhas, colunas] — substitui o congelamento do arquivo
  linhasDados?: number
}
const NAV: Record<string, string> = { 'painel': 'Dashboard', 'análise detalhada': 'Análise Detalhada', 'evolução': 'Evolução', 'comentários': 'Comentários', 'base de dados': 'Base de Dados', 'hierarquia': 'Hierarquia', 'regras': 'Regras', 'dicionário': 'Dicionário' }
export function destinoNav(t: string): string | null { const k = t.replace(/^[^A-Za-zÀ-ÿ]+/, '').trim().toLowerCase(); return NAV[k] ?? null }

export default function Folha(p: FolhaProps) {
  const { modelo, nome, pasta } = p
  const fm = modelo.sheets[nome]
  const S = modelo.styles
  const scrollRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null), leftRef = useRef<HTMLDivElement>(null), cornerRef = useRef<HTMLDivElement>(null), picRef = useRef<HTMLDivElement>(null)
  const [vista, setVista] = useState({ top: 0, h: 1200, w: 1600 })
  const [edit, setEdit] = useState<{ r: number; c: number; v: string } | null>(null)

  // ---------- geometria ----------
  const maxRow = p.linhasDados !== undefined ? Math.max(fm.maxRow, 4 + p.linhasDados) : fm.maxRow
  const maxCol = fm.maxCol
  const geo = useMemo(() => {
    const hid = new Set(fm.hiddenCols)
    const cw = [0]; for (let c = 1; c <= maxCol; c++) cw.push(hid.has(c) ? 0 : fm.cols[c - 1] ?? 64)
    const colX = [0, 0]; for (let c = 1; c <= maxCol; c++) colX.push(colX[c] + cw[c])
    const hidR = new Set(fm.hiddenRows)
    const rowY = [0, 0]; const rh = [0]
    for (let r = 1; r <= maxRow; r++) { const hh = hidR.has(r) ? 0 : fm.rows[r] ?? (r > fm.maxRow && fm.dataRowHeight ? fm.dataRowHeight : fm.defRow); rh.push(hh); rowY.push(rowY[r] + hh) }
    return { cw, colX, rh, rowY, W: colX[maxCol + 1], H: rowY[maxRow + 1] }
  }, [fm, maxRow, maxCol])
  const { colX, rowY, cw, rh } = geo
  // área de desenho: células + formas
  const extW = Math.max(geo.W, ...fm.drawings.map((d) => (d.x ?? 0) + (d.w ?? 0) + 10))
  const extH = Math.max(geo.H, ...fm.drawings.map((d) => (d.y ?? 0) + (d.h ?? 0) + 10))

  // ---------- zoom ----------
  const [largCont, setLargCont] = useState(1200)
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return
    const ro = new ResizeObserver(() => { setLargCont(el.clientWidth); setVista((v) => ({ ...v, h: el.clientHeight, w: el.clientWidth })) })
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const z = p.zoom === 'ajustar' ? Math.min(1.25, Math.max(0.3, (largCont - 4) / (p.larguraAjuste ?? extW))) : p.zoom

  // ---------- congelamento ----------
  const [frR, frC] = useMemo<[number, number]>(() => {
    if (p.congelar) return p.congelar
    if (!fm.freeze) return [0, 0]
    const [r, c] = faixa(fm.freeze); return [r - 1, c - 1]
  }, [fm.freeze, p.congelar])
  const frW = colX[frC + 1] ?? 0, frH = rowY[frR + 1] ?? 0
  const onScroll = () => {
    const el = scrollRef.current!; const sl = el.scrollLeft / z, stp = el.scrollTop / z
    if (topRef.current) topRef.current.style.transform = `translateY(${stp}px)`
    if (leftRef.current) leftRef.current.style.transform = `translateX(${sl}px)`
    if (picRef.current) picRef.current.style.transform = `translateX(${sl}px)`
    if (cornerRef.current) cornerRef.current.style.transform = `translate(${sl}px, ${stp}px)`
    if (maxRow > 400) setVista((v) => (Math.abs(v.top - stp) > 100 ? { ...v, top: stp } : v))
  }

  // ---------- mesclagens ----------
  const merges = useMemo(() => {
    const ini = new Map<string, [number, number, number, number]>(), dentro = new Set<string>()
    for (const m of fm.merges) { ini.set(m[0] + ',' + m[1], m); for (let r = m[0]; r <= m[2]; r++) for (let c = m[1]; c <= m[3]; c++) if (r !== m[0] || c !== m[1]) dentro.add(r + ',' + c) }
    return { ini, dentro }
  }, [fm])

  // ---------- validação de dados (listas e datas) ----------
  const dvs = useMemo(() => fm.dv.flatMap((d) => d.sqref.split(' ').map((a) => ({ ...d, f: faixa(a) }))), [fm])
  const dvDe = (r: number, c: number) => dvs.find((d) => r >= d.f[0] && r <= d.f[2] && c >= d.f[1] && c <= d.f[3])
  const opcoes = (f1: string): string[] => {
    if (f1.startsWith('"')) return f1.slice(1, -1).split(',')
    try { const v = pasta.ev(parse(f1), { sheet: nome, r: 1, c: 1 }); if (isRef(v)) return pasta.plano(v).filter((x) => x !== null && x !== '').map((x) => toStr(x as Esc) as string) } catch { /* lista indisponível */ }
    return []
  }

  // ---------- formatação condicional ----------
  const cfs = useMemo(() => fm.cf.map((r) => ({ ...r, faixas: String(r.sqref).split(' ').map(faixa), ast: r.f?.[0] ? (() => { try { return parse(r.f[0]) } catch { return null } })() : null })).sort((a, b) => a.pri - b.pri), [fm])
  const estatCF = useMemo(() => {
    const m = new Map<number, number[]>()
    cfs.forEach((r, i) => {
      if (!r.cs && !r.db) return
      const ns: number[] = []
      for (const [r1, c1, r2, c2] of r.faixas) for (let rr = r1; rr <= Math.min(r2, maxRow); rr++) for (let cc = c1; cc <= c2; cc++) { const v = pasta.valor(nome, rr, cc); if (typeof v === 'number') ns.push(v) }
      m.set(i, ns.sort((a, b) => a - b))
    })
    return m
  }, [cfs, p.versao, nome, maxRow])   // eslint-disable-line react-hooks/exhaustive-deps
  function cfDe(r: number, c: number, v: Esc): { bg?: string; fc?: string; b?: boolean; barra?: { pct: number; cor: string } } {
    const out: { bg?: string; fc?: string; b?: boolean; barra?: { pct: number; cor: string } } = {}
    cfs.forEach((rule, i) => {
      const fx = rule.faixas.find(([r1, c1, r2, c2]: number[]) => r >= r1 && r <= r2 && c >= c1 && c <= c2); if (!fx) return
      if (rule.type === 'cellIs') {
        const lim = Number(rule.f?.[0]); if (typeof v !== 'number') return
        const ok = rule.op === 'lessThan' ? v < lim : rule.op === 'greaterThan' ? v > lim : rule.op === 'equal' ? v === lim : rule.op === 'greaterThanOrEqual' ? v >= lim : rule.op === 'lessThanOrEqual' ? v <= lim : false
        if (ok) { if (rule.fc && !out.fc) out.fc = rule.fc; if (rule.b) out.b = true; if (rule.bg && !out.bg) out.bg = rule.bg }
      } else if (rule.type === 'expression' && rule.ast) {
        const [r1, c1] = rule.faixas[0]
        let res: Esc
        try { res = pasta.escalar(pasta.ev(deslocar(rule.ast, r - r1, c - c1), { sheet: nome, r, c }), { sheet: nome, r, c }) } catch { res = false }
        if (res === true || (typeof res === 'number' && res !== 0)) { if (rule.fc && !out.fc) out.fc = rule.fc; if (rule.b) out.b = true; if (rule.bg && !out.bg) out.bg = rule.bg }
      } else if ((rule.cs || rule.db) && typeof v === 'number') {
        const ns = estatCF.get(i) ?? []; if (!ns.length) return
        const val = (cf: [string, number | null]) => cf[0] === 'min' ? ns[0] : cf[0] === 'max' ? ns[ns.length - 1] : cf[0] === 'percentile' ? pctl(ns, Number(cf[1])) : cf[0] === 'percent' ? ns[0] + (ns[ns.length - 1] - ns[0]) * Number(cf[1]) / 100 : Number(cf[1])
        if (rule.cs) {
          const pts = rule.cs.cfvo.map(val); const cols = rule.cs.colors as string[]
          let k = 0; while (k < pts.length - 2 && v > pts[k + 1]) k++
          const a = pts[k], b = pts[k + 1], t = b === a ? 1 : Math.max(0, Math.min(1, (v - a) / (b - a)))
          if (!out.bg) out.bg = mistura(cols[k], cols[k + 1], v <= pts[0] ? 0 : v >= pts[pts.length - 1] ? 1 : t)
        } else {
          const a = val(rule.db.cfvo[0]), b = val(rule.db.cfvo[1])
          out.barra = { pct: b === a ? 1 : Math.max(0, Math.min(1, (v - a) / (b - a))), cor: rule.db.color }
        }
      }
    })
    return out
  }

  // ---------- células ----------
  const valorCel = (r: number, c: number): Esc => pasta.valor(nome, r, c)
  const estiloDe = (r: number, c: number): Estilo => {
    const e = fm.cells[r + ',' + c]
    if (e) return S[e[0]] ?? {}
    if (r > fm.maxRow && fm.rowTemplate) { const t = fm.rowTemplate[c]; return t !== undefined ? S[t] : {} }
    return {}
  }
  const temConteudo = (r: number, c: number) => { if (r <= fm.maxRow && !fm.cells[r + ',' + c]) return false; const v = pasta.valor(nome, r, c); return v !== null && v !== '' }

  function celula(r: number, c: number, key: string): [ReactNode, ReactNode] | null {
    const k = r + ',' + c
    if (merges.dentro.has(k)) return null
    const e = fm.cells[k]
    const st = estiloDe(r, c)
    const v = (e || r > fm.maxRow) ? valorCel(r, c) : null
    const m = merges.ini.get(k)
    const r2 = m ? m[2] : r, c2 = m ? m[3] : c
    const x = colX[c], y = rowY[r], w = colX[c2 + 1] - x, h = rowY[r2 + 1] - y
    if (w <= 0 || h <= 0) return null
    const cf = v !== null || st.bg || fm.cf.length ? cfDe(r, c, v) : {}
    const stR = m ? estiloDe(r, c2) : st, stB = m ? estiloDe(r2, c) : st
    const bg = cf.bg ?? st.bg
    const txt = v === null ? '' : formatar(v, st.nf)
    const hAlign = st.h === 'center' || st.h === 'centerContinuous' ? 'center' : st.h === 'right' ? 'right' : st.h === 'left' ? 'left' : st.h === 'justify' ? 'left' : typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left'
    const vAlign = st.v === 'center' ? 'center' : st.v === 'top' ? 'flex-start' : 'flex-end'
    const fs = ptPx(st.fs ?? 11)
    // transbordo do texto para as células vazias ao lado (como no Excel)
    let tw = w, tx = 0
    if (txt && !st.w && !m && typeof v === 'string') {
      const need = largura(txt, fs, !!st.b, st.fn) + 6
      if (need > w) {
        if (hAlign === 'left') { let cc = c + 1; while (tw < need && cc <= maxCol && !temConteudo(r, cc)) { tw += cw[cc]; cc++ } }
        else if (hAlign === 'right') { let cc = c - 1; while (tw < need && cc >= 1 && !temConteudo(r, cc)) { tw += cw[cc]; tx -= cw[cc]; cc-- } }
        else { let a = c - 1, b2 = c + 1; while (tw < need && (a >= 1 || b2 <= maxCol)) { const okA = a >= 1 && !temConteudo(r, a), okB = b2 <= maxCol && !temConteudo(r, b2); if (!okA && !okB) break; if (okA) { tw += cw[a]; tx -= cw[a]; a-- } if (okB) { tw += cw[b2]; b2++ } } }
      }
    }
    const nav = typeof v === 'string' && c <= 15 && r <= 30 ? destinoNav(v) : null
    const dv = dvDe(r, c)
    const sobra = bg && !stR.br && !stB.bb ? 0.6 : 0   // evita frestas entre células de fundo quando há zoom
    const css: CSSProperties = { position: 'absolute', left: x, top: y, width: w + sobra, height: h + sobra, background: bg ? '#' + bg : undefined, borderLeft: bd(st.bl), borderTop: bd(st.bt), borderRight: bd(stR.br), borderBottom: bd(stB.bb), boxSizing: 'border-box' }
    const tcss: CSSProperties = { position: 'absolute', left: tx, top: 0, width: tw, height: '100%', display: 'flex', alignItems: vAlign, justifyContent: hAlign === 'center' ? 'center' : hAlign === 'right' ? 'flex-end' : 'flex-start', padding: `0 ${3 + (hAlign === 'right' ? (st.ind ?? 0) * 9 : 0)}px 1px ${3 + (hAlign === 'left' ? (st.ind ?? 0) * 9 : 0)}px`, boxSizing: 'border-box', overflow: 'hidden',
      fontFamily: fonteCss(st.fn ?? 'Calibri'), fontSize: fs, fontWeight: cf.b || st.b ? 700 : 400, fontStyle: st.i ? 'italic' : undefined, textDecoration: st.u ? 'underline' : undefined, color: cf.fc ? '#' + cf.fc : st.fc ? '#' + st.fc : '#000', whiteSpace: st.w ? 'pre-wrap' : 'pre', lineHeight: 1.15, textAlign: hAlign as any, wordBreak: st.w ? 'break-word' : undefined }
    const podeEditar = !dv && p.editavel?.(r, c)
    const fundo = (
      <div key={key} style={{ ...css, cursor: nav || dv || podeEditar ? 'pointer' : undefined }} onClick={nav ? () => p.onNav(nav) : undefined} onDoubleClick={podeEditar ? () => setEdit({ r, c, v: v === null ? '' : String(v) }) : undefined} title={podeEditar ? 'Clique duas vezes para editar' : undefined}>
        {cf.barra && <div style={{ position: 'absolute', left: 2, top: 2, bottom: 2, width: `calc(${cf.barra.pct * 100}% - 4px)`, background: `linear-gradient(90deg, #${cf.barra.cor}, #${cf.barra.cor}22)` }} />}
      </div>
    )
    const texto = txt !== '' || dv ? (
      <div key={key + 't'} style={{ position: 'absolute', left: x, top: y, width: w, height: h, pointerEvents: nav || dv || podeEditar ? 'auto' : 'none', cursor: nav || dv || podeEditar ? 'pointer' : undefined }} onClick={nav ? () => p.onNav(nav) : undefined} onDoubleClick={podeEditar ? () => setEdit({ r, c, v: v === null ? '' : String(v) }) : undefined}>
        {txt !== '' && <div style={tcss}>{st.w ? <span style={{ width: '100%' }}>{txt}</span> : txt}</div>}
        {dv && <Entrada dv={dv} v={v} opcoes={dv.type === 'list' ? opcoes(dv.f1) : []} onChange={(nv) => p.onEntrada(nome, r, c, nv)} />}
      </div>
    ) : null
    return [fundo, texto]
  }

  // linhas a desenhar (virtualização para abas grandes)
  const linhas = useMemo(() => {
    if (maxRow <= 400) return Array.from({ length: maxRow }, (_, i) => i + 1)
    const ini = Math.max(frR + 1, lbRow(rowY, vista.top) - 20), fim = Math.min(maxRow, lbRow(rowY, vista.top + vista.h / z) + 40)
    const out: number[] = []; for (let r = ini; r <= fim; r++) out.push(r); return out
  }, [maxRow, vista, z, rowY, frR])
  const colunasComCelula = useMemo(() => { const m = new Map<number, number[]>(); for (const k of Object.keys(fm.cells)) { const [r, c] = k.split(',').map(Number); let a = m.get(r); if (!a) { a = []; m.set(r, a) } a.push(c) } return m }, [fm])
  const colsDados = useMemo(() => { const s = new Set<number>(Object.keys(fm.rowTemplate ?? {}).map(Number)); for (let c = 1; c <= maxCol; c++) s.add(c); return [...s] }, [fm, maxCol])
  const celsDaLinha = (r: number) => (r > fm.maxRow ? colsDados : colunasComCelula.get(r) ?? [])

  void p.versao
  const camadas = { corpo: [[], []], topo: [[], []], esq: [[], []], canto: [[], []] } as Record<string, [ReactNode[], ReactNode[]]>
  const rowsTop = Array.from({ length: frR }, (_, i) => i + 1)
  for (const r of [...rowsTop, ...linhas.filter((x) => x > frR)]) for (const c of celsDaLinha(r)) {
    if (c > maxCol) continue
    const el = celula(r, c, r + ',' + c); if (!el) continue
    const alvo = r <= frR && c <= frC ? 'canto' : r <= frR ? 'topo' : c <= frC ? 'esq' : 'corpo'
    camadas[alvo][0].push(el[0]); if (el[1]) camadas[alvo][1].push(el[1])
  }
  const corpo = [...camadas.corpo[0], ...camadas.corpo[1]], topo = [...camadas.topo[0], ...camadas.topo[1]], esq = [...camadas.esq[0], ...camadas.esq[1]], canto = [...camadas.canto[0], ...camadas.canto[1]]
  // desenhos
  const fonteGraf = { serie: (f: string) => { try { const v = pasta.ev(parse(f), { sheet: nome, r: 1, c: 1 }); return isRef(v) ? pasta.plano(v) : [] } catch { return [] } }, texto: (f: string) => { try { const v = pasta.escalar(pasta.ev(parse(f), { sheet: nome, r: 1, c: 1 }), { sheet: nome, r: 1, c: 1 }); return v === null ? '' : formatar(v) } catch { return '' } } }
  const desenhos: ReactNode[] = [], desenhosEsq: ReactNode[] = []
  fm.drawings.forEach((d, i) => {
    let x = d.x, y = d.y
    if (x === undefined && d.from) { x = colX[d.from[0] + 1] + d.from[1]; y = rowY[d.from[2] + 1] + d.from[3] }
    let w = d.w, h = d.h
    if ((w === undefined || h === undefined) && d.to) { w = colX[d.to[0] + 1] + d.to[1] - x; h = rowY[d.to[2] + 1] + d.to[3] - y }
    const alvo = d.from && d.from[0] < frC ? desenhosEsq : desenhos
    if (d.kind === 'pic') alvo.push(<img key={'d' + i} src={p.imagem(d.image)} alt="" style={{ position: 'absolute', left: x, top: y, width: w, height: h, pointerEvents: 'none' }} />)
    else if (d.kind === 'graphicFrame' && d.chartSpec) desenhos.push(<div key={'d' + i} style={{ position: 'absolute', left: x, top: y, width: w, height: h }}><Grafico spec={d.chartSpec as ChartSpec} w={w} h={h} fonte={fonteGraf} /></div>)
    else if (d.kind === 'sp') {
      let texto: string | undefined
      if (d.textlink) { const [r0, c0] = faixa(d.textlink); const v = pasta.valor(nome, r0, c0); const e = fm.cells[r0 + ',' + c0]; texto = v === null ? '' : formatar(v, e ? S[e[0]]?.nf : undefined) }
      desenhos.push(<Forma key={'d' + i} s={{ ...(d as FormaSpec), x, y, w, h }} texto={texto} />)
    }
  })

  const fundoGrade = (c: number) => (c <= frC ? '#fff' : undefined)
  void fundoGrade
  return (
    <div ref={scrollRef} onScroll={onScroll} className="relative h-full w-full overflow-auto bg-white" style={{ contain: 'strict' }}>
      <div style={{ width: extW * z, height: extH * z, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: extW, height: extH, transform: `scale(${z})`, transformOrigin: '0 0' }}>
          {corpo}
          {desenhos}
          {frC > 0 && <div ref={leftRef} style={{ position: 'absolute', left: 0, top: 0, width: frW, height: extH, background: '#fff', zIndex: 2, boxShadow: '1px 0 0 #d4d4d8' }}>{esq}</div>}
          {frC > 0 && <div ref={picRef} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: 5 }}>{desenhosEsq}</div>}
          {frR > 0 && <div ref={topRef} style={{ position: 'absolute', left: 0, top: 0, width: extW, height: frH, background: '#fff', zIndex: 3, boxShadow: '0 1px 0 #d4d4d8' }}>{topo}</div>}
          {frR > 0 && frC > 0 && <div ref={cornerRef} style={{ position: 'absolute', left: 0, top: 0, width: frW, height: frH, background: '#fff', zIndex: 4 }}>{canto}</div>}
          {frC === 0 && desenhosEsq}
          {edit && (
            <input autoFocus defaultValue={edit.v} style={{ position: 'absolute', left: colX[edit.c], top: rowY[edit.r], width: Math.max(160, cw[edit.c]), height: rh[edit.r], zIndex: 10, font: '14px system-ui', border: '2px solid #217346', padding: '0 3px' }}
              onBlur={(e) => { p.onEditar?.(edit.r, edit.c, e.target.value); setEdit(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }} />
          )}
        </div>
      </div>
    </div>
  )
}

function Entrada({ dv, v, opcoes, onChange }: { dv: { type: string }; v: Esc; opcoes: string[]; onChange: (v: Esc) => void }) {
  const base: CSSProperties = { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }
  if (dv.type === 'date') {
    const iso = typeof v === 'number' ? (() => { const d = dataDe(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` })() : ''
    return <input type="date" style={base} value={iso} onChange={(e) => { const s = e.target.value; if (!s) return onChange(null); const [y, m, d] = s.split('-').map(Number); onChange(serialDe(y, m, d)) }} onClick={(e) => { try { (e.target as HTMLInputElement).showPicker?.() } catch { /* sem seletor */ } }} aria-label="Data" />
  }
  const atual = v === null ? '' : String(toStr(v))
  const lista = opcoes.includes(atual) || atual === '' ? opcoes : [atual, ...opcoes]
  return (
    <select style={base} value={atual} onChange={(e) => { const s = e.target.value; const n = Number(s); onChange(s !== '' && !isNaN(n) && /^\d+$/.test(s) ? n : s) }} aria-label="Filtro">
      {lista.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
function pctl(ns: number[], p: number) { if (!ns.length) return 0; const k = (ns.length - 1) * p / 100; const f = Math.floor(k), c = Math.ceil(k); return ns[f] + (ns[c] - ns[f]) * (k - f) }
function mistura(a: string, b: string, t: number) { const h = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16); const m = (i: number) => Math.round(h(a, i) + (h(b, i) - h(a, i)) * t).toString(16).padStart(2, '0'); return (m(0) + m(2) + m(4)).toUpperCase() }
function lbRow(rowY: number[], y: number) { let l = 1, h = rowY.length - 1; while (l < h) { const m = (l + h) >> 1; if (rowY[m + 1] <= y) l = m + 1; else h = m } return l }
export { cor, cmp }
