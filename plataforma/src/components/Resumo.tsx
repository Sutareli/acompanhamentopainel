import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, fmtDate, todayStr } from '../lib/rules'
import { Card, VBars } from './ui'

/**
 * Resumo de execução diária (7 ou 30 dias), calculado pelas TAREFAS marcadas (view v_resumo_diario).
 * Dia sem registro (ou sem tarefas) aparece como "sem registro" — nunca como 0%.
 * Compara a média do período com o período imediatamente anterior.
 */
export default function Resumo({ userId, n = 7, version = 0, title }: { userId: string; n?: 7 | 30; version?: number; title?: string }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('v_resumo_diario').select('data,pct_execucao').eq('user_id', userId).gte('data', addDays(todayStr(), -(2 * n - 1)))
      .then(({ data, error }) => { if (error) setErr(error.message); else { setRows(data || []); setErr('') } })
  }, [userId, n, version])

  const t = todayStr()
  const map = new Map((rows || []).map((r) => [r.data, r.pct_execucao as number | null]))
  const cur = Array.from({ length: n }, (_, i) => addDays(t, -(n - 1 - i)))
  const prevDays = Array.from({ length: n }, (_, i) => addDays(t, -(2 * n - 1 - i)))
  const avg = (ds: string[]) => {
    const v = ds.map((d) => map.get(d)).filter((x) => x != null) as number[]
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  }
  const a = avg(cur), p = avg(prevDays)
  const withData = cur.filter((d) => map.get(d) != null)
  const best = withData.length ? withData.reduce((m, d) => ((map.get(d) as number) > (map.get(m) as number) ? d : m)) : null
  const col = (x: number) => (x >= 80 ? '#16a34a' : x >= 50 ? '#f59e0b' : '#dc2626')

  return (
    <Card>
      <h3 className="mb-1 font-bold text-navy">📊 {title || (n === 7 ? 'Resumo semanal' : 'Resumo mensal')}</h3>
      <p className="text-xs text-slate-500">Execução das tarefas por dia · verde ≥80%, laranja ≥50%, vermelho abaixo · cinza = sem registro</p>
      {err && <p className="mt-2 text-sm text-red-700">Erro ao carregar: {err}</p>}
      {rows === null ? <p className="py-8 text-center text-sm text-slate-500">Carregando…</p> : (
        <>
          <VBars rows={cur.map((d) => {
            const v = map.get(d) ?? null
            return { label: n === 7 ? new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).slice(0, 3) + ' ' + d.slice(8) : d.slice(8), value: v, color: v === null ? undefined : col(v), title: `${fmtDate(d)}: ${v === null ? 'sem registro' : v + '%'}` }
          })} unit="%" />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Média: <b>{a === null ? '—' : a + '%'}</b> ({withData.length} dia(s) com registro)</span>
            <span>Melhor dia: <b>{best ? `${fmtDate(best).slice(0, 5)} (${map.get(best)}%)` : '—'}</b></span>
            <span>Período anterior: <b>{p === null ? 'sem registro' : p + '%'}</b>{a !== null && p !== null && <> ({a - p >= 0 ? '+' : ''}{a - p} p.p.)</>}</span>
          </div>
        </>
      )}
    </Card>
  )
}
