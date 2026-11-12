import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { addDays, BLOCK_COLORS, BLOCK_ICONS, DEFAULT_BLOCKS, chk, fmtDate, fmtMin, hhmm, todayStr } from '../lib/rules'
import { ensureDay } from '../lib/journal'
import { DEFAULT_SETTINGS, loadSettings, Settings } from '../lib/settings'
import { Bar, btnG, btnP, btnS, btnSm, Card, Chip, inp, Kpi, Msg } from '../components/ui'
import Resumo from '../components/Resumo'
import EnviarProjetos from '../components/EnviarProjetos'

interface Task { id: string; block_id: string; descricao: string; grupo: string | null; ordem: number; concluida: boolean; concluida_em: string | null; idea_id: string | null }
export interface Futura { id: string; bloco_numero: number; data_alvo: string; descricao: string }
interface Block { id: string; numero: number; nome: string; duracao_planejada_min: number; observacoes: string | null; daily_tasks: Task[] }

export default function Painel({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { profile } = useAuth()
  const uid = profile!.id
  const [date, setDate] = useState(todayStr())
  const [rec, setRec] = useState<any>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [meetMin, setMeetMin] = useState(0)
  const [impMin, setImpMin] = useState(0)
  const [cfg, setCfg] = useState<Settings>(DEFAULT_SETTINGS)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [prep, setPrep] = useState('')
  const [clearing, setClearing] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [futuras, setFuturas] = useState<Futura[]>([])

  const load = useCallback(async () => {
    try {
      const r = await ensureDay(uid, date)
      // Atividades agendadas que já chegaram na data entram na lista do dia (uma única vez). Só faz sentido no dia de hoje.
      if (date === todayStr()) {
        const inc = await supabase.rpc('futuras_incorporar', { p_data: date })
        if (inc.error) throw new Error(inc.error.message)
      }
      setRec(r); setPrep(r.preparacao_proximo_dia || '')
      const [b, a, i, s, fu] = await Promise.all([
        supabase.from('daily_blocks').select('*, daily_tasks(*)').eq('daily_record_id', r.id).order('numero'),
        supabase.from('agenda').select('duracao_min').eq('user_id', uid).eq('data', date),
        supabase.from('imprevistos').select('estimativa_min').eq('user_id', uid).eq('data', date),
        loadSettings(uid),
        supabase.from('atividades_futuras').select('id,bloco_numero,data_alvo,descricao').eq('user_id', uid).is('incorporada_em', null).order('data_alvo'),
      ])
      setFuturas(chk(fu) as Futura[])
      const bd = chk(b) as Block[]
      bd.forEach((x) => x.daily_tasks.sort((p, q) => p.ordem - q.ordem))
      setBlocks(bd)
      setMeetMin(chk(a).reduce((s: number, x: any) => s + x.duracao_min, 0))
      setImpMin(chk(i).reduce((s: number, x: any) => s + x.estimativa_min, 0))
      setCfg(s); setErr(''); setVersion((v) => v + 1)
      if (bd.length === 0) setTimeout(load, 1200) // outra aba pode estar criando os blocos agora
    } catch (e: any) { setErr(e.message || 'Falha ao carregar o painel.') }
    setLoading(false)
  }, [uid, date])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const f = () => { const t = todayStr(); if (t !== date) setDate(t); else load() }
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [date, load])

  /** Executa uma operação no banco e recarrega; mostra erro legível se falhar. */
  const act = async (fn: () => PromiseLike<any>) => {
    try { chk(await fn() as any); await load() } catch (e: any) { setErr(e.message || 'Não foi possível salvar.'); load() }
  }

  async function toggle(t: Task) {
    const v = !t.concluida
    setBlocks((bs) => bs.map((b) => ({ ...b, daily_tasks: b.daily_tasks.map((x) => (x.id === t.id ? { ...x, concluida: v, concluida_em: v ? new Date().toISOString() : null } : x)) })))
    const r = await supabase.from('daily_tasks').update({ concluida: v }).eq('id', t.id)
    if (r.error) setErr(r.error.message)
    load()
  }

  const all = blocks.flatMap((b) => b.daily_tasks)
  const done = all.filter((t) => t.concluida).length
  const pct = all.length ? Math.round((done / all.length) * 100) : 0
  const blocksDone = blocks.filter((b) => b.daily_tasks.length > 0 && b.daily_tasks.every((t) => t.concluida)).length
  const margem = cfg.margem_min - impMin
  const hour = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', hour12: false }))
  const saud = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const T = cfg.atuacao_min + cfg.pausa_min + cfg.reunioes_min + cfg.margem_min || 1
  const seg = [
    { n: 'Atuação prática', v: cfg.atuacao_min, c: '#2e1a6e', s: '' },
    { n: 'Pausa', v: cfg.pausa_min, c: '#64748b', s: '' },
    { n: 'Reuniões', v: cfg.reunioes_min, c: '#8b3fff', s: fmtMin(meetMin) + ' registrados' },
    { n: 'Margem flexível', v: cfg.margem_min, c: '#f59e0b', s: fmtMin(impMin) + ' em imprevistos' },
  ]
  let acc = 0
  const conic = seg.map((s) => { const a = acc; acc += (s.v / T) * 100; return `${s.c} ${a}% ${acc}%` }).join(',')

  if (loading) return <p className="py-10 text-center text-slate-500">Carregando sua jornada…</p>

  return (
    <div className="space-y-4">
      {err && <Msg kind="erro">{err} <button className="underline" onClick={load}>Tentar novamente</button></Msg>}
      {date !== todayStr() && <Msg kind="aviso">O dia em exibição é {fmtDate(date)}.</Msg>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Gestão de atividades</h1>
          <p className="text-sm text-slate-500">
            {saud}, {profile!.nome.split(' ')[0]}! {new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' })}, {fmtDate(date)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnS + ' ' + btnSm} onClick={() => setEnviando(true)} disabled={all.length === 0}>📦 Enviar para Projetos</button>
          <button className={btnG + ' ' + btnSm} onClick={() => setClearing(true)} disabled={all.length === 0}>🧹 Limpar lista do dia</button>
        </div>
      </div>
      {enviando && <EnviarProjetos blocos={blocks} data={date} uid={uid} onClose={() => setEnviando(false)} onDone={load} onNavigate={onNavigate} />}
      {clearing && <ClearDialog total={all.length} done={done} onCancel={() => setClearing(false)} onConfirm={async (modo) => {
        setClearing(false)
        await act(() => supabase.rpc('dia_limpar', { p_record: rec.id, p_modo: modo }))
      }} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi icon="📈" label="Execução das tarefas" value={pct + '%'} pct={pct} color="#8b3fff" />
        <Kpi icon="✅" label="Tarefas concluídas" value={done} pct={pct} color="#16a34a" />
        <Kpi icon="⏳" label="Tarefas pendentes" value={all.length - done} pct={all.length ? 100 - pct : 0} color="#f59e0b" />
        <Kpi icon="🧱" label="Blocos concluídos" value={`${blocksDone}/${blocks.length || 5}`} pct={blocks.length ? (blocksDone / blocks.length) * 100 : 0} color="#2e1a6e" sub="todas as tarefas do bloco marcadas" />
        <Kpi icon="👥" label="Tempo em reuniões" value={fmtMin(meetMin)} pct={cfg.reunioes_min ? (meetMin / cfg.reunioes_min) * 100 : 0} color="#8b3fff" sub={`de ${fmtMin(cfg.reunioes_min)} reservados`} />
        <Kpi icon="🧭" label="Margem flexível restante" value={fmtMin(margem)} pct={cfg.margem_min ? (Math.max(0, margem) / cfg.margem_min) * 100 : 0} color={margem < 0 ? '#dc2626' : '#2e1a6e'} sub={`de ${fmtMin(cfg.margem_min)}, menos imprevistos`} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-5">
        {blocks.map((b) => (
          <BlockCard key={b.id + b.nome + b.duracao_planejada_min} b={b} act={act} toggle={toggle}
            prep={prep} setPrep={setPrep} recId={rec?.id} uid={uid} futuras={futuras.filter((f) => f.bloco_numero === b.numero)} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-navy">⏳ Distribuição da jornada ({fmtMin(T)})</h3>
          <div className="flex flex-wrap items-center gap-6">
            <div className="grid h-40 w-40 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${conic})` }}>
              <div className="grid h-24 w-24 place-content-center rounded-full bg-white text-center"><b>{fmtMin(T)}</b><small className="text-slate-500">jornada</small></div>
            </div>
            <div className="min-w-[200px] flex-1 space-y-2 text-sm">
              {seg.map((s) => (
                <div key={s.n}><i className="mr-2 inline-block h-3 w-3 rounded" style={{ background: s.c }} /><b>{s.n}</b> {fmtMin(s.v)} · {Math.round((s.v / T) * 100)}%<br /><small className="text-slate-500">{s.s}</small></div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex h-4 overflow-hidden rounded-full">{seg.map((s) => <i key={s.n} style={{ flex: s.v, background: s.c }} />)}</div>
        </Card>
        <Resumo userId={uid} n={7} version={version} />
      </div>
    </div>
  )
}

function BlockCard({ b, act, toggle, prep, setPrep, recId, uid, futuras }: {
  b: Block; act: (f: () => PromiseLike<any>) => void; toggle: (t: Task) => void
  prep: string; setPrep: (s: string) => void; recId: string; uid: string; futuras: Futura[]
}) {
  const color = BLOCK_COLORS[b.numero - 1]
  const [nt, setNt] = useState('')
  const [edit, setEdit] = useState(false)
  const [nome, setNome] = useState(b.nome)
  const [min, setMin] = useState(b.duracao_planejada_min)
  const tasks = b.daily_tasks
  const nd = tasks.filter((t) => t.concluida).length
  const pct = tasks.length ? Math.round((nd / tasks.length) * 100) : 0
  const st = tasks.length && nd === tasks.length ? 'c' : nd > 0 ? 'a' : 'n'
  const stLabel = { c: 'Concluído', a: 'Em andamento', n: 'Não iniciado' }[st]
  const stColor = { c: '#16a34a', a: '#f59e0b', n: '#94a3b8' }[st]
  const objetivo = DEFAULT_BLOCKS[b.numero - 1]?.objetivo
  let g = ''

  return (
    <Card className="flex flex-col gap-2 !p-5">
      <div style={{ borderTop: `5px solid ${color}`, margin: '-20px -20px 4px', borderRadius: '16px 16px 0 0' }} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold" style={{ color }}>{BLOCK_ICONS[b.numero - 1]} {b.numero}. {b.nome}</h3>
        <Chip color={stColor}>{stLabel}</Chip>
      </div>
      <p className="text-xs text-slate-500">{fmtMin(b.duracao_planejada_min)} · {objetivo}</p>
      <button className="self-start text-xs text-turq underline" onClick={() => setEdit(!edit)}>{edit ? 'Fechar edição' : 'Editar nome e duração'}</button>
      {edit && (
        <div className="flex flex-wrap gap-2">
          <input className={inp + ' flex-[3] min-w-[120px]'} value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className={inp + ' w-20'} type="number" min={5} value={min} onChange={(e) => setMin(+e.target.value)} />
          <button className={btnS + ' ' + btnSm} onClick={() => { if (nome.trim() && min >= 5) { act(() => supabase.from('daily_blocks').update({ nome: nome.trim(), duracao_planejada_min: min }).eq('id', b.id)); setEdit(false) } }}>Salvar</button>
        </div>
      )}
      <Bar pct={pct} color={color} />
      <small className="text-slate-500">{nd}/{tasks.length} tarefas · {pct}%</small>

      <div>
        {tasks.map((t) => {
          const h = t.grupo && t.grupo !== g ? (g = t.grupo, <div className="mt-2 text-xs font-semibold text-turq">{t.grupo}</div>) : null
          return (
            <div key={t.id}>
              {h}
              <div className="flex items-start gap-2 border-b border-dashed border-slate-200 py-1.5">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-green-600" checked={t.concluida} onChange={() => toggle(t)} />
                <input className={'min-w-0 flex-1 bg-transparent text-sm outline-none ' + (t.concluida ? 'text-slate-400 line-through' : '')} defaultValue={t.descricao}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.descricao) act(() => supabase.from('daily_tasks').update({ descricao: v }).eq('id', t.id)) }} />
                {t.concluida && t.concluida_em && <small className="text-green-700">✔ {hhmm(t.concluida_em)}</small>}
                <button className="text-slate-400 hover:text-red-600" title="Excluir tarefa" onClick={() => act(() => supabase.from('daily_tasks').delete().eq('id', t.id))}>×</button>
              </div>
            </div>
          )
        })}
        {tasks.length === 0 && <p className="text-sm text-slate-400">Sem tarefas.</p>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = nt.trim(); if (!v) return; setNt(''); act(() => supabase.from('daily_tasks').insert({ user_id: uid, block_id: b.id, descricao: v, grupo: tasks.length ? tasks[tasks.length - 1].grupo : null, ordem: tasks.length ? Math.max(...tasks.map((t) => t.ordem)) + 1 : 0 })) }}>
        <input className={inp} placeholder="Nova tarefa" value={nt} onChange={(e) => setNt(e.target.value)} />
        <button className={btnG + ' ' + btnSm}>+</button>
      </form>

      {b.numero === 5 && (
        <label className="block text-sm">
          <span className="font-semibold text-turq">PREPARAÇÃO PARA O PRÓXIMO DIA</span>
          <textarea className={inp + ' mt-1 min-h-[70px]'} placeholder="O que deixar pronto para amanhã?" value={prep} onChange={(e) => setPrep(e.target.value)}
            onBlur={() => act(() => supabase.from('daily_records').update({ preparacao_proximo_dia: prep || null }).eq('id', recId))} />
        </label>
      )}
      <Agendadas b={b} futuras={futuras} act={act} uid={uid} color={color} />
      <Adiar b={b} tasks={tasks} act={act} uid={uid} color={color} />
      {b.observacoes && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500"><b>Observação anterior:</b> {b.observacoes}</p>}
    </Card>
  )
}

/** Confirmação para limpar a lista do dia. As tarefas já concluídas são arquivadas no Histórico de atividades antes. */
function ClearDialog({ total, done, onCancel, onConfirm }: { total: number; done: number; onCancel: () => void; onConfirm: (modo: 'desmarcar' | 'excluir') => void }) {
  const [modo, setModo] = useState<'desmarcar' | 'excluir'>('desmarcar')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-navy">Limpar a lista de atividades do dia?</h3>
        <p className="mb-3 text-sm text-slate-600">Hoje há {total} tarefa(s), {done} concluída(s). As concluídas ficam guardadas no <b>Histórico de atividades</b>.</p>
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="radio" name="modo" className="mt-1" checked={modo === 'desmarcar'} onChange={() => setModo('desmarcar')} />
          <span><b>Desmarcar tudo</b> — mantém as tarefas e remove os “concluído”, para recomeçar o dia.</span>
        </label>
        <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="radio" name="modo" className="mt-1" checked={modo === 'excluir'} onChange={() => setModo('excluir')} />
          <span><b>Apagar todas as tarefas</b> — esvazia a lista do dia (você pode adicionar novas tarefas depois).</span>
        </label>
        <div className="flex justify-end gap-2">
          <button className={btnG} onClick={onCancel}>Cancelar</button>
          <button className={btnP + (modo === 'excluir' ? ' !bg-red-600' : '')} onClick={() => onConfirm(modo)}>{modo === 'excluir' ? 'Sim, apagar tudo' : 'Sim, desmarcar tudo'}</button>
        </div>
      </div>
    </div>
  )
}

/** Quadro de atividades futuras do bloco: ficam guardadas para a data escolhida e aparecem aqui até serem incorporadas à lista do dia. */
function Agendadas({ b, futuras, act, uid, color }: { b: Block; futuras: Futura[]; act: (f: () => PromiseLike<any>) => void; uid: string; color: string }) {
  const hoje = todayStr()
  const amanha = new Date(new Date(hoje + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
  const [txt, setTxt] = useState('')
  const [dt, setDt] = useState(amanha)
  const [open, setOpen] = useState(futuras.length > 0)
  const dias = (d: string) => Math.round((new Date(d + 'T12:00:00Z').getTime() - new Date(hoje + 'T12:00:00Z').getTime()) / 86400000)
  return (
    <div className="rounded-xl border border-dashed p-3" style={{ borderColor: color, background: color + '0d' }} aria-label={`Atividades futuras do bloco ${b.numero}`}>
      <button type="button" className="flex w-full items-center justify-between text-left text-xs font-bold" style={{ color }} onClick={() => setOpen(!open)}>
        <span>📅 Atividades futuras{futuras.length ? ` (${futuras.length})` : ''}</span><span>{open ? '▾' : '▸'}</span>
      </button>
      {futuras.length > 0 && (
        <ul className="mt-2 space-y-1">
          {futuras.map((f) => {
            const d = dias(f.data_alvo)
            return (
              <li key={f.id} className="flex items-start gap-2 rounded-lg bg-white px-2 py-1.5 text-sm shadow-sm">
                <span className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: color }} title={fmtDate(f.data_alvo)}>
                  {d <= 0 ? 'hoje' : d === 1 ? 'amanhã' : `${fmtDate(f.data_alvo).slice(0, 5)} · ${d}d`}
                </span>
                <span className="min-w-0 flex-1 break-words">{f.descricao}</span>
                <button className="text-slate-400 hover:text-red-600" title="Remover atividade futura" onClick={() => act(() => supabase.from('atividades_futuras').delete().eq('id', f.id))}>×</button>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const v = txt.trim(); if (!v || !dt || dt < amanha) return; setTxt(''); act(() => supabase.from('atividades_futuras').insert({ user_id: uid, bloco_numero: b.numero, data_alvo: dt, descricao: v })) }}>
          <input className={inp + ' min-w-[120px] flex-[3]'} placeholder="Atividade para outra data" aria-label="Descrição da atividade futura" value={txt} onChange={(e) => setTxt(e.target.value)} />
          <input className={inp + ' w-[9.5rem]'} type="date" min={amanha} aria-label="Data da atividade futura" value={dt} onChange={(e) => setDt(e.target.value)} />
          <button className={btnG + ' ' + btnSm}>Agendar</button>
        </form>
      )}
    </div>
  )
}

/**
 * "Alterar para dia seguinte": escolhe tarefas pendentes do bloco e as transfere para amanhã.
 * A tarefa sai da lista de hoje (não pesa na execução do dia) e é guardada como atividade futura do mesmo bloco para amanhã:
 * continua visível no quadro de atividades futuras e entra sozinha na lista de amanhã.
 */
function Adiar({ b, tasks, act, uid, color }: { b: Block; tasks: Task[]; act: (f: () => PromiseLike<any>) => void; uid: string; color: string }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const pend = tasks.filter((t) => !t.concluida)
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const close = () => { setOpen(false); setSel(new Set()) }
  const escolhidas = pend.filter((t) => sel.has(t.id))
  async function transferir() {
    if (!escolhidas.length) return
    const alvo = addDays(todayStr(), 1)
    const ids = escolhidas.map((t) => t.id)
    close()
    await act(async () => {
      const ins = await supabase.from('atividades_futuras').insert(escolhidas.map((t) => ({ user_id: uid, bloco_numero: b.numero, data_alvo: alvo, descricao: t.descricao })))
      if (ins.error) return ins
      return supabase.from('daily_tasks').delete().in('id', ids)
    })
  }
  if (!open) return (
    <button type="button" className="rounded-xl border px-3 py-2 text-left text-xs font-bold hover:bg-slate-50 disabled:opacity-50" style={{ borderColor: color, color }} disabled={pend.length === 0}
      title={pend.length ? 'Escolher tarefas pendentes para fazer amanhã' : 'Não há tarefas pendentes neste bloco'} onClick={() => setOpen(true)}>➡️ Alterar para dia seguinte</button>
  )
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: color }} aria-label={`Alterar para dia seguinte, bloco ${b.numero}`}>
      <div className="mb-1 flex items-center justify-between text-xs font-bold" style={{ color }}>
        <span>➡️ Transferir para o dia seguinte</span>
        <button type="button" className="underline" onClick={() => setSel(new Set(sel.size === pend.length ? [] : pend.map((t) => t.id)))}>{sel.size === pend.length ? 'Limpar seleção' : 'Selecionar todas'}</button>
      </div>
      <p className="mb-2 text-[11px] text-slate-500">As tarefas escolhidas saem de hoje (sem pesar na execução do dia) e entram na lista de amanhã, neste mesmo bloco.</p>
      <ul className="space-y-1">
        {pend.map((t) => (
          <li key={t.id}><label className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} /><span>{t.descricao}</span></label></li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={btnG + ' ' + btnSm} onClick={close}>Cancelar</button>
        <button type="button" className={btnS + ' ' + btnSm} disabled={!escolhidas.length} onClick={transferir}>Transferir {escolhidas.length ? `(${escolhidas.length})` : ''} para amanhã</button>
      </div>
    </div>
  )
}
