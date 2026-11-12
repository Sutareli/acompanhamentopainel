import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { useMicros } from '../lib/useMicros'
import { confirmar } from '../components/Confirm'
import {
  canAdmin, CRIT_COLOR, CRIT_LABEL, Crit, distribuicao, download, fmtDate, fmtDateTime, Micro, STATUS_COLOR, TIPO_COLOR, TIPO_LABEL, TipoProjeto, STATUS_LABEL, StatusGeral, statusGeral, toCSV, todayStr, validateMicro,
} from '../lib/rules'
import { btnG, btnP, btnS, btnSm, Card, Chip, Empty, Field, inp, Kpi, Modal, Msg, StackBar } from '../components/ui'

const EMPTY = { criticidade: 'media' as Crit, responsavel_id: '', demanda: '', resumo: '', data_target: '', quantidade: 1, a_iniciar: 1, em_andamento: 0, concluido: 0, cancelado: 0, observacoes: '', tipo_projeto: 'micro' as TipoProjeto, com_quem_id: '' }
type Form = typeof EMPTY
const FIELDS: [keyof Form, string][] = [['a_iniciar', 'A iniciar'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluído'], ['cancelado', 'Cancelado']]

export default function Microentregas({ presetResp, presetTipo }: { presetResp?: string; presetTipo?: TipoProjeto }) {
  const { profile } = useAuth()
  const { rows, profiles, loading, error, reload } = useMicros()
  const [fl, setFl] = useState({ tipo: (presetTipo || '') as '' | TipoProjeto, resp: presetResp || '', crit: '', status: '', mes: '', de: '', ate: '', atrasadas: false, q: '' })
  const [form, setForm] = useState<{ id?: string; v: Form } | null>(null)
  const [detail, setDetail] = useState<Micro | null>(null)
  const [msg, setMsg] = useState('')
  const [errDel, setErrDel] = useState('')
  async function excluir(r: Micro) {
    setErrDel('')
    if (!(await confirmar({ titulo: 'Excluir projeto?', mensagem: <>Excluir <b>“{r.demanda}”</b> com o histórico de alterações? Fica na <b>Lixeira por 48 horas</b> e pode ser restaurado; depois disso some de vez. Para só encerrar o projeto sem apagar, use <b>Editar</b> e marque as unidades como canceladas.</>, confirmar: 'Excluir projeto', perigo: true }))) return
    const x = await supabase.from('microdeliveries').delete().eq('id', r.id).select('id')
    if (x.error) return setErrDel('Não foi possível excluir: ' + x.error.message)
    if (!x.data?.length) return setErrDel('Você não tem permissão para excluir este projeto (somente quem o criou ou o Analista Sr).')
    setMsg('Projeto excluído.'); reload()
  }

  const ativos = profiles.filter((p) => p.ativo)
  const meses = useMemo(() => [...new Set(rows.map((r) => r.mes_referencia))].sort(), [rows])
  const list = useMemo(() => rows.filter((r) =>
    (!fl.tipo || r.tipo_projeto === fl.tipo) && (!fl.resp || r.responsavel_id === fl.resp) && (!fl.crit || r.criticidade === fl.crit) && (!fl.status || r.status_geral === fl.status) &&
    (!fl.mes || r.mes_referencia === fl.mes) && (!fl.de || r.data_target >= fl.de) && (!fl.ate || r.data_target <= fl.ate) &&
    (!fl.atrasadas || r.atrasada) && (!fl.q || r.demanda.toLowerCase().includes(fl.q.toLowerCase())),
  ), [rows, fl])

  const base = rows.filter((r) => !fl.tipo || r.tipo_projeto === fl.tipo)
  const cnt = (s: StatusGeral) => base.filter((r) => r.status_geral === s).length
  const upd = (id: string) => rows.find((r) => r.id === id) || null
  // mantém o modal de detalhes sincronizado quando outro usuário altera
  useEffect(() => { if (detail) setDetail(upd(detail.id)) }, [rows]) // eslint-disable-line

  function exportCSV() {
    download(`projetos-${todayStr()}.csv`, toCSV([
      ['Tipo', 'Criticidade', 'Responsável', 'Com quem está', 'Demanda', 'Resumo', 'Data Target', 'Mês de referência', 'Quantidade', 'A iniciar', 'Em andamento', 'Concluído', 'Cancelado', 'Status', 'Atrasada', 'Observações', 'Criado em', 'Atualizado em'],
      ...list.map((r) => [TIPO_LABEL[r.tipo_projeto], CRIT_LABEL[r.criticidade], r.responsavel_nome, r.com_quem_nome, r.demanda, r.resumo, fmtDate(r.data_target), r.mes_referencia.slice(0, 7), r.quantidade, r.a_iniciar, r.em_andamento, r.concluido, r.cancelado, STATUS_LABEL[r.status_geral], r.atrasada ? 'Sim' : 'Não', r.observacoes, fmtDateTime(r.criado_em), fmtDateTime(r.atualizado_em)]),
    ]))
  }

  if (loading) return <p className="py-10 text-center text-slate-500">Carregando projetos…</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-navy">Projetos</h1>
        <div className="flex gap-2">
          <button className={btnG} onClick={exportCSV} disabled={!list.length}>⬇ Exportar CSV ({list.length})</button>
          <button className={btnS} onClick={() => setForm({ v: { ...EMPTY, tipo_projeto: fl.tipo || 'micro', responsavel_id: profile!.id } })}>+ Novo Projeto</button>
        </div>
      </div>
      {errDel && <Msg kind="erro">{errDel}</Msg>}
      {error && <Msg kind="erro">{error} <button className="underline" onClick={reload}>Tentar novamente</button></Msg>}
      {msg && <Msg kind="ok">{msg}</Msg>}
      <Seg value={fl.tipo} onChange={(t) => setFl({ ...fl, tipo: t })} contagem={{ '': rows.length, macro: rows.filter((r) => r.tipo_projeto === 'macro').length, micro: rows.filter((r) => r.tipo_projeto === 'micro').length }} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Kpi icon="📦" label="Total" value={base.length} />
        <Kpi icon="⚪" label="A iniciar" value={cnt('a_iniciar')} color="#64748b" />
        <Kpi icon="🔵" label="Em andamento" value={cnt('em_andamento')} color="#2563eb" />
        <Kpi icon="✅" label="Concluídas" value={cnt('concluido')} color="#16a34a" />
        <Kpi icon="☑️" label="Concl. c/ cancelamentos" value={cnt('concluido_parcial')} color="#0d9488" />
        <Kpi icon="🚫" label="Canceladas" value={cnt('cancelado')} color="#f87171" />
        <Kpi icon="⚠️" label="Atrasadas" value={base.filter((r) => r.atrasada).length} color="#dc2626" />
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <select className={inp} value={fl.resp} onChange={(e) => setFl({ ...fl, resp: e.target.value })}><option value="">Responsável</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
          <select className={inp} value={fl.crit} onChange={(e) => setFl({ ...fl, crit: e.target.value })}><option value="">Criticidade</option>{Object.entries(CRIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={inp} value={fl.status} onChange={(e) => setFl({ ...fl, status: e.target.value })}><option value="">Status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={inp} value={fl.mes} onChange={(e) => setFl({ ...fl, mes: e.target.value })}><option value="">Mês</option>{meses.map((m) => <option key={m} value={m}>{m.slice(5, 7)}/{m.slice(0, 4)}</option>)}</select>
          <input type="date" className={inp} title="Target a partir de" value={fl.de} onChange={(e) => setFl({ ...fl, de: e.target.value })} />
          <input type="date" className={inp} title="Target até" value={fl.ate} onChange={(e) => setFl({ ...fl, ate: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fl.atrasadas} onChange={(e) => setFl({ ...fl, atrasadas: e.target.checked })} />Atrasadas</label>
          <input className={inp} placeholder="Pesquisar demanda…" value={fl.q} onChange={(e) => setFl({ ...fl, q: e.target.value })} />
        </div>
      </Card>

      <Card className="!p-0">
        {list.length === 0 ? <div className="p-5"><Empty>{rows.length ? 'Nenhum projeto corresponde aos filtros.' : 'Nenhum projeto cadastrado. Use “Novo Projeto”.'}</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{['Tipo', 'Criticidade', 'Responsável', 'Demanda', 'Data Target', 'Status', 'Progresso', 'Última atualização', 'Ações'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-3 py-2.5"><Chip color={TIPO_COLOR[r.tipo_projeto]}>{TIPO_LABEL[r.tipo_projeto]}</Chip></td>
                    <td className="px-3 py-2.5"><Chip color={CRIT_COLOR[r.criticidade]}>{CRIT_LABEL[r.criticidade]}</Chip></td>
                    <td className="px-3 py-2.5">{r.responsavel_nome}{r.tipo_projeto === 'macro' && r.com_quem_nome && <div className="text-xs text-slate-500">com {r.com_quem_nome}</div>}</td>
                    <td className="max-w-xs px-3 py-2.5"><b>{r.demanda}</b><div className="text-xs text-slate-500">{r.quantidade} unidade(s)</div></td>
                    <td className={'whitespace-nowrap px-3 py-2.5 ' + (r.atrasada ? 'font-bold text-red-600' : '')}>{fmtDate(r.data_target)}{r.atrasada && <div className="text-xs">atrasada</div>}</td>
                    <td className="px-3 py-2.5"><Chip color={STATUS_COLOR[r.status_geral]}>{STATUS_LABEL[r.status_geral]}</Chip>
                      {[r.a_iniciar, r.em_andamento, r.concluido, r.cancelado].filter(Boolean).length > 1 && <div className="mt-1 text-xs text-slate-500">{distribuicao(r)}</div>}</td>
                    <td className="w-44 px-3 py-2.5">
                      <StackBar parts={[{ v: r.concluido, c: STATUS_COLOR.concluido }, { v: r.em_andamento, c: STATUS_COLOR.em_andamento }, { v: r.cancelado, c: STATUS_COLOR.cancelado }, { v: r.a_iniciar, c: '#cbd5e1' }]} />
                      <div className="mt-1 text-xs text-slate-500">{r.pct_conclusao === null ? '—' : r.pct_conclusao + '% concluído'}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{fmtDateTime(r.atualizado_em)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <button className={btnG + ' ' + btnSm} onClick={() => setDetail(r)}>Ver</button>{' '}
                      <button className={btnG + ' ' + btnSm} onClick={() => setForm({ id: r.id, v: { criticidade: r.criticidade, responsavel_id: r.responsavel_id, demanda: r.demanda, resumo: r.resumo || '', data_target: r.data_target, quantidade: r.quantidade, a_iniciar: r.a_iniciar, em_andamento: r.em_andamento, concluido: r.concluido, cancelado: r.cancelado, observacoes: r.observacoes || '', tipo_projeto: r.tipo_projeto, com_quem_id: r.com_quem_id || '' } })}>Editar</button>
                      {(r.criado_por === profile!.id || canAdmin(profile!.perfil)) && <>{' '}<button className={btnG + ' ' + btnSm + ' !border-red-200 !text-red-600 hover:!bg-red-50'} title="Excluir projeto" onClick={() => excluir(r)}>Excluir</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && <FormModal init={form} ativos={ativos} uid={profile!.id} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMsg(t); reload() }} />}
      {detail && <Detail m={detail} ativos={ativos} onClose={() => setDetail(null)} onChanged={() => reload()} />}
    </div>
  )
}

function FormModal({ init, ativos, uid, onClose, onSaved }: { init: { id?: string; v: Form }; ativos: { id: string; nome: string }[]; uid: string; onClose: () => void; onSaved: (t: string) => void }) {
  const [v, setV] = useState<Form>(init.v)
  const [touched, setTouched] = useState(!!init.id)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const soma = v.a_iniciar + v.em_andamento + v.concluido + v.cancelado
  const num = (x: string) => (x === '' ? 0 : Number(x))

  async function save(e: FormEvent) {
    e.preventDefault()
    const m = validateMicro(v)
    if (m) return setErr(m)
    setBusy(true)
    const payload = { criticidade: v.criticidade, responsavel_id: v.responsavel_id, demanda: v.demanda.trim(), resumo: v.resumo || null, data_target: v.data_target, quantidade: v.quantidade, a_iniciar: v.a_iniciar, em_andamento: v.em_andamento, concluido: v.concluido, cancelado: v.cancelado, observacoes: v.observacoes || null, tipo_projeto: v.tipo_projeto, com_quem_id: v.tipo_projeto === 'macro' && v.com_quem_id ? v.com_quem_id : null }
    const r = init.id ? await supabase.from('microdeliveries').update(payload).eq('id', init.id) : await supabase.from('microdeliveries').insert({ ...payload, criado_por: uid })
    setBusy(false)
    if (r.error) return setErr(r.error.message.includes('soma_confere') ? 'A soma dos status deve ser igual à quantidade total.' : r.error.message)
    onSaved(init.id ? 'Projeto atualizado.' : 'Projeto cadastrado.')
  }

  return (
    <Modal title={init.id ? 'Editar projeto' : 'Novo projeto'} onClose={onClose} wide>
      {err && <Msg kind="erro">{err}</Msg>}
      <form onSubmit={save} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 text-sm md:col-span-4"><span className="mb-1 block font-medium text-slate-600">Tipo de projeto *</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="radiogroup" aria-label="Tipo de projeto">
            {(['macro', 'micro'] as TipoProjeto[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={v.tipo_projeto === t} onClick={() => setV({ ...v, tipo_projeto: t })}
                className={'px-4 py-2 text-sm font-semibold ' + (v.tipo_projeto === t ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50')} style={v.tipo_projeto === t ? { background: TIPO_COLOR[t] } : undefined}>{TIPO_LABEL[t]}</button>
            ))}
          </div>
        </div>
        <Field label="Demanda *" className="col-span-2 md:col-span-4"><input className={inp} value={v.demanda} onChange={(e) => setV({ ...v, demanda: e.target.value })} /></Field>
        <Field label="Resumo" className="col-span-2 md:col-span-4"><textarea className={inp + ' min-h-[70px]'} value={v.resumo} onChange={(e) => setV({ ...v, resumo: e.target.value })} /></Field>
        <Field label="Criticidade" className="col-span-1"><select className={inp} value={v.criticidade} onChange={(e) => setV({ ...v, criticidade: e.target.value as Crit })}>{Object.entries(CRIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Responsável *" className="col-span-1 md:col-span-2"><select className={inp} value={v.responsavel_id} onChange={(e) => setV({ ...v, responsavel_id: e.target.value })}><option value="">Selecione…</option>{ativos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        {v.tipo_projeto === 'macro' && (
          <Field label="Com quem está agora" className="col-span-2 md:col-span-4"><select className={inp} value={v.com_quem_id} onChange={(e) => setV({ ...v, com_quem_id: e.target.value })}><option value="">— ninguém / não definido —</option>{ativos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        )}
        <Field label="Data Target *" className="col-span-2 md:col-span-1"><input type="date" className={inp} value={v.data_target} onChange={(e) => setV({ ...v, data_target: e.target.value })} /></Field>
        <Field label="Quantidade total *"><input type="number" min={1} className={inp} value={v.quantidade} onChange={(e) => { const q = num(e.target.value); setV({ ...v, quantidade: q, ...(touched ? {} : { a_iniciar: q }) }) }} /></Field>
        {FIELDS.map(([k, l]) => (
          <Field key={k} label={l}><input type="number" min={0} className={inp} value={v[k] as number} onChange={(e) => { setTouched(true); setV({ ...v, [k]: num(e.target.value) }) }} /></Field>
        ))}
        <div className={'col-span-2 self-end text-sm md:col-span-3 ' + (soma === v.quantidade ? 'text-green-700' : 'font-semibold text-red-600')}>
          Soma dos status: {soma} / {v.quantidade}
          {soma === v.quantidade && v.quantidade > 0 && <> · status geral: <Chip color={STATUS_COLOR[statusGeral(v.a_iniciar, v.em_andamento, v.concluido, v.cancelado, v.quantidade)]}>{STATUS_LABEL[statusGeral(v.a_iniciar, v.em_andamento, v.concluido, v.cancelado, v.quantidade)]}</Chip></>}
        </div>
        <Field label="Observações" className="col-span-2 md:col-span-4"><textarea className={inp + ' min-h-[60px]'} value={v.observacoes} onChange={(e) => setV({ ...v, observacoes: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2 md:col-span-4">
          <button type="button" className={btnG} onClick={onClose}>Cancelar</button>
          <button className={btnP} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function Detail({ m, ativos, onClose, onChanged }: { m: Micro; ativos: any[]; onClose: () => void; onChanged: () => void }) {
  const [hist, setHist] = useState<any[]>([])
  const [mv, setMv] = useState({ de: 'a_iniciar', para: 'em_andamento', qtd: 1, obs: '' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const loadH = () => supabase.from('microdelivery_history').select('*, usuario:profiles(nome)').eq('microdelivery_id', m.id).order('data_hora', { ascending: false }).then(({ data, error }) => error ? setErr(error.message) : setHist(data || []))
  useEffect(() => { loadH() }, [m.id, m.atualizado_em]) // eslint-disable-line
  const nome = (id: string) => ativos.find((p) => p.id === id)?.nome || id
  const LABEL: Record<string, string> = { criacao: 'Criação', status_geral: 'Status geral', criticidade: 'Criticidade', responsavel_id: 'Responsável', demanda: 'Demanda', resumo: 'Resumo', data_target: 'Data Target', quantidade: 'Quantidade', a_iniciar: 'A iniciar', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado', observacoes: 'Observações', tipo_projeto: 'Tipo de projeto', com_quem_id: 'Com quem está' }
  const show = (campo: string, x: string | null) => x === null ? '—' : campo === 'status_geral' ? STATUS_LABEL[x as StatusGeral] || x : campo === 'responsavel_id' || campo === 'com_quem_id' ? nome(x) : campo === 'tipo_projeto' ? TIPO_LABEL[x as TipoProjeto] || x : campo === 'data_target' ? fmtDate(x) : campo === 'criticidade' ? CRIT_LABEL[x as Crit] || x : x

  async function move(e: FormEvent) {
    e.preventDefault(); setErr(''); setOk('')
    if (mv.de === mv.para) return setErr('Escolha status diferentes.')
    if (!Number.isInteger(mv.qtd) || mv.qtd < 1) return setErr('Informe uma quantidade inteira maior que zero.')
    const r = await supabase.rpc('md_mover', { p_id: m.id, p_de: mv.de, p_para: mv.para, p_qtd: mv.qtd, p_obs: mv.obs || null })
    if (r.error) return setErr(r.error.message.includes('insuficientes') ? 'Não há unidades suficientes no status de origem.' : r.error.message)
    setOk('Unidades movidas.'); setMv({ ...mv, obs: '' }); onChanged()
  }

  return (
    <Modal title={m.demanda} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-2"><Chip color={TIPO_COLOR[m.tipo_projeto]}>{TIPO_LABEL[m.tipo_projeto]}</Chip><Chip color={CRIT_COLOR[m.criticidade]}>{CRIT_LABEL[m.criticidade]}</Chip><Chip color={STATUS_COLOR[m.status_geral]}>{STATUS_LABEL[m.status_geral]}</Chip>{m.atrasada && <Chip color="#dc2626">Atrasada</Chip>}</div>
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
        <div><dt className="text-slate-500">Responsável</dt><dd>{m.responsavel_nome}</dd></div>
        {m.tipo_projeto === 'macro' && <div><dt className="text-slate-500">Com quem está</dt><dd>{m.com_quem_nome || '—'}</dd></div>}
        <div><dt className="text-slate-500">Data Target</dt><dd>{fmtDate(m.data_target)}</dd></div>
        <div><dt className="text-slate-500">Mês de referência</dt><dd>{m.mes_referencia.slice(5, 7)}/{m.mes_referencia.slice(0, 4)}</dd></div>
        <div><dt className="text-slate-500">Criada em</dt><dd>{fmtDateTime(m.criado_em)}</dd></div>
        <div><dt className="text-slate-500">Última atualização</dt><dd>{fmtDateTime(m.atualizado_em)}</dd></div>
        <div><dt className="text-slate-500">Quantidade</dt><dd>{m.quantidade} · {distribuicao(m)}</dd></div>
      </dl>
      {m.resumo && <p className="mb-2 text-sm"><b>Resumo:</b> {m.resumo}</p>}
      {m.observacoes && <p className="mb-3 text-sm"><b>Observações:</b> {m.observacoes}</p>}
      <StackBar parts={[{ v: m.concluido, c: STATUS_COLOR.concluido }, { v: m.em_andamento, c: STATUS_COLOR.em_andamento }, { v: m.cancelado, c: STATUS_COLOR.cancelado }, { v: m.a_iniciar, c: '#cbd5e1' }]} />

      <h4 className="mb-2 mt-4 font-bold text-navy">Mover unidades entre status</h4>
      {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
      <form onSubmit={move} className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <select className={inp} value={mv.de} onChange={(e) => setMv({ ...mv, de: e.target.value })}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>De: {l}</option>)}</select>
        <select className={inp} value={mv.para} onChange={(e) => setMv({ ...mv, para: e.target.value })}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>Para: {l}</option>)}</select>
        <input type="number" min={1} className={inp} value={mv.qtd} onChange={(e) => setMv({ ...mv, qtd: Number(e.target.value) })} />
        <input className={inp + ' col-span-2 md:col-span-1'} placeholder="Observação (opcional)" value={mv.obs} onChange={(e) => setMv({ ...mv, obs: e.target.value })} />
        <button className={btnS}>Mover</button>
      </form>

      <h4 className="mb-2 font-bold text-navy">Histórico</h4>
      {hist.length === 0 ? <Empty>Sem movimentações.</Empty> : (
        <ol className="space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
          {hist.map((h) => (
            <li key={h.id}>
              <div className="text-xs text-slate-500">{fmtDateTime(h.data_hora)} · {h.usuario?.nome || 'sistema'}</div>
              {h.campo_alterado === 'criacao' ? <div>Projeto criado.</div> : <div><b>{LABEL[h.campo_alterado] || h.campo_alterado}:</b> {show(h.campo_alterado, h.valor_anterior)} → {show(h.campo_alterado, h.valor_novo)}</div>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}

/** Alternância Todos · MacroProjetos · MicroProjetos (usada no cadastro e na Gestão da equipe). */
export function Seg({ value, onChange, contagem }: { value: '' | TipoProjeto; onChange: (t: '' | TipoProjeto) => void; contagem?: Record<string, number> }) {
  const opts: ['' | TipoProjeto, string][] = [['', 'Todos'], ['macro', 'MacroProjetos'], ['micro', 'MicroProjetos']]
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="tablist" aria-label="Tipo de projeto">
      {opts.map(([k, l]) => (
        <button key={k || 'todos'} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={'px-4 py-2 text-sm font-semibold transition ' + (value === k ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>
          {l}{contagem && <span className={'ml-1.5 rounded-full px-1.5 text-xs ' + (value === k ? 'bg-white/20' : 'bg-slate-100')}>{contagem[k]}</span>}
        </button>
      ))}
    </div>
  )
}
