/** Formas do Excel (retângulos arredondados, caixas de texto ligadas a células) com a mesma geometria, cores e fontes. */
import { CSSProperties } from 'react'
import { cor, fonteCss, ptPx } from './medida'

interface Run { t?: string; sz?: string; b?: string; i?: string; c?: string; font?: string; br?: number }
interface Para { algn?: string | null; runs: Run[]; endsz?: string | null }
export interface FormaSpec { x: number; y: number; w: number; h: number; geom?: string | null; adj?: string | null; fill?: string | null; line?: string | null; lineW?: string | null; shadow?: boolean; textlink?: string; body?: Record<string, string>; paras?: Para[] }

const EMU = 9525
export default function Forma({ s, texto }: { s: FormaSpec; texto?: string }) {
  const adj = s.adj ? +s.adj.replace('val ', '') : 16667
  const raio = s.geom === 'roundRect' ? (Math.min(s.w, s.h) * adj) / 100000 : s.geom === 'ellipse' ? '50%' : 0
  const b = s.body ?? {}
  const ins = (k: string, d: number) => (b[k] !== undefined ? +b[k] / EMU : d)
  const st: CSSProperties = {
    position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, boxSizing: 'border-box',
    background: cor(s.fill ?? null), borderRadius: raio,
    border: s.line && s.line !== 'none' ? `${Math.max(1, (+(s.lineW ?? 9525)) / EMU)}px solid ${cor(s.line)}` : undefined,
    boxShadow: s.shadow ? '0 1.3px 6.7px rgba(15,23,42,0.10)' : undefined,
    padding: `${ins('tIns', 4.8)}px ${ins('rIns', 9.6)}px ${ins('bIns', 4.8)}px ${ins('lIns', 9.6)}px`,
    display: 'flex', flexDirection: 'column', justifyContent: b.anchor === 't' ? 'flex-start' : b.anchor === 'b' ? 'flex-end' : 'center',
    overflow: b.vertOverflow === 'clip' || b.horzOverflow === 'clip' ? 'hidden' : 'visible',
    whiteSpace: b.wrap === 'none' ? 'nowrap' : 'normal', overflowWrap: 'break-word', lineHeight: 1.2, pointerEvents: 'none',
  }
  const paras = s.paras ?? []
  const algn = (a?: string | null) => (a === 'ctr' ? 'center' : a === 'r' ? 'right' : a === 'just' ? 'justify' : 'left')
  const runSt = (r: Run | undefined, endsz?: string | null): CSSProperties => ({
    fontFamily: fonteCss(r?.font), fontSize: ptPx(+(r?.sz ?? endsz ?? 1100) / 100), fontWeight: r?.b === '1' ? 700 : 400, fontStyle: r?.i === '1' ? 'italic' : undefined, color: r?.c ? cor(r.c) : '#000',
  })
  if (s.textlink) {
    const p0 = paras[0]; const r0 = p0?.runs.find((r) => !r.br)
    return <div style={st}><div style={{ textAlign: algn(p0?.algn), ...runSt(r0, p0?.endsz) }}>{texto}</div></div>
  }
  const temTexto = paras.some((p) => p.runs.some((r) => r.t))
  return (
    <div style={st}>
      {temTexto && paras.map((p, i) => (
        <div key={i} style={{ textAlign: algn(p.algn), minHeight: p.runs.length ? undefined : ptPx(+(p.endsz ?? 900) / 100) * 1.2, ...(p.runs.length ? {} : { fontSize: ptPx(+(p.endsz ?? 900) / 100) }) }}>
          {p.runs.map((r, k) => (r.br ? <br key={k} /> : <span key={k} style={runSt(r, p.endsz)}>{r.t}</span>))}
        </div>
      ))}
    </div>
  )
}
