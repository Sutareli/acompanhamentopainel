import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, download, fmtDate, hhmm, toCSV, todayStr } from '../lib/rules'
import { btnG, Card, Chip, Empty, inp, Msg } from '../components/ui'

interface Ativ { data: string; bloco_numero: number | null; bloco_nome: string | null; descricao: string; grupo: string | null; concluida_em: string | null; origem: 'dia' | 'arquivada' }

/**
 * Histórico de atividades CONCLUÍDAS do próprio usuário, lido do banco (view v_atividades):
 * tarefas concluídas dos dias + as arquivadas quando o dia foi "limpo".
 */
export default function HistoricoAtividades({ userId }: { userId: string }) {
  const hoje = todayStr()
  const [de, setDe] = useState(addDays(hoje, -29))
  const [ate, setAte] = useState(hoje)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Ativ[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let off = false
    setLoading(true)
    supabase.from('v_atividades').select('*').eq('user_id', userId).gte('data', de).lte('data', ate)
      .order('data', { ascending: false }).order('bloco_numero').limit(5000)
      .then(({ data, error }) => {
        if (off) return
        if (error) setErr('Não foi possível carregar o histórico: ' + error.message)
        else { setRows((data || []) as Ativ[]); setErr('') }
        setLoading(false)
      })
    return () => { off = true }
  }, [userId, de, ate])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((r) => (r.descricao + ' ' + (r.bloco_nome || '') + ' ' + (r.grupo || '')).toLowerCase().includes(t)) : rows
  }, [rows, q])

  const days = useMemo(() => {
    const m = new Map<string, Ativ[]>()
    filtered.forEach((r) => m.set(r.data, [...(m.get(r.data) || []), r]))
    return [...m.entries()]
  }, [filtered])

  const quick = (n: number) => { setDe(addDays(hoje, -(n - 1))); setAte(hoje) }
  const exportCsv = () => download(`historico-atividades-${hoje}.csv`, toCSV([
    ['Data', 'Bloco', 'Atividade', 'Grupo', 'Concluída às', 'Origem'],
    ...filtered.map((r) => [fmtDate(r.data), r.bloco_numero ? `${r.bloco_numero}. ${r.bloco_nome}` : '', r.descricao, r.grupo || '', r.concluida_em ? hhmm(r.concluida_em) : '', r.origem === 'arquivada' ? 'arquivada ao limpar o dia' : 'lista do dia']),
  ]))

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">De<input type="date" className={inp} value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
          <label className="text-sm">Até<input type="date" className={inp} value={ate} min={de} max={hoje} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
          <div className="flex gap-2">
            <button className={btnG} onClick={() => quick(7)}>7 dias</button>
            <button className={btnG} onClick={() => quick(30)}>30 dias</button>
            <button className={btnG} onClick={() => quick(90)}>90 dias</button>
          </div>
          <label className="min-w-[180px] flex-1 text-sm">Buscar<input className={inp} placeholder="Texto da atividade ou do bloco" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className={btnG} onClick={exportCsv} disabled={!filtered.length}>⬇ Exportar (CSV)</button>
        </div>
        <p className="mt-2 text-sm text-slate-500">{filtered.length} atividade(s) concluída(s) em {days.length} dia(s) entre {fmtDate(de)} e {fmtDate(ate)}.</p>
      </Card>
      {err && <Msg kind="erro">{err}</Msg>}
      {loading ? <p className="py-6 text-center text-slate-500">Carregando…</p> : days.length === 0 ? <Empty>Nenhuma atividade concluída neste período.</Empty> : days.map(([d, list]) => (
        <Card key={d}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-bold text-navy">{new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' })}, {fmtDate(d)}</h3>
            <Chip color="#16a34a">{list.length} concluída(s)</Chip>
          </div>
          <ul className="space-y-1 text-sm">
            {list.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-dashed border-slate-100 py-1">
                <span className="text-green-700">✔</span>
                <span className="min-w-0 flex-1">{r.descricao}</span>
                {r.bloco_nome && <span className="text-xs text-slate-500">{r.bloco_numero}. {r.bloco_nome}</span>}
                {r.concluida_em && <span className="text-xs text-slate-400">{hhmm(r.concluida_em)}</span>}
                {r.origem === 'arquivada' && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500" title="Guardada quando você limpou a lista deste dia">arquivada</span>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
