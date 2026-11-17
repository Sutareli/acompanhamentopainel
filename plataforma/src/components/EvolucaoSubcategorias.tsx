import { useMemo, useState } from 'react'
import { Card } from './ui'
import { Chamado, mesLabel } from '../lib/chamados'

/** Evolução mensal das principais subcategorias (ou tipos/categorias): mostra se um problema é recorrente ou pontual. */
type Dim = 'subcategoria' | 'tipo' | 'categoria'
const DIMS: [Dim, string][] = [['subcategoria', 'Subcategoria'], ['tipo', 'Tipo'], ['categoria', 'Categoria']]
const CORES = ['#5b21b6', '#dc2626', '#0f766e', '#d97706', '#2563eb', '#64748b']
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
const chip = (on: boolean) => 'rounded-full border px-3 py-1 text-xs font-semibold transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')

export default function EvolucaoSubcategorias({ rows, meses }: { rows: Chamado[]; meses: string[] }) {
  const [dim, setDim] = useState<Dim>('subcategoria')
  const [qtdMeses, setQtdMeses] = useState(6)
  const [topN, setTopN] = useState(5)
  const ms = useMemo(() => meses.slice(-qtdMeses), [meses, qtdMeses])
  const series = useMemo(() => {
    const m = new Map<string, { nome: string; porMes: Record<string, number>; total: number }>()
    rows.forEach((c) => {
      const mk = c.data_ref.slice(0, 7); if (!ms.includes(mk)) return
      const nome = (c[dim] ?? '').trim(); if (!nome) return
      const k = norm(nome); const x = m.get(k) ?? { nome, porMes: {}, total: 0 }
      x.porMes[mk] = (x.porMes[mk] || 0) + 1; x.total++; m.set(k, x)
    })
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, topN).map((x) => ({ ...x, v: ms.map((k) => x.porMes[k] || 0) }))
  }, [rows, ms, dim, topN])

  const W = 760, H = 240, PL = 36, PR = 12, PT = 12, PB = 28
  const max = Math.max(1, ...series.flatMap((s) => s.v))
  const topo = Math.ceil(max / 5) * 5 || 5
  const x = (i: number) => PL + (ms.length <= 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (ms.length - 1))
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / topo)
  const tend = (v: number[]) => { const n = v.length; if (n < 2) return null; const d = v[n - 1] - v[n - 2]; return d }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">📈 Evolução mês a mês — principais {DIMS.find((d) => d[0] === dim)![1].toLowerCase()}s</h3>
          <p className="text-xs text-slate-500">Chamados por mês nas {topN} que mais aparecem no período mostrado. Linha que sobe todo mês = problema recorrente; um pico isolado = ocorrência pontual.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Agrupar por">
          {DIMS.map(([k, l]) => <button key={k} className={chip(dim === k)} aria-pressed={dim === k} onClick={() => setDim(k)}>{l}</button>)}
          <select className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs text-navy" aria-label="Quantidade de meses" value={qtdMeses} onChange={(e) => setQtdMeses(+e.target.value)}>{[3, 6, 12].map((n) => <option key={n} value={n}>Últimos {n} meses</option>)}</select>
          <select className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs text-navy" aria-label="Quantidade de itens" value={topN} onChange={(e) => setTopN(+e.target.value)}>{[3, 5, 6].map((n) => <option key={n} value={n}>Top {n}</option>)}</select>
        </div>
      </div>
      {series.length === 0 || ms.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Sem dados para este filtro.</p> : (<>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Gráfico de linhas com a evolução mensal">
          {[0, 1, 2, 3, 4, 5].map((i) => { const v = (topo * i) / 5; return <g key={i}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e2e8f0" /><text x={PL - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(v)}</text></g> })}
          {ms.map((k, i) => <text key={k} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#475569">{mesLabel(k)}</text>)}
          {series.map((s, si) => (
            <g key={s.nome}>
              <polyline fill="none" stroke={CORES[si % CORES.length]} strokeWidth="2.5" strokeLinejoin="round" points={s.v.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {s.v.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={CORES[si % CORES.length]}><title>{`${s.nome} · ${mesLabel(ms[i])}: ${v} chamado(s)`}</title></circle>)}
            </g>
          ))}
        </svg>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s, si) => { const d = tend(s.v); return (
            <li key={s.nome} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: CORES[si % CORES.length] }} /><span className="truncate text-navy" title={s.nome}>{s.nome}</span></span>
              <span className="whitespace-nowrap text-xs text-slate-500">{s.total} no total{d !== null && <> · último mês <b className={d > 0 ? 'text-red-600' : d < 0 ? 'text-green-700' : 'text-slate-500'}>{d > 0 ? '▲ +' : d < 0 ? '▼ −' : '='}{d === 0 ? '' : Math.abs(d)}</b></>}</span>
            </li>) })}
        </ul>
      </>)}
    </Card>
  )
}
