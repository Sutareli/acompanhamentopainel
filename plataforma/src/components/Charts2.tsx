/** Gráficos simples em SVG usados no Pareto backlog: rosca com legenda e área por dia. */
export const PALETA = ['#8b3fff', '#2e1a6e', '#0e7490', '#f59e0b', '#ec4899', '#16a34a', '#2563eb', '#ea580c']
const CINZA = '#94a3b8'

export function Rosca({ dados, total, rotulo, titulo }: { dados: { nome: string; qtd: number }[]; total: number; rotulo: string; titulo: string }) {
  const top = dados.slice(0, PALETA.length - 1); const resto = dados.slice(PALETA.length - 1).reduce((a, b) => a + b.qtd, 0)
  const fat = [...top.map((d, i) => ({ ...d, c: PALETA[i] })), ...(resto ? [{ nome: 'Demais', qtd: resto, c: CINZA }] : [])]
  const soma = fat.reduce((a, b) => a + b.qtd, 0) || 1
  let acc = 0
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 42 42" className="h-40 w-40 shrink-0" role="img" aria-label={`${titulo}: ${fat.map((f) => `${f.nome} ${Math.round((f.qtd / soma) * 100)}%`).join(', ')}`}>
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="6" />
        {fat.map((f) => { const len = (f.qtd / soma) * 100; const el = <circle key={f.nome} cx="21" cy="21" r="15.9155" fill="none" stroke={f.c} strokeWidth="6" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={25 - acc}><title>{`${f.nome}: ${f.qtd}`}</title></circle>; acc += len; return el })}
        <text x="21" y="22" textAnchor="middle" fontSize="8" fontWeight="700" fill="#2e1a6e">{total}</text>
        <text x="21" y="27.5" textAnchor="middle" fontSize="3.2" fill="#64748b">{rotulo}</text>
      </svg>
      <ul className="min-w-[160px] flex-1 space-y-1 text-sm">
        {fat.map((f) => (
          <li key={f.nome} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: f.c }} /><span className="flex-1 truncate" title={f.nome}>{f.nome}</span><b className="tabular-nums">{Math.round((f.qtd / soma) * 100)}%</b></li>
        ))}
      </ul>
    </div>
  )
}

export function AreaDias({ valores, mes }: { valores: number[]; mes: string }) {
  const W = 380, H = 190, L = 28, R = 10, T = 14, B = 24
  const max = Math.max(4, Math.ceil(Math.max(...valores) / 4) * 4), n = valores.length
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R), y = (v: number) => T + (H - T - B) - (v / max) * (H - T - B)
  const linha = valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const pico = valores.indexOf(Math.max(...valores))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Chamados por dia em ${mes}; maior dia: ${pico + 1} com ${valores[pico]}`}>
      {[0, 1, 2, 3, 4].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y((max / 4) * g)} y2={y((max / 4) * g)} stroke="#e2e8f0" /><text x={L - 4} y={y((max / 4) * g) + 3} textAnchor="end" fontSize="9" fill="#64748b">{Math.round((max / 4) * g)}</text></g>)}
      <polygon points={`${x(0)},${y(0)} ${linha} ${x(n - 1)},${y(0)}`} fill="#8b3fff" opacity=".25" />
      <polyline points={linha} fill="none" stroke="#8b3fff" strokeWidth="2" />
      {valores.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === pico ? 4 : 2} fill={i === pico ? '#2e1a6e' : '#8b3fff'}><title>{`Dia ${i + 1}: ${v} chamado(s)`}</title></circle>)}
      {valores[pico] > 0 && <text x={x(pico)} y={y(valores[pico]) - 7} textAnchor="middle" fontSize="10" fontWeight="700" fill="#2e1a6e">{valores[pico]}</text>}
      {valores.map((_, i) => ((i + 1) % 5 === 0 || i === 0) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">{i + 1}</text>)}
    </svg>
  )
}
