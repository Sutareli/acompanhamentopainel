import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { BLOCK_COLORS, BLOCK_ICONS, DEFAULT_BLOCKS, chk, fmtDate, fmtMin, fmtSec, hhmm, todayStr } from '../lib/rules'
import { ensureDay } from '../lib/journal'
import { DEFAULT_SETTINGS, loadSettings, Settings } from '../lib/settings'
import { Bar, btnG, btnP, btnS, btnSm, Card, Chip, inp, Kpi, Msg } from '../components/ui'
import Resumo from '../components/Resumo'

interface Task { id: string; block_id: string; descricao: string; grupo: string | null; ordem: number; concluida: boolean; concluida_em: string | null; idea_id: string | null }
interface Block { id: string; numero: number; nome: string; duracao_planejada_min: number; acumulado_seg: number; em_execucao_desde: string | null; iniciado_em: string | null; finalizado_em: string | null; observacoes: string | null; daily_tasks: Task[] }

export default function Painel() {
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
  const [now, setNow] = useState(Date.now())
  const [version, setVersion] = useState(0)
  const [prep, setPrep] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await ensureDay(uid, date)
      setRec(r); setPrep(r.preparacao_proximo_dia || '')
      const [b, a, i, s] = await Promise.all([
        supabase.from('daily_blocks').select('*, daily_tasks(*)').eq('daily_record_id', r.id).order('numero'),
        supabase.from('agenda').select('duracao_min').eq('user_id', uid).eq('data', date),
        supabase.from('imprevistos').select('estimativa_min').eq('user_id', uid).eq('data', date),
        loadSettings(uid),
      ])
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
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
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

  const elapsed = (b: Block) => b.acumulado_seg + (b.em_execucao_desde ? (now - Date.parse(b.em_execucao_desde)) / 1000 : 0)
  const all = blocks.flatMap((b) => b.daily_tasks)
  const done = all.filter((t) => t.concluida).length
  const pct = all.length ? Math.round((done / all.length) * 100) : 0
  const worked = blocks.reduce((s, b) => s + elapsed(b), 0)
  const planned = blocks.reduce((s, b) => s + b.duracao_planejada_min, 0)
  const margem = cfg.margem_min - impMin
  const running = blocks.find((b) => b.em_execucao_desde)
  const hour = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', hour12: false }))
  const saud = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const T = cfg.atuacao_min + cfg.pausa_min + cfg.reunioes_min + cfg.margem_min || 1
  const seg = [
    { n: 'Atuação prática', v: cfg.atuacao_min, c: '#12295a', s: fmtSec(worked) + ' realizados' },
    { n: 'Pausa', v: cfg.pausa_min, c: '#64748b', s: '' },
    { n: 'Reuniões', v: cfg.reunioes_min, c: '#0ea5b7', s: fmtMin(meetMin) + ' registrados' },
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
          <h1 className="text-2xl font-bold text-navy">Minha Jornada de Trabalho</h1>
          <p className="text-sm text-slate-500">
            {saud}, {profile!.nome.split(' ')[0]}! {new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' })}, {fmtDate(date)}
          </p>
        </div>
      </div>

      {running && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-md" style={{ borderLeft: `8px solid ${BLOCK_COLORS[running.numero - 1]}` }}>
          <span className="live rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: BLOCK_COLORS[running.numero - 1] }}>● EM EXECUÇÃO</span>
          <b>{BLOCK_ICONS[running.numero - 1]} Bloco {running.numero}: {running.nome}</b>
          <span className="text-sm">Transcorrido <b>{fmtSec(elapsed(running))}</b></span>
          <span className="text-sm">{running.duracao_planejada_min * 60 - elapsed(running) >= 0 ? 'Restante ' + fmtSec(running.duracao_planejada_min * 60 - elapsed(running)) : 'Excedido ' + fmtSec(elapsed(running) - running.duracao_planejada_min * 60)}</span>
          <div className="min-w-[160px] flex-1"><Bar pct={(elapsed(running) / (running.duracao_planejada_min * 60)) * 100} color={BLOCK_COLORS[running.numero - 1]} /></div>
          <button className={btnP + ' ' + btnSm} onClick={() => act(() => supabase.rpc('bloco_parar', { p: running.id, p_finalizar: false }))}>⏸ Pausar</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi icon="📈" label="Execução das tarefas" value={pct + '%'} pct={pct} color="#0ea5b7" />
        <Kpi icon="✅" label="Tarefas concluídas" value={done} pct={pct} color="#16a34a" />
        <Kpi icon="⏳" label="Tarefas pendentes" value={all.length - done} pct={all.length ? 100 - pct : 0} color="#f59e0b" />
        <Kpi icon="⏱️" label="Tempo trabalhado" value={fmtSec(worked)} pct={planned ? (worked / (planned * 60)) * 100 : 0} sub={`meta ${fmtMin(planned)}`} />
        <Kpi icon="👥" label="Tempo em reuniões" value={fmtMin(meetMin)} pct={cfg.reunioes_min ? (meetMin / cfg.reunioes_min) * 100 : 0} color="#0ea5b7" sub={`de ${fmtMin(cfg.reunioes_min)} reservados`} />
        <Kpi icon="🧭" label="Margem flexível restante" value={fmtMin(margem)} pct={cfg.margem_min ? (Math.max(0, margem) / cfg.margem_min) * 100 : 0} color={margem < 0 ? '#dc2626' : '#12295a'} sub={`de ${fmtMin(cfg.margem_min)}, menos imprevistos`} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-5">
        {blocks.map((b) => (
          <BlockCard key={b.id + b.nome + b.duracao_planejada_min} b={b} now={now} el={elapsed(b)} act={act} toggle={toggle}
            prep={prep} setPrep={setPrep} recId={rec?.id} uid={uid} />
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

function BlockCard({ b, el, now, act, toggle, prep, setPrep, recId, uid }: {
  b: Block; el: number; now: number; act: (f: () => PromiseLike<any>) => void; toggle: (t: Task) => void
  prep: string; setPrep: (s: string) => void; recId: string; uid: string
}) {
  const color = BLOCK_COLORS[b.numero - 1]
  const [nt, setNt] = useState('')
  const [edit, setEdit] = useState(false)
  const [nome, setNome] = useState(b.nome)
  const [min, setMin] = useState(b.duracao_planejada_min)
  const [notes, setNotes] = useState(b.observacoes || '')
  const tasks = b.daily_tasks
  const nd = tasks.filter((t) => t.concluida).length
  const pct = tasks.length ? Math.round((nd / tasks.length) * 100) : 0
  const running = !!b.em_execucao_desde
  const plan = b.duracao_planejada_min * 60
  const st = b.finalizado_em || (tasks.length && nd === tasks.length) ? 'c' : nd > 0 || el > 0 || running ? 'a' : 'n'
  const stLabel = { c: 'Concluído', a: 'Em andamento', n: 'Não iniciado' }[st]
  const stColor = { c: '#16a34a', a: '#f59e0b', n: '#94a3b8' }[st]
  const objetivo = DEFAULT_BLOCKS[b.numero - 1]?.objetivo
  let g = ''

  return (
    <Card className={'flex flex-col gap-2 !p-5 ' + (running ? 'ring-4' : '')} >
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

      <div className={'rounded-xl border bg-slate-50 p-3 text-sm ' + (running ? '!border-2' : 'border-slate-200')} style={running ? { borderColor: color } : undefined}>
        {running && <span className="live mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: color }}>● EM EXECUÇÃO</span>}
        <div>⏱ <b className="text-base tabular-nums">{fmtSec(el)}</b> <small className="text-slate-500">/ {fmtMin(b.duracao_planejada_min)} planejados</small></div>
        <small className="text-slate-500">{plan - el >= 0 ? 'Restante: ' + fmtSec(plan - el) : 'Excedido: ' + fmtSec(el - plan)} · diferença {el / 60 - b.duracao_planejada_min >= 0 ? '+' : '−'}{Math.abs(Math.round(el / 60 - b.duracao_planejada_min))}min</small>
        <div className="mt-1"><Bar pct={(el / plan) * 100} color={el > plan ? '#dc2626' : color} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {running
          ? <button className={btnS + ' ' + btnSm} onClick={() => act(() => supabase.rpc('bloco_parar', { p: b.id, p_finalizar: false }))}>⏸ Pausar</button>
          : <button className={btnS + ' ' + btnSm} onClick={() => act(() => supabase.rpc('bloco_iniciar', { p: b.id }))}>▶ {b.acumulado_seg > 0 ? 'Retomar' : 'Iniciar'}</button>}
        <button className={btnG + ' ' + btnSm} onClick={() => act(() => supabase.rpc('bloco_parar', { p: b.id, p_finalizar: true }))}>⏹ Finalizar</button>
      </div>

      {b.numero === 5 && (
        <label className="block text-sm">
          <span className="font-semibold text-turq">PREPARAÇÃO PARA O PRÓXIMO DIA</span>
          <textarea className={inp + ' mt-1 min-h-[70px]'} placeholder="O que deixar pronto para amanhã?" value={prep} onChange={(e) => setPrep(e.target.value)}
            onBlur={() => act(() => supabase.from('daily_records').update({ preparacao_proximo_dia: prep || null }).eq('id', recId))} />
        </label>
      )}
      <textarea className={inp + ' min-h-[60px]'} placeholder="Observações do bloco" value={notes} onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if ((notes || null) !== (b.observacoes || null)) act(() => supabase.from('daily_blocks').update({ observacoes: notes || null }).eq('id', b.id)) }} />
    </Card>
  )
}
