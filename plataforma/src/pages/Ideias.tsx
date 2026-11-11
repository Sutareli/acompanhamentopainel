import { FormEvent, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { chk, fmtDate, fmtDateTime, todayStr } from '../lib/rules'
import { ensureDay } from '../lib/journal'
import { btnG, btnP, btnSm, Card, Chip, Empty, Field, inp, Modal, Msg } from '../components/ui'

const ST: Record<string, string> = { nova: 'Nova ideia', aguardando: 'Aguardando desenvolvimento', em_desenvolvimento: 'Em desenvolvimento', concluida: 'Concluída', arquivada: 'Arquivada' }
const PR: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' }
const PC: Record<string, string> = { baixa: '#3b82f6', media: '#f59e0b', alta: '#dc2626' }

export default function Ideias() {
  const { profile } = useAuth()
  const uid = profile!.id
  const [ideas, setIdeas] = useState<any[]>([])
  const [links, setLinks] = useState<Record<string, { concluida: boolean }>>({})
  const [f, setF] = useState({ titulo: '', descricao: '', prioridade: 'media' })
  const [filter, setFilter] = useState('')
  const [ed, setEd] = useState<any>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        supabase.from('ideas').select('*').eq('user_id', uid).order('criado_em', { ascending: false }),
        supabase.from('daily_tasks').select('idea_id,concluida').eq('user_id', uid).not('idea_id', 'is', null),
      ])
      setIdeas(chk(a))
      const m: Record<string, { concluida: boolean }> = {}
      chk(b).forEach((t: any) => { m[t.idea_id] = { concluida: t.concluida } })
      setLinks(m); setErr('')
    } catch (e: any) { setErr(e.message) }
  }, [uid])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => PromiseLike<any>, msg = '') => { try { chk(await fn() as any); setOk(msg); await load() } catch (e: any) { setOk(''); setErr(e.message) } }

  function add(e: FormEvent) {
    e.preventDefault()
    if (!f.titulo.trim()) return setErr('Informe o título da ideia.')
    run(() => supabase.from('ideas').insert({ user_id: uid, titulo: f.titulo.trim(), descricao: f.descricao || null, prioridade: f.prioridade }), 'Ideia registrada.')
    setF({ titulo: '', descricao: '', prioridade: 'media' })
  }

  /** Cria uma tarefa no Bloco 4 de hoje mantendo o vínculo (daily_tasks.idea_id). */
  async function toBlock4(idea: any) {
    try {
      const r = await ensureDay(uid, todayStr())
      const b = chk(await supabase.from('daily_blocks').select('id').eq('daily_record_id', r.id).eq('numero', 4).single()) as any
      const n = chk(await supabase.from('daily_tasks').select('ordem').eq('block_id', b.id).order('ordem', { ascending: false }).limit(1)) as any[]
      chk(await supabase.from('daily_tasks').insert({ user_id: uid, block_id: b.id, descricao: 'Ideia: ' + idea.titulo, ordem: (n[0]?.ordem ?? -1) + 1, idea_id: idea.id }) as any)
      chk(await supabase.from('ideas').update({ status: 'em_desenvolvimento' }).eq('id', idea.id) as any)
      setOk('Ideia adicionada como atividade do Bloco 4 de hoje.'); setErr(''); await load()
    } catch (e: any) { setErr(e.message) }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!ed.titulo.trim()) return setErr('Informe o título da ideia.')
    const r = await supabase.from('ideas').update({ titulo: ed.titulo.trim(), descricao: ed.descricao || null, prioridade: ed.prioridade }).eq('id', ed.id)
    if (r.error) return setErr(r.error.message)
    setEd(null); setErr(''); setOk('Ideia atualizada.'); load()
  }

  const list = ideas.filter((i) => !filter || i.status === filter)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Banco de ideias</h1>
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      <Card>
        <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-6">
          <Field label="Título" className="sm:col-span-2"><input className={inp} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
          <Field label="Descrição" className="sm:col-span-2"><input className={inp} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
          <Field label="Prioridade"><select className={inp} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}>{Object.entries(PR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <button className={btnP + ' self-end'}>+ Ideia</button>
        </form>
      </Card>
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-slate-500">Filtrar:</span>
          <select className={inp + ' !w-auto'} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todos os status</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {list.length === 0 ? <Empty>Nenhuma ideia registrada.</Empty> : list.map((i) => (
          <div key={i.id} className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="min-w-[200px] flex-1"><b>{i.titulo}</b><br /><small className="text-slate-500">{i.descricao} · registrada em {fmtDate(i.criado_em)}</small>{Date.parse(i.atualizado_em) - Date.parse(i.criado_em) > 2000 && <small className="ml-1 text-amber-700"> · editada {fmtDateTime(i.atualizado_em)}</small>}</div>
            <Chip color={PC[i.prioridade]}>{PR[i.prioridade]}</Chip>
            <select className={inp + ' !w-auto'} value={i.status} onChange={(e) => run(() => supabase.from('ideas').update({ status: e.target.value }).eq('id', i.id))}>
              {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {links[i.id]
              ? <span className="text-xs font-semibold text-green-700">✔ No Bloco 4{links[i.id].concluida ? ' (tarefa concluída)' : ''}</span>
              : <button className={btnG + ' ' + btnSm} onClick={() => toBlock4(i)}>→ Bloco 4</button>}
            <button className={btnG + ' ' + btnSm} onClick={() => setEd({ id: i.id, titulo: i.titulo, descricao: i.descricao || '', prioridade: i.prioridade })}>Editar</button>
            <button className="text-slate-400 hover:text-red-600" title="Excluir" onClick={() => { if (confirm('Excluir esta ideia?')) run(() => supabase.from('ideas').delete().eq('id', i.id)) }}>×</button>
          </div>
        ))}
      </Card>

      {ed && (
        <Modal title="Editar ideia" onClose={() => setEd(null)}>
          <form onSubmit={saveEdit} className="space-y-3">
            <Field label="Título"><input className={inp} value={ed.titulo} onChange={(e) => setEd({ ...ed, titulo: e.target.value })} /></Field>
            <Field label="Descrição"><textarea className={inp + ' min-h-[80px]'} value={ed.descricao} onChange={(e) => setEd({ ...ed, descricao: e.target.value })} /></Field>
            <Field label="Prioridade"><select className={inp} value={ed.prioridade} onChange={(e) => setEd({ ...ed, prioridade: e.target.value })}>{Object.entries(PR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <p className="text-xs text-slate-500">A alteração fica registrada (antes e depois) no log de auditoria.</p>
            <div className="flex justify-end gap-2"><button type="button" className={btnG} onClick={() => setEd(null)}>Cancelar</button><button className={btnP}>Salvar alterações</button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}
