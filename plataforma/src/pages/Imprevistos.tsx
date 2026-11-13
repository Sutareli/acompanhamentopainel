import { FormEvent, useCallback, useEffect, useState } from 'react'
import { confirmar } from '../components/Confirm'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { chk, fmtDateTime, fmtMin, todayStr } from '../lib/rules'
import { DEFAULT_SETTINGS, loadSettings, Settings } from '../lib/settings'
import { btnG, btnP, btnSm, Card, Chip, Empty, Field, inp, Modal, Msg } from '../components/ui'

const CRIT_C: Record<string, string> = { critica: '#dc2626', alta: '#f97316', media: '#f59e0b', baixa: '#3b82f6' }
const CRIT_L: Record<string, string> = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' }
const IST: Record<string, string> = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído' }

/** Atividades extraordinárias e imprevistos do dia (consomem a margem flexível da jornada). */
export default function Imprevistos() {
  const { profile } = useAuth()
  const uid = profile!.id
  const [date, setDate] = useState(todayStr())
  const [imps, setImps] = useState<any[]>([])
  const [cfg, setCfg] = useState<Settings>(DEFAULT_SETTINGS)
  const [err, setErr] = useState('')
  const [i, setI] = useState({ descricao: '', criticidade: 'alta', estimativa_min: '' })
  const [ed, setEd] = useState<any>(null)
  const edited = (x: any) => Date.parse(x.atualizado_em) - Date.parse(x.criado_em) > 2000

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([supabase.from('imprevistos').select('*').eq('user_id', uid).eq('data', date).order('id'), loadSettings(uid)])
      setImps(chk(b)); setCfg(s); setErr('')
    } catch (e: any) { setErr(e.message) }
  }, [uid, date])
  useEffect(() => { load() }, [load])
  const run = async (fn: () => PromiseLike<any>) => { try { chk(await fn() as any); await load() } catch (e: any) { setErr(e.message) } }

  function addImp(e: FormEvent) {
    e.preventDefault()
    const d = Number(i.estimativa_min)
    if (!i.descricao.trim()) return setErr('Descreva o imprevisto.')
    if (!Number.isInteger(d) || d < 1) return setErr('Informe a estimativa de duração em minutos (número inteiro).')
    run(() => supabase.from('imprevistos').insert({ user_id: uid, data: date, descricao: i.descricao.trim(), criticidade: i.criticidade, estimativa_min: d }))
    setI({ descricao: '', criticidade: 'alta', estimativa_min: '' })
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    const r = ed.row, d = Number(r.estimativa_min)
    if (!Number.isInteger(d) || d < 1) return setErr('Informe a estimativa em minutos (número inteiro).')
    if (!String(r.descricao).trim()) return setErr('Descreva o imprevisto.')
    const res = await supabase.from('imprevistos').update({ descricao: r.descricao.trim(), criticidade: r.criticidade, estimativa_min: d, status: r.status }).eq('id', r.id)
    if (res.error) return setErr(res.error.message)
    setEd(null); setErr(''); load()
  }
  const ti = imps.reduce((s, x) => s + x.estimativa_min, 0)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-navy">Imprevistos</h1>
        <input type="date" className={inp + ' !w-auto'} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      <Card>
        <h3 className="font-bold text-navy">⚡ Atividades extraordinárias e imprevistos</h3>
        <p className="mb-3 text-sm text-slate-500">{fmtMin(ti)} estimados · margem restante {fmtMin(cfg.margem_min - ti)}</p>
        <form onSubmit={addImp} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Descrição" className="col-span-2 sm:col-span-4"><input className={inp} value={i.descricao} onChange={(e) => setI({ ...i, descricao: e.target.value })} /></Field>
          <Field label="Criticidade" className="col-span-1 sm:col-span-2">
            <select className={inp} value={i.criticidade} onChange={(e) => setI({ ...i, criticidade: e.target.value })}>{Object.entries(CRIT_L).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Estimativa (min)"><input type="number" min={1} className={inp} value={i.estimativa_min} onChange={(e) => setI({ ...i, estimativa_min: e.target.value })} /></Field>
          <button className={btnP + ' self-end'}>+ Imprevisto</button>
        </form>
        {imps.length === 0 ? <Empty>Nenhum imprevisto registrado neste dia.</Empty> : imps.map((x) => (
          <div key={x.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <Chip color={CRIT_C[x.criticidade]}>{CRIT_L[x.criticidade]}</Chip>
            <span className="min-w-[120px] flex-1">{x.descricao}</span><small>{fmtMin(x.estimativa_min)}</small>
            <select className={inp + ' !w-auto !py-1'} value={x.status} onChange={(e) => run(() => supabase.from('imprevistos').update({ status: e.target.value }).eq('id', x.id))}>
              {Object.entries(IST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {edited(x) && <small className="text-xs text-amber-700">editado {fmtDateTime(x.atualizado_em)}</small>}
            <button className={btnG + ' ' + btnSm} onClick={() => setEd({ row: { ...x, estimativa_min: String(x.estimativa_min) } })}>Editar</button>
            <button className={btnG + ' ' + btnSm} onClick={async () => { if (await confirmar({ titulo: 'Excluir imprevisto?', mensagem: 'O imprevisto sai do dia e fica na Lixeira por 48 horas.', confirmar: 'Excluir', perigo: true })) run(() => supabase.from('imprevistos').delete().eq('id', x.id)) }}>Excluir</button>
          </div>
        ))}
      </Card>
      {ed && (
        <Modal title="Editar imprevisto" onClose={() => setEd(null)}>
          <form onSubmit={saveEdit} className="grid grid-cols-2 gap-3">
            <Field label="Descrição" className="col-span-2"><input className={inp} value={ed.row.descricao} onChange={(e) => setEd({ row: { ...ed.row, descricao: e.target.value } })} /></Field>
            <Field label="Criticidade"><select className={inp} value={ed.row.criticidade} onChange={(e) => setEd({ row: { ...ed.row, criticidade: e.target.value } })}>{Object.entries(CRIT_L).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Estimativa (min)"><input type="number" min={1} className={inp} value={ed.row.estimativa_min} onChange={(e) => setEd({ row: { ...ed.row, estimativa_min: e.target.value } })} /></Field>
            <Field label="Status" className="col-span-2"><select className={inp} value={ed.row.status} onChange={(e) => setEd({ row: { ...ed.row, status: e.target.value } })}>{Object.entries(IST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <p className="col-span-2 text-xs text-slate-500">A alteração fica registrada (antes e depois) no log de auditoria.</p>
            <div className="col-span-2 flex justify-end gap-2"><button type="button" className={btnG} onClick={() => setEd(null)}>Cancelar</button><button className={btnP}>Salvar alterações</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}
