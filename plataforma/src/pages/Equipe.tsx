import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { useMicros } from '../lib/useMicros'
import { CRIT_COLOR, CRIT_LABEL, download, fmtDate, Perfil, PERFIL_LABEL, PERFIS, STATUS_COLOR, STATUS_LABEL, StatusGeral, toCSV, todayStr, TZ } from '../lib/rules'
import { btnG, btnP, Card, Chip, Empty, Field, HBars, inp, Kpi, Msg, VBars } from '../components/ui'
import Microentregas from './Microentregas'

export default function Equipe() {
  const { profile } = useAuth()
  const { rows, profiles, loading, error, reload } = useMicros()
  const isGestor = profile!.perfil === 'gestor' // administração de usuários: só gestor (e o banco também exige)
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
    download(`acompanhamento-equipe-${todayStr()}.csv`, toCSV([
      ['Analista', 'Total', 'A iniciar', 'Em andamento', 'Concluídas', 'Concl. c/ cancelamentos', 'Atrasadas', '% conclusão (unidades)'],
      ...porResp.map((a) => [a.nome, a.total, a.ini, a.and, a.con, a.par, a.atr, a.pct ?? '—']),
    ]))
  }

  if (loading) return <p className="py-10 text-center text-slate-500">Carregando painel gerencial…</p>
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">{isGestor ? 'Gestão da equipe' : 'Visão consolidada da equipe'}</h1>
      {error && <Msg kind="erro">{error}</Msg>}
      {err && <Msg kind="erro">{err}</Msg>}
      {msg && <Msg kind="ok">{msg}</Msg>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <Kpi icon="📦" label="Total cadastradas" value={rows.length} />
        <Kpi icon="✅" label="Concluídas" value={cnt('concluido')} color="#16a34a" />
        <Kpi icon="☑️" label="Concl. c/ cancelamentos" value={cnt('concluido_parcial')} color="#0d9488" />
        <Kpi icon="🔵" label="Em andamento" value={cnt('em_andamento')} color="#2563eb" />
        <Kpi icon="⚪" label="A iniciar" value={cnt('a_iniciar')} color="#64748b" />
        <Kpi icon="🚫" label="Canceladas" value={cnt('cancelado')} color="#f87171" />
        <Kpi icon="⚠️" label="Atrasadas" value={rows.filter((r) => r.atrasada).length} color="#dc2626" />
        <Kpi icon="📈" label="% geral de conclusão" value={pctGeral + '%'} pct={pctGeral} color="#0ea5b7" sub="unidades concluídas ÷ (total − canceladas)" />
      </div>

      {rows.length === 0 ? <Empty>Ainda não há microentregas cadastradas. Os gráficos aparecem assim que houver registros.</Empty> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card><h3 className="mb-3 font-bold text-navy">Microentregas por responsável</h3><HBars rows={porResp.filter((a) => a.total).map((a) => ({ label: a.nome, value: a.total }))} /></Card>
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
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Analista</th>{['Total', 'A iniciar', 'Em andamento', 'Concluídas', 'Concl. c/ cancel.', 'Atrasadas', '% conclusão'].map((h) => <th key={h} className="px-4 py-2 text-right">{h}</th>)}</tr></thead>
            <tbody>
              {porResp.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2"><button className="font-semibold text-turq underline" onClick={() => setSel(sel === a.id ? null : a.id)}>{a.nome}</button></td>
                  <td className="px-4 py-2 text-right">{a.total}</td><td className="px-4 py-2 text-right">{a.ini}</td><td className="px-4 py-2 text-right">{a.and}</td><td className="px-4 py-2 text-right">{a.con}</td><td className="px-4 py-2 text-right">{a.par}</td>
                  <td className={'px-4 py-2 text-right ' + (a.atr ? 'font-bold text-red-600' : '')}>{a.atr}</td><td className="px-4 py-2 text-right">{a.pct === null ? '—' : a.pct + '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && <div><h3 className="mb-2 font-bold text-navy">Microentregas de {porResp.find((a) => a.id === sel)?.nome}</h3><Microentregas key={sel} presetResp={sel} /></div>}

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
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2">{p.nome}</td><td>{p.email}</td>
                  <td><select className={inp + ' !w-auto !py-1'} value={p.perfil} disabled={p.id === profile!.id} onChange={(e) => patch(p.id, { perfil: e.target.value })}>{PERFIS.map((k) => <option key={k} value={k}>{PERFIL_LABEL[k as Perfil]}</option>)}</select></td>
                  <td>{p.id === profile!.id ? <Chip color="#16a34a">Você</Chip> : <button className={btnG + ' !px-3 !py-1 !text-xs'} onClick={() => patch(p.id, { ativo: !p.ativo })}>{p.ativo ? 'Ativo · desativar' : 'Inativo · reativar'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}
    </div>
  )
}
