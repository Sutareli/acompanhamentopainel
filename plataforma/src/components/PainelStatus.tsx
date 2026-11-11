import { ItemStat, resumo, STATUS, Status, STATUS_COLOR, fmtDesempenho } from '../lib/backlog'

function Donut({ counts, total, rotulo }: { counts: Record<Status, number>; total: number; rotulo: string }) {
  let acc = 0
  return (
    <svg viewBox="0 0 42 42" className="h-52 w-52 shrink-0" role="img" aria-label={'Status das ' + rotulo}>
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" strokeWidth="5" />
      {total > 0 && STATUS.filter((s) => counts[s] > 0).map((s) => {
        const len = (counts[s] / total) * 100
        const gap = len > 3 ? 0.6 : 0
        const el = <circle key={s} cx="21" cy="21" r="15.9155" fill="none" stroke={STATUS_COLOR[s]} strokeWidth="5" strokeDasharray={`${Math.max(0, len - gap)} ${100 - len + gap}`} strokeDashoffset={25 - acc} />
        acc += len
        return el
      })}
      <text x="21" y="21.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#2e1a6e">{total}</text>
      <text x="21" y="26.5" textAnchor="middle" fontSize="2.8" fill="#64748b" letterSpacing="0.2">{rotulo.toUpperCase()}</text>
    </svg>
  )
}

/** Indicador horizontal (planejado × realizado). */
function Medidor({ rotulo, valor, cor }: { rotulo: string; valor: number | null; cor: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm"><span className="font-semibold text-slate-600">{rotulo}</span><span className="text-xl font-extrabold" style={{ color: cor }}>{valor === null ? '—' : valor + '%'}</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: Math.min(100, valor ?? 0) + '%', background: cor }} /></div>
    </div>
  )
}

/**
 * Painel executivo de status: rosca, legenda com quantidade e % por status e indicadores de desempenho
 * (Desempenho = realizado ÷ planejado, % planejado × % realizado). onStatus (opcional) torna cada status clicável (filtro).
 */
export default function PainelStatus({ titulo, rotulo, items, onStatus, ativo }: {
  titulo: string; rotulo: string; items: ItemStat[]; onStatus?: (s: Status | '') => void; ativo?: string
}) {
  const r = resumo(items)
  const d = r.desempenho
  const tom = d === null ? '#64748b' : d >= 1 ? '#16a34a' : d >= 0.8 ? '#d97706' : '#dc2626'
  const leitura = d === null ? 'Sem datas para calcular' : d >= 1 ? 'No ritmo ou à frente do plano' : d >= 0.8 ? 'Levemente abaixo do plano' : 'Abaixo do plano'
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-label={titulo}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-6 py-4" style={{ background: 'linear-gradient(90deg,#f5f0ff,#fff)' }}>
        <div><h2 className="text-lg font-bold text-navy">{titulo}</h2><p className="text-xs text-slate-500">Visão consolidada · {r.total} {rotulo}</p></div>
        {onStatus && ativo && <button className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-navy" onClick={() => onStatus('')}>Filtro: {ativo} ✕</button>}
      </div>
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-wrap items-center justify-center gap-8 p-6">
          <Donut counts={r.counts} total={r.total} rotulo={rotulo} />
          <div className="min-w-[260px] flex-1">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Status {rotulo}</div>
            <table className="w-full text-sm">
              <tbody>
                {STATUS.map((s) => {
                  const pct = r.total ? Math.round((r.counts[s] / r.total) * 100) : 0
                  const sel = ativo === s
                  return (
                    <tr key={s} className={'border-b border-slate-100 last:border-0 ' + (onStatus ? 'cursor-pointer hover:bg-violet-50 ' : '') + (sel ? 'bg-violet-50' : '')}
                      onClick={onStatus ? () => onStatus(sel ? '' : s) : undefined}
                      onKeyDown={onStatus ? (e) => e.key === 'Enter' && onStatus(sel ? '' : s) : undefined}
                      tabIndex={onStatus ? 0 : undefined} title={onStatus ? 'Clique para filtrar a tabela por este status' : undefined}>
                      <td className="w-6 py-2 pl-2"><i className="block h-3 w-3 rounded-full" style={{ background: STATUS_COLOR[s] }} /></td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">{s}</td>
                      <td className="w-28 py-2 pr-3"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: pct + '%', background: STATUS_COLOR[s] }} /></div></td>
                      <td className="w-12 py-2 text-right font-bold text-slate-800">{pct}%</td>
                      <td className="w-10 py-2 pr-2 text-right text-slate-500">{r.counts[s]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {onStatus && <p className="mt-2 text-[11px] text-slate-400">Clique em um status para filtrar a tabela</p>}
          </div>
        </div>
        <div className="space-y-5 border-t border-slate-100 bg-slate-50/70 p-6 lg:border-l lg:border-t-0">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Análise de desempenho</div>
          <div className="rounded-2xl bg-white p-4 shadow-sm" style={{ borderLeft: `5px solid ${tom}` }}>
            <div className="text-xs font-semibold text-slate-500">Desempenho</div>
            <div className="text-4xl font-extrabold leading-tight" style={{ color: tom }} title="Realizado ÷ planejado">{fmtDesempenho(d)}</div>
            <div className="text-xs" style={{ color: tom }}>{leitura}</div>
          </div>
          <Medidor rotulo="% Planejado" valor={r.planejado} cor="#94a3b8" />
          <Medidor rotulo="% Realizado" valor={r.realizado} cor="#8b3fff" />
          <p className="text-[11px] leading-snug text-slate-400">Planejado = parte do prazo já decorrida · Desempenho = realizado ÷ planejado{r.total > r.basePlano && r.basePlano > 0 ? ` · base: ${r.basePlano} de ${r.total} ${rotulo} com datas` : ''}</p>
        </div>
      </div>
    </section>
  )
}
