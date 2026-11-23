import { useEffect, useRef, useState } from 'react'
import { Barra, compararPareto } from '../lib/chamados'
import { quebra } from './ParetoChart'

const COR_ANT = '#aeb4c8', COR_ATU = '#4f46b5', SOBE = '#c0392b', DESCE = '#16833f'

/** Pareto comparativo: para cada categoria, duas colunas lado a lado (mês anterior × mês atual), na ordem do mês atual,
 *  com a variação embaixo do nome (mais chamados = vermelho, menos = verde) e a linha de % acumulado do mês atual. */
export default function ParetoComparativo({ atual, anterior, rotAtual, rotAnterior, titulo, selecionado, onSelect, destaque = [] }: {
  atual: Barra[]; anterior: Barra[]; rotAtual: string; rotAnterior: string; titulo: string
  selecionado?: string | null; onSelect?: (nome: string | null) => void; destaque?: string[]
}) {
  const d = compararPareto(atual, anterior)
  const ref = useRef<HTMLDivElement>(null); const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const f = () => setW(el.clientWidth || 600); f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect()
  }, [])
  if (!d.length) return <p className="py-10 text-center text-sm text-slate-500">Sem dados para este filtro.</p>
  const L = 40, R = 44, T = 44, B = 82, H = d.length <= 6 ? 270 : 220
  const slot = Math.max(84, (w - L - R) / d.length)
  const bw = Math.round(Math.min(56, Math.max(20, slot * 0.34))), gap = 4
  const maxChar = Math.max(12, Math.floor(slot / 7.5))
  const W = L + R + slot * d.length
  const max = Math.max(...d.map((x) => Math.max(x.atual, x.anterior))); const topo = Math.max(4, Math.ceil(max / 4) * 4)
  const yq = (v: number) => T + H - (v / topo) * H
  const yp = (p: number) => T + H - (p / 100) * H
  const cx = (i: number) => L + slot * i + slot / 2
  const pts = d.map((x, i) => `${cx(i)},${yp(x.acum)}`).join(' ')
  const ativo = (n: string) => (selecionado ? selecionado.toLowerCase() === n.toLowerCase() : destaque.length ? destaque.includes(n.toLowerCase()) : true)
  const fs = d.length <= 6 ? 13 : 11
  const totA = d.reduce((s, x) => s + x.atual, 0), totP = d.reduce((s, x) => s + x.anterior, 0)
  return (
    <div role="group" aria-label={titulo}>
      <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: COR_ANT }} />{rotAnterior} <b className="text-slate-800">({totP})</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: COR_ATU }} />{rotAtual} <b className="text-slate-800">({totA})</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-[#26294f]" />% acumulado de {rotAtual}</span>
      </div>
      <div ref={ref} className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${T + H + B}`} width={W} height={T + H + B} style={{ minWidth: W }} className="block" role="img"
          aria-label={`${titulo}: ${d.map((x) => `${x.nome} ${rotAnterior} ${x.anterior}, ${rotAtual} ${x.atual}`).join('; ')}`}>
          {[0, 1, 2, 3, 4].map((g) => {
            const v = (topo / 4) * g
            return <g key={g}><line x1={L} x2={W - R} y1={yq(v)} y2={yq(v)} stroke="#e2e8f0" /><text x={L - 6} y={yq(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(v)}</text>
              <text x={W - R + 6} y={yq(v) + 3} fontSize="10" fill="#64748b">{g * 25}%</text></g>
          })}
          <line x1={L} x2={W - R} y1={yp(80)} y2={yp(80)} stroke="#f59e0b" strokeDasharray="4 3" />
          <text x={W - R - 2} y={yp(80) - 3} textAnchor="end" fontSize="9" fill="#b45309">80%</text>
          {d.map((x, i) => {
            const a = ativo(x.nome), sel = selecionado?.toLowerCase() === x.nome.toLowerCase()
            const hA = (x.atual / topo) * H, hP = (x.anterior / topo) * H
            const nome = quebra(x.nome, maxChar)
            const dc = x.delta > 0 ? SOBE : x.delta < 0 ? DESCE : '#64748b'
            return (
              <g key={x.nome} style={{ cursor: onSelect ? 'pointer' : 'default' }}
                role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? sel : undefined}
                aria-label={`${x.nome}: ${rotAnterior} ${x.anterior}, ${rotAtual} ${x.atual}`}
                onMouseDown={(e) => e.preventDefault()} onClick={onSelect ? () => onSelect(sel ? null : x.nome) : undefined}
                onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(sel ? null : x.nome)) : undefined}>
                <rect x={cx(i) - slot / 2} y={T} width={slot} height={H + B} fill="transparent" />
                {sel && <rect x={cx(i) - slot / 2 + 2} y={T - 6} width={slot - 4} height={H + B + 6} rx={8} fill="#26294f" opacity="0.06" />}
                <rect x={cx(i) - gap / 2 - bw} y={T + H - hP} width={bw} height={hP} rx={5} fill={COR_ANT} opacity={a ? 1 : 0.4} />
                <rect x={cx(i) + gap / 2} y={T + H - hA} width={bw} height={hA} rx={5} fill={sel ? '#26294f' : COR_ATU} opacity={a ? 1 : 0.4} />
                <text x={cx(i) - gap / 2 - bw / 2} y={T + H - hP - 5} textAnchor="middle" fontSize={fs} fontWeight="600" fill="#64748b">{x.anterior}</text>
                <text x={cx(i) + gap / 2 + bw / 2} y={T + H - hA - 5} textAnchor="middle" fontSize={fs} fontWeight="700" fill="#26294f">{x.atual}</text>
                <text textAnchor="middle" fontSize={d.length <= 6 ? 12 : 10} fill="#334155" fontWeight={sel ? 700 : 400}>
                  {nome.map((l, j) => <tspan key={j} x={cx(i)} y={T + H + 16 + j * 13}>{l}</tspan>)}
                </text>
                <text x={cx(i)} y={T + H + 16 + nome.length * 13 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={dc}>{x.delta > 0 ? '▲ +' : x.delta < 0 ? '▼ ' : '= '}{x.delta === 0 ? '0' : x.delta}</text>
                <title>{`${x.nome}: ${rotAnterior} ${x.anterior} → ${rotAtual} ${x.atual} (${x.delta > 0 ? '+' : ''}${x.delta}) · acumulado de ${rotAtual}: ${x.acum.toFixed(1)}%`}</title>
              </g>
            )
          })}
          <polyline points={pts} fill="none" stroke="#26294f" strokeWidth="2" />
          {d.map((x, i) => (
            <g key={'p' + x.nome}>
              <circle cx={cx(i)} cy={yp(x.acum)} r="3.5" fill="#fff" stroke="#26294f" strokeWidth="2" />
              {(i === 0 || i === d.length - 1 || d.length <= 8 || i % 3 === 0) && <text x={cx(i) + bw / 2 + 2} y={yp(x.acum) - 8} textAnchor="middle" fontSize="9" fill="#26294f" stroke="#fff" strokeWidth="3" paintOrder="stroke">{x.acum.toFixed(0)}%</text>}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
