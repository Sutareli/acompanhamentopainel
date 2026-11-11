import { useEffect, useRef, useState } from 'react'
import { Barra, pareto } from '../lib/chamados'

function quebra(t: string, max = 13, linhas = 3): string[] {
  const out: string[] = []; let cur = ''
  for (let w of t.replace(/\//g, '/ ').split(/\s+/)) {
    if (w.length > max) w = w.slice(0, max - 1) + '…'
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) out.push(cur)
  if (out.length > linhas) { out.length = linhas; out[linhas - 1] = out[linhas - 1].slice(0, max - 1) + '…' }
  return out
}

/** Gráfico de Pareto: barras (quantidade, ordem decrescente) + linha de % acumulado + referência de 80%. Barras clicáveis. */
export default function ParetoChart({ barras, titulo, selecionado, onSelect, destaque = [] }: {
  barras: Barra[]; titulo: string; selecionado?: string | null; onSelect?: (nome: string | null) => void; destaque?: string[]
}) {
  const d = pareto(barras)
  const ref = useRef<HTMLDivElement>(null); const [w, setW] = useState(600)
  useEffect(() => {   // largura real do contêiner: as barras se distribuem nela (sem escalar o texto)
    const el = ref.current; if (!el) return
    const f = () => setW(el.clientWidth || 600); f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect()
  }, [])
  if (!d.length) return <p className="py-10 text-center text-sm text-slate-500">Sem dados para este filtro.</p>
  const L = 40, R = 44, T = 28, B = 62
  const H = d.length <= 6 ? 270 : 220
  const slot = Math.max(62, (w - L - R) / d.length)       // ocupa toda a largura do cartão
  const bw = Math.round(Math.min(120, Math.max(30, slot * 0.46)))
  const maxChar = Math.max(12, Math.floor(slot / 7.5))
  const W = L + R + slot * d.length
  const max = Math.max(...d.map((x) => x.qtd)); const topo = Math.max(4, Math.ceil(max / 4) * 4)
  const yq = (v: number) => T + H - (v / topo) * H
  const yp = (p: number) => T + H - (p / 100) * H
  const cx = (i: number) => L + slot * i + slot / 2
  const pts = d.map((x, i) => `${cx(i)},${yp(x.acum)}`).join(' ')
  const ativo = (n: string) => (selecionado ? selecionado.toLowerCase() === n.toLowerCase() : destaque.length ? destaque.includes(n.toLowerCase()) : true)
  return (
    <div ref={ref} className="overflow-x-auto" role="group" aria-label={titulo}>
      <svg viewBox={`0 0 ${W} ${T + H + B}`} width={W} height={T + H + B} style={{ minWidth: W }} className="block" role="img" aria-label={`${titulo}: ${d.map((x) => `${x.nome} ${x.qtd}`).join(', ')}`}>
        {[0, 1, 2, 3, 4].map((g) => {
          const v = (topo / 4) * g
          return <g key={g}><line x1={L} x2={W - R} y1={yq(v)} y2={yq(v)} stroke="#e2e8f0" /><text x={L - 6} y={yq(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(v)}</text>
            <text x={W - R + 6} y={yq(v) + 3} fontSize="10" fill="#64748b">{g * 25}%</text></g>
        })}
        <line x1={L} x2={W - R} y1={yp(80)} y2={yp(80)} stroke="#f59e0b" strokeDasharray="4 3" />
        <text x={W - R - 2} y={yp(80) - 3} textAnchor="end" fontSize="9" fill="#b45309">80%</text>
        {d.map((x, i) => {
          const a = ativo(x.nome), h = (x.qtd / topo) * H, sel = selecionado?.toLowerCase() === x.nome.toLowerCase()
          return (
            <g key={x.nome} style={{ cursor: onSelect ? 'pointer' : 'default' }}
              role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? sel : undefined}
              aria-label={`${x.nome}: ${x.qtd} (${x.pct.toFixed(0)}%, acumulado ${x.acum.toFixed(0)}%)`}
              onMouseDown={(e) => e.preventDefault()} onClick={onSelect ? () => onSelect(sel ? null : x.nome) : undefined}
              onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(sel ? null : x.nome)) : undefined}>
              <rect x={cx(i) - slot / 2} y={T} width={slot} height={H + B} fill="transparent" />
              <rect x={cx(i) - bw / 2} y={T + H - h} width={bw} height={h} rx={6} fill={sel ? '#2e1a6e' : '#8b3fff'} opacity={a ? 1 : 0.35} />
              <text x={cx(i)} y={T + H - h - 5} textAnchor="middle" fontSize={d.length <= 6 ? 14 : 11} fontWeight="700" fill="#2e1a6e">{x.qtd}</text>
              <text textAnchor="middle" fontSize={d.length <= 6 ? 12 : 10} fill="#334155" fontWeight={sel ? 700 : 400}>
                {quebra(x.nome, maxChar).map((l, j) => <tspan key={j} x={cx(i)} y={T + H + 16 + j * 13}>{l}</tspan>)}
              </text>
              <title>{`${x.nome}: ${x.qtd} (${x.pct.toFixed(1)}%) · acumulado ${x.acum.toFixed(1)}%`}</title>
            </g>
          )
        })}
        <polyline points={pts} fill="none" stroke="#2e1a6e" strokeWidth="2" />
        {d.map((x, i) => (
          <g key={'p' + x.nome}>
            <circle cx={cx(i)} cy={yp(x.acum)} r="3.5" fill="#fff" stroke="#2e1a6e" strokeWidth="2" />
            {(i === 0 || i === d.length - 1 || d.length <= 8 || i % 3 === 0) && <text x={cx(i)} y={yp(x.acum) - 8} textAnchor="middle" fontSize="9" fill="#2e1a6e" stroke="#fff" strokeWidth="3" paintOrder="stroke">{x.acum.toFixed(0)}%</text>}
          </g>
        ))}
      </svg>
    </div>
  )
}
