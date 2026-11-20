import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Feriado } from '../lib/feriados'
import { setFeriados } from '../lib/sla'
import { fmtDate } from '../lib/rules'
import { btnP, btnSm, Card, Field, inp, Msg } from './ui'

/** Feriados descontados do SLA em dias úteis. Qualquer usuário vê; só Analista Sr e Gerente editam (RLS). */
export default function Feriados({ pode }: { pode: boolean }) {
  const [lista, setLista] = useState<Feriado[]>([])
  const onChange = useCallback(async () => {
    const r = await supabase.from('feriados').select('data,nome').order('data')
    if (r.error) return setErr('Não foi possível carregar os feriados (a migração 025 já foi aplicada?): ' + r.error.message)
    const l = (r.data || []) as Feriado[]; setLista(l); setFeriados(l.map((x) => x.data))
  }, [])
  useEffect(() => { onChange() }, [onChange])
  const [data, setData] = useState('')
  const [nome, setNome] = useState('')
  const [err, setErr] = useState('')
  const [ano, setAno] = useState(new Date().getFullYear())
  const anos = [...new Set([new Date().getFullYear(), ...lista.map((f) => +f.data.slice(0, 4))])].sort()
  async function add() {
    setErr('')
    if (!data || !nome.trim()) return setErr('Informe a data e o nome do feriado.')
    const r = await supabase.from('feriados').insert({ data, nome: nome.trim() })
    if (r.error) return setErr(r.error.code === '23505' ? 'Essa data já está cadastrada.' : r.error.message)
    setData(''); setNome(''); onChange()
  }
  async function del(d: string) {
    const r = await supabase.from('feriados').delete().eq('data', d)
    if (r.error) return setErr(r.error.message)
    onChange()
  }
  return (
    <Card>
      <h3 className="mb-1 font-bold text-navy">Feriados (SLA em dias úteis)</h3>
      <p className="mb-3 text-sm text-slate-500">Os prazos de SLA contados em <b>dias úteis</b> pulam sábados, domingos e os feriados abaixo. Os nacionais vêm cadastrados até 2028; inclua feriados estaduais, municipais ou pontos facultativos da sua empresa e remova o que não se aplica.</p>
      {err && <Msg kind="erro">{err}</Msg>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {anos.map((a) => <button key={a} className={'rounded-md border px-3 py-1 text-xs font-medium ' + (ano === a ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy')} onClick={() => setAno(a)}>{a}</button>)}
      </div>
      <ul className="mb-3 grid gap-1 sm:grid-cols-2">
        {lista.filter((f) => +f.data.slice(0, 4) === ano).map((f) => (
          <li key={f.data} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
            <span><b className="text-navy">{fmtDate(f.data)}</b> · {f.nome}</span>
            {pode && <button className="text-xs text-red-600 underline" aria-label={'Remover ' + f.nome} onClick={() => del(f.data)}>remover</button>}
          </li>
        ))}
        {!lista.some((f) => +f.data.slice(0, 4) === ano) && <li className="text-sm text-slate-400">Nenhum feriado em {ano}.</li>}
      </ul>
      {pode ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Data"><input type="date" className={inp} value={data} onChange={(e) => setData(e.target.value)} /></Field>
          <Field label="Nome"><input className={inp} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aniversário da cidade" /></Field>
          <button className={btnP + ' ' + btnSm} onClick={add}>Adicionar</button>
        </div>
      ) : <p className="text-xs text-slate-500">Somente Analista Sr e Gerente podem alterar os feriados.</p>}
      <p className="mt-2 text-xs text-slate-400">Alterar feriados muda o vencimento de SLA das melhorias que ainda estão nas etapas Chamado aberto ou Desenvolvimento (e o histórico de cumprimento).</p>
    </Card>
  )
}
