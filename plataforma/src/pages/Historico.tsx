import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { download, fmtDate, fmtSec, toCSV, todayStr } from '../lib/rules'
import { btnG, Card, Empty, inp, Msg } from '../components/ui'
import Resumo from '../components/Resumo'
import DiaDetalhe from '../components/DiaDetalhe'

/** Histórico das PRÓPRIAS jornadas. (A consulta de jornadas de terceiros fica em "Jornadas da equipe".) */
export default function Historico() {
  const { profile } = useAuth()
  const uid = profile!.id
  const [days, setDays] = useState<any[]>([])
  const [n, setN] = useState<7 | 30>(7)
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('v_resumo_diario').select('*').eq('user_id', uid).order('data', { ascending: false }).limit(120)
      .then(({ data, error }) => (error ? setErr(error.message) : setDays(data || [])))
  }, [uid])

  const exportCsv = () => download(`historico-jornada-${todayStr()}.csv`, toCSV([
    ['Data', 'Tarefas', 'Concluídas', '% execução', 'Tempo trabalhado'],
    ...days.map((d) => [fmtDate(d.data), d.total, d.concluidas, d.pct_execucao ?? 'sem registro', fmtSec(d.tempo_trabalhado_seg)]),
  ]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-navy">Histórico</h1>
        <div className="flex flex-wrap gap-2">
          <button className={btnG + (n === 7 ? ' !bg-navy !text-white' : '')} onClick={() => setN(7)}>Semanal</button>
          <button className={btnG + (n === 30 ? ' !bg-navy !text-white' : '')} onClick={() => setN(30)}>Mensal</button>
          <button className={btnG} onClick={exportCsv} disabled={!days.length}>⬇ Exportar histórico (CSV)</button>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      <Resumo userId={uid} n={n} title={n === 7 ? 'Execução dos últimos 7 dias' : 'Execução dos últimos 30 dias'} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <h3 className="mb-2 font-bold text-navy">Dias registrados</h3>
          <input type="date" className={inp + ' mb-3'} value={pick} onChange={(e) => setPick(e.target.value)} max={todayStr()} />
          {days.length === 0 ? <Empty>Ainda não há dias registrados.</Empty> : (
            <ul className="max-h-[480px] space-y-1 overflow-y-auto">
              {days.map((d) => (
                <li key={d.data}>
                  <button onClick={() => setPick(d.data)} className={'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 ' + (pick === d.data ? 'bg-slate-100 font-semibold' : '')}>
                    <span>{fmtDate(d.data)}</span><span className="text-slate-500">{d.pct_execucao === null ? 'sem registro' : d.pct_execucao + '%'} · {fmtSec(d.tempo_trabalhado_seg)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <h3 className="mb-2 font-bold text-navy">{pick ? `Detalhes de ${fmtDate(pick)}` : 'Detalhes do dia'}</h3>
          {pick ? <DiaDetalhe userId={uid} date={pick} /> : <Empty>Escolha um dia na lista ou no calendário.</Empty>}
        </Card>
      </div>
    </div>
  )
}
