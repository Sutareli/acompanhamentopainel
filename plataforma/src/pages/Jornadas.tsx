import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { addDays, fmtDate, PERFIL_LABEL, Perfil, todayStr } from '../lib/rules'
import { Card, Chip, Empty, inp, Msg } from '../components/ui'
import Resumo from '../components/Resumo'
import DiaDetalhe from '../components/DiaDetalhe'

/**
 * Jornadas da equipe — SOMENTE CONSULTA.
 * Disponível a Diretor, Gerente e Analista Sr. O banco (RLS) só permite SELECT nas jornadas de terceiros;
 * esta tela não contém nenhum botão de gravação.
 */
export default function Jornadas() {
  const { profile } = useAuth()
  const [people, setPeople] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [sel, setSel] = useState<string>('')
  const [date, setDate] = useState(todayStr())
  const [err, setErr] = useState('')
  const hoje = todayStr()

  useEffect(() => {
    ;(async () => {
      const [p, r] = await Promise.all([
        supabase.from('profiles').select('id,nome,perfil,ativo').eq('ativo', true).order('nome'),
        supabase.from('v_resumo_diario').select('user_id,data,pct_execucao').gte('data', addDays(hoje, -6)),
      ])
      if (p.error || r.error) setErr('Não foi possível carregar: ' + (p.error || r.error)!.message)
      else { setPeople(p.data || []); setRows(r.data || []); setErr('') }
    })()
  }, [hoje])

  const resumo = useMemo(() => people.map((p) => {
    const mine = rows.filter((r) => r.user_id === p.id)
    const vals = mine.map((r) => r.pct_execucao).filter((x) => x != null) as number[]
    const h = mine.find((r) => r.data === hoje)
    return { ...p, hoje: h ? h.pct_execucao : null, media: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, dias: vals.length }
  }), [people, rows, hoje])

  const who = people.find((p) => p.id === sel)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Jornadas da equipe</h1>
      <Msg kind="aviso">Modo somente consulta: as jornadas de outras pessoas podem ser vistas, mas nunca alteradas.</Msg>
      {err && <Msg kind="erro">{err}</Msg>}

      <Card className="!p-0">
        <div className="p-4"><h3 className="font-bold text-navy">Execução por pessoa</h3><p className="text-xs text-slate-500">Percentual de tarefas concluídas · “sem registro” quando não há jornada/tarefas no dia (não conta como 0%).</p></div>
        {resumo.length === 0 ? <div className="p-4"><Empty>Nenhuma pessoa cadastrada.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Pessoa</th><th>Perfil</th><th className="text-right">Hoje</th><th className="text-right">Média 7 dias</th><th className="px-4 text-right">Dias com registro</th></tr></thead>
              <tbody>
                {resumo.map((p) => (
                  <tr key={p.id} className={'border-t border-slate-100 ' + (sel === p.id ? 'bg-slate-50' : '')}>
                    <td className="px-4 py-2"><button className="font-semibold text-turq underline" onClick={() => setSel(p.id)}>{p.nome}{p.id === profile!.id ? ' (você)' : ''}</button></td>
                    <td>{PERFIL_LABEL[p.perfil as Perfil]}</td>
                    <td className="text-right">{p.hoje === null ? 'sem registro' : p.hoje + '%'}</td>
                    <td className="text-right">{p.media === null ? 'sem registro' : p.media + '%'}</td>
                    <td className="px-4 text-right">{p.dias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {who ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-navy">{who.nome}</h2><Chip color="#64748b">{PERFIL_LABEL[who.perfil as Perfil]}</Chip><Chip color="#0ea5b7">somente consulta</Chip>
            <input type="date" className={inp + ' !w-auto'} value={date} max={hoje} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <span className="text-sm text-slate-500">{fmtDate(date)}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card><h3 className="mb-2 font-bold text-navy">Jornada do dia</h3><DiaDetalhe userId={sel} date={date} /></Card>
            <Resumo userId={sel} n={7} title={`Execução de ${who.nome} · 7 dias`} />
          </div>
        </div>
      ) : <Empty>Escolha uma pessoa na tabela para ver a jornada dela.</Empty>}
    </div>
  )
}
