import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { useMicros } from '../lib/useMicros'
import { canAdmin, CRIT_COLOR, CRIT_LABEL, download, fmtDate, Perfil, PERFIL_LABEL, PERFIS, STATUS_COLOR, STATUS_LABEL, StatusGeral, TIPO_COLOR, TipoProjeto, toCSV, todayStr, TZ, Micro } from '../lib/rules'
import { Bar, btnG, btnP, Card, Chip, Empty, Field, HBars, inp, Kpi, Msg, StackBar, VBars } from '../components/ui'
import Microentregas, { Seg } from './Microentregas'
import { confirmar } from '../components/Confirm'

export default function Equipe() {
  const { profile } = useAuth()
  const { rows: todas, profiles, loading, error, reload } = useMicros()
  const [tipo, setTipo] = useState<'' | TipoProjeto>('')   // '' = consolidado
  const rows = useMemo(() => todas.filter((r) => !tipo || r.tipo_projeto === tipo), [todas, tipo])
  const isGestor = canAdmin(profile!.perfil) // administração de usuários: só Analista Sr (e o banco também exige)
  const [sel, setSel] = useState<string | null>(null)
  const [hist, setHist] = useState<any[]>([])
  const [inv, setInv] = useState({ nome: '', email: '', perfil: 'analista' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('microdelivery_history').select('valor_anterior,valor_novo,data_hora').eq('campo_alterado', 'concluido').order('data_hora').limit(10000)
      .then(({ data }) => setHist(data || []))
  }, [rows])

  const sum = (f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0)
  const unidades = sum((r) => r.quantidade), conc = sum((r) => r.concluido), canc = sum((r) => r.cancelado)
  const pctGeral = unidades - canc > 0 ? Math.round((conc / (unidades - canc)) * 100) : 0
  const cnt = (s: StatusGeral) => rows.filter((r) => r.status_geral === s).length

  const porResp = useMemo(() => {
    const ids = [...new Set([...profiles.filter((p) => p.ativo).map((p) => p.id), ...rows.map((r) => r.responsavel_id)])]
    return ids.map((id) => {
      const m = rows.filter((r) => r.responsavel_id === id)
      const u = m.reduce((a, r) => a + r.quantidade, 0), c = m.reduce((a, r) => a + r.concluido, 0), x = m.reduce((a, r) => a + r.cancelado, 0)
      return {
        id, nome: profiles.find((p) => p.id === id)?.nome || id, total: m.length,
        ini: m.filter((r) => r.status_geral === 'a_iniciar').length, and: m.filter((r) => r.status_geral === 'em_andamento').length,
        con: m.filter((r) => r.status_geral === 'concluido').length, par: m.filter((r) => r.status_geral === 'concluido_parcial').length, atr: m.filter((r) => r.atrasada).length,
        pct: u - x > 0 ? Math.round((c / (u - x)) * 100) : null,
      }
    }).sort((a, b) => b.total - a.total)
  }, [rows, profiles])

  const porMes = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => m.set(r.mes_referencia, (m.get(r.mes_referencia) || 0) + r.concluido))
    return [...m.entries()].sort().map(([k, v]) => ({ label: k.slice(5, 7) + '/' + k.slice(2, 4), value: v }))
  }, [rows])

  const evolucao = useMemo(() => {
    const d = new Map<string, number>()
    hist.forEach((h) => { const k = new Date(h.data_hora).toLocaleDateString('en-CA', { timeZone: TZ }); d.set(k, (d.get(k) || 0) + (Number(h.valor_novo) - Number(h.valor_anterior || 0))) })
    let acc = 0
    return [...d.entries()].sort().map(([k, v]) => { acc += v; return { label: k.slice(8) + '/' + k.slice(5, 7), value: acc, title: `${fmtDate(k)}: ${acc} unidade(s) concluída(s) acumuladas` } }).slice(-30)
  }, [hist])

  async function excluirUsuario(p: { id: string; nome: string }) {
    setErr(''); setMsg('')
    if (!(await confirmar({ titulo: 'Excluir usuário?', mensagem: <>O acesso de <b>{p.nome}</b> é bloqueado agora. Você pode restaurar o usuário na <b>Lixeira</b> por 48 horas; depois disso a conta e os dados pessoais (jornadas, agenda, ideias e modelos) são apagados definitivamente. Se for só uma saída temporária, prefira <b>desativar</b>.</>, confirmar: 'Excluir usuário', perigo: true }))) return
    const r = await supabase.rpc('usuario_excluir', { p_id: p.id })
    if (r.error) return setErr(r.error.message)
    setMsg(`Usuário ${p.nome} excluído. Dá para restaurar na Lixeira por 48 h.`); reload()
  }

  async function invite(e: FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!inv.nome.trim() || !/^\S+@\S+\.\S+$/.test(inv.email)) return setErr('Informe nome e um e-mail válido.')
    setBusy(true)
    const r = await supabase.functions.invoke('invite-user', { body: { nome: inv.nome.trim(), email: inv.email.trim(), perfil: inv.perfil } })
    setBusy(false)
    if (r.error || (r.data as any)?.error) return setErr('Não foi possível enviar o convite: ' + ((r.data as any)?.error || r.error!.message))
    setMsg(`Convite enviado para ${inv.email}.`); setInv({ nome: '', email: '', perfil: 'analista' }); reload()
  }
  async function patch(id: string, p: any) {
    const r = await supabase.from('profiles').update(p).eq('id', id)
    if (r.error) setErr(r.error.message); else reload()
  }

  function exportResumo() {
    download(`acompanhamento-equipe-${tipo || 'consolidado'}-${todayStr()}.csv`, toCSV([
      ['Analista', 'MacroProjetos', 'MicroProjetos', 'Total', 'A iniciar', 'Em andamento', 'Concluídas', 'Concl. c/ cancelamentos', 'Atrasadas', '% conclusão (unidades)'],
      ...porResp.map((a) => [a.nome, todas.filter((r) => r.responsavel_id === a.id && r.tipo_projeto === 'macro').length, todas.filter((r) => r.responsavel_id === a.id && r.tipo_projeto === 'micro').length, a.total, a.ini, a.and, a.con, a.par, a.atr, a.pct ?? '—']),
    ]))
  }

  if (loading) return <p className="py-10 text-center text-slate-500">Carregando painel gerencial…</p>
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">{isGestor ? 'Gestão da equipe' : 'Visão consolidada da equipe'}</h1>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="tablist" aria-label="Visão dos projetos">
          {([['', 'Consolidado'], ['macro', 'MacroProjetos'], ['micro', 'MicroProjetos']] as ['' | TipoProjeto, string][]).map(([k, l]) => (
            <button key={k || 'cons'} role="tab" aria-selected={tipo === k} onClick={() => { setTipo(k); setSel(null) }}
              className={'px-4 py-2 text-sm font-semibold transition ' + (tipo === k ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {l}<span className={'ml-1.5 rounded-full px-1.5 text-xs ' + (tipo === k ? 'bg-white/20' : 'bg-slate-100')}>{k ? todas.filter((r) => r.tipo_projeto === k).length : todas.length}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{tipo === 'macro' ? 'Projetos maiores: quem é o responsável e com quem cada um está agora.' : tipo === 'micro' ? 'Projetos menores, acompanhados por unidades.' : 'MacroProjetos e MicroProjetos somados, com o comparativo entre os dois.'}</span>
      </div>
      {error && <Msg kind="erro">{error}</Msg>}
      {err && <Msg kind="erro">{err}</Msg>}
      {msg && <Msg kind="ok">{msg}</Msg>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <Kpi icon="📦" label={tipo === 'macro' ? 'MacroProjetos' : tipo === 'micro' ? 'MicroProjetos' : 'Projetos cadastrados'} value={rows.length} />
        <Kpi icon="✅" label="Concluídas" value={cnt('concluido')} color="#16a34a" />
        <Kpi icon="☑️" label="Concl. c/ cancelamentos" value={cnt('concluido_parcial')} color="#0d9488" />
        <Kpi icon="🔵" label="Em andamento" value={cnt('em_andamento')} color="#2563eb" />
        <Kpi icon="⚪" label="A iniciar" value={cnt('a_iniciar')} color="#64748b" />
        <Kpi icon="🚫" label="Canceladas" value={cnt('cancelado')} color="#f87171" />
        <Kpi icon="⚠️" label="Atrasadas" value={rows.filter((r) => r.atrasada).length} color="#dc2626" />
        <Kpi icon="📈" label="% geral de conclusão" value={pctGeral + '%'} pct={pctGeral} color="#8b3fff" sub="unidades concluídas ÷ (total − canceladas)" />
      </div>

      {tipo === '' && todas.length > 0 && <Comparativo todas={todas} />}
      {tipo === 'macro' && <QuadroMacro rows={rows} profiles={profiles} />}

      {rows.length === 0 ? <Empty>Ainda não há projetos nesta visão. Os gráficos aparecem assim que houver registros.</Empty> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card><h3 className="mb-3 font-bold text-navy">Projetos por responsável</h3><HBars rows={porResp.filter((a) => a.total).map((a) => ({ label: a.nome, value: a.total }))} /></Card>
          <Card><h3 className="mb-3 font-bold text-navy">Distribuição por criticidade</h3><HBars rows={(Object.keys(CRIT_LABEL) as (keyof typeof CRIT_LABEL)[]).map((k) => ({ label: CRIT_LABEL[k], value: rows.filter((r) => r.criticidade === k).length, color: CRIT_COLOR[k] }))} /></Card>
          <Card><h3 className="mb-3 font-bold text-navy">Distribuição por status</h3><HBars rows={(Object.keys(STATUS_LABEL) as StatusGeral[]).map((k) => ({ label: STATUS_LABEL[k], value: cnt(k), color: STATUS_COLOR[k] }))} /></Card>
          <Card><h3 className="mb-1 font-bold text-navy">Unidades concluídas por mês de referência</h3><VBars rows={porMes} /></Card>
          <Card><h3 className="mb-3 font-bold text-navy">Entregas atrasadas por responsável</h3><HBars rows={porResp.map((a) => ({ label: a.nome, value: a.atr, color: '#dc2626' }))} empty="Nenhuma entrega atrasada." /></Card>
          <Card><h3 className="mb-1 font-bold text-navy">Evolução da conclusão (acumulado)</h3>{evolucao.length ? <VBars rows={evolucao} /> : <Empty>Sem conclusões registradas.</Empty>}</Card>
        </div>
      )}

      <Card className="!p-0">
        <div className="flex items-center justify-between p-4"><h3 className="font-bold text-navy">Acompanhamento individual</h3><button className={btnG} onClick={exportResumo}>⬇ CSV</button></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Analista</th>{[...(tipo === '' ? ['Macro', 'Micro'] : []), 'Total', 'A iniciar', 'Em andamento', 'Concluídas', 'Concl. c/ cancel.', 'Atrasadas', '% conclusão'].map((h) => <th key={h} className="px-4 py-2 text-right">{h}</th>)}</tr></thead>
            <tbody>
              {porResp.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2"><button className="font-semibold text-turq underline" onClick={() => setSel(sel === a.id ? null : a.id)}>{a.nome}</button></td>
                  {tipo === '' && <><td className="px-4 py-2 text-right">{todas.filter((r) => r.responsavel_id === a.id && r.tipo_projeto === 'macro').length}</td><td className="px-4 py-2 text-right">{todas.filter((r) => r.responsavel_id === a.id && r.tipo_projeto === 'micro').length}</td></>}<td className="px-4 py-2 text-right">{a.total}</td><td className="px-4 py-2 text-right">{a.ini}</td><td className="px-4 py-2 text-right">{a.and}</td><td className="px-4 py-2 text-right">{a.con}</td><td className="px-4 py-2 text-right">{a.par}</td>
                  <td className={'px-4 py-2 text-right ' + (a.atr ? 'font-bold text-red-600' : '')}>{a.atr}</td><td className="px-4 py-2 text-right">{a.pct === null ? '—' : a.pct + '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && <div><h3 className="mb-2 font-bold text-navy">Projetos de {porResp.find((a) => a.id === sel)?.nome}</h3><Microentregas key={sel + tipo} presetResp={sel} presetTipo={tipo || undefined} /></div>}

      {isGestor && <Card>
        <h3 className="mb-3 font-bold text-navy">Usuários</h3>
        <form onSubmit={invite} className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
          <Field label="Nome"><input className={inp} value={inv.nome} onChange={(e) => setInv({ ...inv, nome: e.target.value })} /></Field>
          <Field label="E-mail"><input type="email" className={inp} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Perfil"><select className={inp} value={inv.perfil} onChange={(e) => setInv({ ...inv, perfil: e.target.value })}>{PERFIS.map((k) => <option key={k} value={k}>{PERFIL_LABEL[k as Perfil]}</option>)}</select></Field>
          <button className={btnP + ' self-end'} disabled={busy}>{busy ? 'Enviando…' : 'Convidar por e-mail'}</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2">{p.nome}</td><td>{p.email}</td>
                  <td><select className={inp + ' !w-auto !py-1'} value={p.perfil} disabled={p.id === profile!.id} onChange={(e) => patch(p.id, { perfil: e.target.value })}>{PERFIS.map((k) => <option key={k} value={k}>{PERFIL_LABEL[k as Perfil]}</option>)}</select></td>
                  <td>{p.id === profile!.id ? <Chip color="#16a34a">Você</Chip> : <button className={btnG + ' !px-3 !py-1 !text-xs'} onClick={() => patch(p.id, { ativo: !p.ativo })}>{p.ativo ? 'Ativo · desativar' : 'Inativo · reativar'}</button>}</td>
                  <td className="text-right">{p.id !== profile!.id && <button className={btnG + ' !px-3 !py-1 !text-xs !border-red-200 !text-red-600 hover:!bg-red-50'} onClick={() => excluirUsuario(p)}>Excluir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}
    </div>
  )
}

/** Comparativo lado a lado: MacroProjetos × MicroProjetos (e consolidado). */
function Comparativo({ todas }: { todas: Micro[] }) {
  const calc = (rs: Micro[]) => {
    const u = rs.reduce((a, r) => a + r.quantidade, 0), c = rs.reduce((a, r) => a + r.concluido, 0), x = rs.reduce((a, r) => a + r.cancelado, 0)
    return { n: rs.length, and: rs.filter((r) => r.status_geral === 'em_andamento').length, ini: rs.filter((r) => r.status_geral === 'a_iniciar').length,
      con: rs.filter((r) => r.status_geral === 'concluido' || r.status_geral === 'concluido_parcial').length, atr: rs.filter((r) => r.atrasada).length, pct: u - x > 0 ? Math.round((c / (u - x)) * 100) : 0 }
  }
  const cols: [string, string, ReturnType<typeof calc>][] = [
    ['MacroProjetos', TIPO_COLOR.macro, calc(todas.filter((r) => r.tipo_projeto === 'macro'))],
    ['MicroProjetos', TIPO_COLOR.micro, calc(todas.filter((r) => r.tipo_projeto === 'micro'))],
    ['Consolidado', '#8b3fff', calc(todas)],
  ]
  const linhas: [string, (c: ReturnType<typeof calc>) => string | number][] = [['Projetos', (c) => c.n], ['A iniciar', (c) => c.ini], ['Em andamento', (c) => c.and], ['Concluídos', (c) => c.con], ['Atrasados', (c) => c.atr]]
  return (
    <Card>
      <h3 className="mb-3 font-bold text-navy">Comparativo: MacroProjetos × MicroProjetos</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {cols.map(([nome, cor, c]) => (
          <div key={nome} className="rounded-2xl border border-slate-200 p-4" style={{ borderTop: `4px solid ${cor}` }}>
            <div className="mb-2 flex items-baseline justify-between"><b style={{ color: cor }}>{nome}</b><span className="text-2xl font-extrabold" style={{ color: cor }}>{c.pct}%</span></div>
            <Bar pct={c.pct} color={cor} />
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              {linhas.map(([l, f]) => <div key={l} className="col-span-2 flex justify-between"><dt className="text-slate-500">{l}</dt><dd className={'font-semibold ' + (l === 'Atrasados' && c.atr ? 'text-red-600' : '')}>{f(c)}</dd></div>)}
            </dl>
            <small className="text-slate-500">% de conclusão = unidades concluídas ÷ (total − canceladas)</small>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** MacroProjetos: quadro com responsável e "com quem está", mais a carga atual de cada pessoa. */
function QuadroMacro({ rows, profiles }: { rows: Micro[]; profiles: { id: string; nome: string; ativo: boolean }[] }) {
  const nome = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.nome || '—' : '')
  const comQuem = (r: Micro) => r.com_quem_id || r.responsavel_id        // sem "com quem está" definido, o projeto está com o próprio responsável
  const pessoas = [...new Set(rows.map(comQuem))].map((id) => ({ id, itens: rows.filter((r) => comQuem(r) === id && r.status_geral !== 'concluido' && r.status_geral !== 'cancelado' && r.status_geral !== 'concluido_parcial') }))
    .sort((a, b) => b.itens.length - a.itens.length)
  if (rows.length === 0) return <Card><Empty>Nenhum MacroProjeto cadastrado. Em “Projetos”, use Novo Projeto e escolha MacroProjeto.</Empty></Card>
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="!p-0 xl:col-span-2">
        <h3 className="p-4 pb-2 font-bold text-navy">Quadro de MacroProjetos</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Projeto', 'Responsável', 'Com quem está', 'Status', 'Progresso', 'Target'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2.5"><b>{r.demanda}</b>{r.resumo && <div className="max-w-xs truncate text-xs text-slate-500">{r.resumo}</div>}</td>
                  <td className="px-3 py-2.5">{r.responsavel_nome}</td>
                  <td className="px-3 py-2.5">{r.com_quem_nome ? <Chip color="#7c3aed">{r.com_quem_nome}</Chip> : <span className="text-xs text-slate-400">com o responsável</span>}</td>
                  <td className="px-3 py-2.5"><Chip color={STATUS_COLOR[r.status_geral]}>{STATUS_LABEL[r.status_geral]}</Chip></td>
                  <td className="w-40 px-3 py-2.5"><StackBar parts={[{ v: r.concluido, c: STATUS_COLOR.concluido }, { v: r.em_andamento, c: STATUS_COLOR.em_andamento }, { v: r.cancelado, c: STATUS_COLOR.cancelado }, { v: r.a_iniciar, c: '#cbd5e1' }]} /><div className="mt-1 text-xs text-slate-500">{r.pct_conclusao === null ? '—' : r.pct_conclusao + '%'}</div></td>
                  <td className={'whitespace-nowrap px-3 py-2.5 ' + (r.atrasada ? 'font-bold text-red-600' : '')}>{fmtDate(r.data_target)}{r.atrasada && <div className="text-xs">atrasado</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h3 className="mb-1 font-bold text-navy">Com quem estão os projetos em aberto</h3>
        <p className="mb-3 text-xs text-slate-500">Projetos não concluídos, agrupados por quem está com eles agora.</p>
        <div className="space-y-3">
          {pessoas.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between"><b className="text-navy">{nome(p.id)}</b><Chip color="#7c3aed">{p.itens.length} em aberto</Chip></div>
              {p.itens.length === 0 ? <p className="mt-1 text-xs text-slate-400">Nenhum projeto em aberto.</p> : (
                <ul className="mt-1 space-y-0.5 text-sm">{p.itens.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.demanda}</span><small className="shrink-0 text-slate-500">resp.: {r.com_quem_id && r.com_quem_id !== r.responsavel_id ? r.responsavel_nome.split(' ')[0] : 'própria'}</small></li>)}</ul>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
