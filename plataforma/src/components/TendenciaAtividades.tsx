import { useMemo } from 'react'
import { Micro, TZ } from '../lib/rules'
import { Card, Empty, HBars, VBars } from './ui'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Tendência das Atividades (ex-microprojetos): o que mais é preenchido (cálculo direto)  + resumo automático (sem IA, sem custo). */
export default function TendenciaAtividades({ rows, campo }: { rows: Micro[]; campo: 'data_target' | 'criado_em'; de?: string; ate?: string }) {
  const ats = useMemo(() => rows.filter((r) => r.tipo_projeto === 'micro'), [rows])
  const dia = (r: Micro) => campo === 'criado_em' ? new Date(r.criado_em).toLocaleDateString('en-CA', { timeZone: TZ }) : r.data_target
  const { top, meses, recorrentes, distintas } = useMemo(() => {
    const g = new Map<string, { nome: string; n: number; u: number; formas: Map<string, number> }>()
    const m = new Map<string, number>()
    ats.forEach((r) => {
      const k = norm(r.demanda); if (!k) return
      const x = g.get(k) ?? { nome: r.demanda.trim(), n: 0, u: 0, formas: new Map() }
      x.n++; x.u += r.quantidade; x.formas.set(r.demanda.trim(), (x.formas.get(r.demanda.trim()) || 0) + 1); g.set(k, x)
      const mm = dia(r).slice(0, 7); m.set(mm, (m.get(mm) || 0) + 1)
    })
    const lista = [...g.values()].map((x) => ({ ...x, nome: [...x.formas.entries()].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.n - a.n || b.u - a.u)
    return { top: lista.slice(0, 10), distintas: lista.length, recorrentes: ats.filter((r) => r.criticidade === 'recorrente').length,
      meses: [...m.entries()].sort().map(([k, v]) => ({ label: k.slice(5) + '/' + k.slice(2, 4), value: v })) }
  }, [ats, campo])  // eslint-disable-line react-hooks/exhaustive-deps

  // resumo automático (sem IA), sempre disponível
  const auto = useMemo(() => {
    if (!ats.length) return ''
    const t = top.slice(0, 3).map((x) => `“${x.nome}” (${x.n}×)`).join(', ')
    let tend = ''
    if (meses.length >= 2) { const a = meses[meses.length - 2].value, b = meses[meses.length - 1].value; tend = b > a ? ` O último mês teve mais registros que o anterior (${b} contra ${a}).` : b < a ? ` O último mês teve menos registros que o anterior (${b} contra ${a}).` : ` O último mês manteve o ritmo do anterior (${b} registros).` }
    return `No período há ${ats.length} atividade(s) em ${distintas} demanda(s) diferentes. As mais registradas: ${t}.` + tend + (recorrentes ? ` ${recorrentes} (${Math.round((recorrentes / ats.length) * 100)}%) são recorrentes.` : '')
  }, [ats, top, meses, distintas, recorrentes])

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-navy">📈 Tendência das atividades — o que o time mais preenche</h3>
          <p className="text-xs text-slate-500">Considera só as <b>Atividades</b> do período filtrado acima ({ats.length} registro(s)). Tudo é calculado direto dos registros.</p>
        </div>
      </div>
      {!ats.length ? <Empty>Sem atividades no período.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Demandas mais registradas (nº de atividades)</h4>
            <HBars rows={top.map((x) => ({ label: x.nome.length > 42 ? x.nome.slice(0, 41) + '…' : x.nome, value: x.n }))} />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-700">Registros por mês ({campo === 'criado_em' ? 'data de cadastro' : 'data target'})</h4>
            <VBars rows={meses} />
          </div>
        </div>
      )}
      {auto && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><b>Resumo automático:</b> {auto}</p>}
    </Card>
  )
}
