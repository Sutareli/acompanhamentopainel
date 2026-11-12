import { CSSProperties, useEffect, useMemo, useState } from 'react'
import { confirmar } from '../components/Confirm'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, canViewAll, download, fmtDate, fmtDateTime, toCSV, todayStr } from '../lib/rules'
import { Bar, btnG, btnP, btnSm, Card, Chip, Empty, Field, HBars, inp, Msg } from '../components/ui'
import PainelStatus from '../components/PainelStatus'
import BacklogDetalhe from '../components/BacklogDetalhe'
import { MelhoriaForm } from '../components/BacklogForms'
import { Chamado, contar, mesKey, mesLabel, noPrazo } from '../lib/chamados'
import { Etapa, Hist, ItemStat, Melhoria, melhoriaVencida, planejadoEtapa, planejadoPct, STATUS, STATUS_COLOR, Status } from '../lib/backlog'

/** Módulo "Backlog de Melhorias" — visível a todos os usuários ativos. As permissões de escrita são garantidas pelo RLS do banco. */
const clamp = (n: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden' })

export default function Backlog({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const uid = profile!.id
  const hoje = todayStr()
  const [rows, setRows] = useState<Melhoria[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [mudancas, setMudancas] = useState<Hist[]>([])
  const [chamados, setChamados] = useState<Pick<Chamado, 'data_ref' | 'subcategoria' | 'prazo' | 'status'>[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [fMod, setFMod] = useState('')
  const [fSt, setFSt] = useState('')
  const [q, setQ] = useState('')
  const [soVencidas, setSoVencidas] = useState(false)
  // Ao abrir a página já vem filtrado o mês vigente (criação/início). “Todo o período” remove o filtro.
  const mesIni = hoje.slice(0, 8) + '01'
  const mesFim = hoje.slice(0, 8) + String(new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')
  const [iDe, setIDe] = useState(mesIni); const [iAte, setIAte] = useState(mesFim) // data de criação/início
  const [cDe, setCDe] = useState(''); const [cAte, setCAte] = useState('') // data de finalização
  const [fOrig, setFOrig] = useState<'' | 'chamado' | 'manual'>('')
  const [limite, setLimite] = useState(150)
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<Melhoria> | null>(null)

  const canEdit = (m: Melhoria) => m.criado_por === uid || canViewAll(profile!.perfil)

  // Os chamados da base viram atividades (>1000 linhas): o Supabase devolve no máx. 1000 por consulta, então paginamos.
  async function carregarMelhorias() {
    const all: Melhoria[] = []
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from('backlog_melhorias').select('*').order('prioridade', { ascending: true }).order('data_termino', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
      if (r.error) return { data: null, error: r.error }
      all.push(...((r.data || []) as Melhoria[])); if (!r.data || r.data.length < 1000) break
    }
    return { data: all, error: null }
  }

  async function load() {
    const [a, b, c, d] = await Promise.all([
      carregarMelhorias(),
      supabase.from('backlog_etapas').select('*').order('ordem', { ascending: true }),
      supabase.from('backlog_historico').select('*').eq('campo', 'status').order('data_hora', { ascending: false }).order('id', { ascending: false }).limit(12),
      supabase.from('profiles').select('id,nome'),
    ])
    if (a.error) setErr('Não foi possível carregar o backlog: ' + a.error.message)
    else if (b.error || c.error) setErr('Backlog carregado, mas etapas/histórico indisponíveis (a migração 004 foi executada?): ' + (b.error || c.error)!.message)
    else setErr('')
    if (!a.error) setRows((a.data || []) as Melhoria[])
    setEtapas((b.data || []) as Etapa[])
    setMudancas((c.data || []) as Hist[])
    const ch: typeof chamados = []   // base de chamados compartilhada com o Pareto (o Supabase devolve no máx. 1000 linhas por consulta)
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from('backlog_chamados').select('data_ref,subcategoria,prazo,status').order('data_ref', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
      if (r.error) break
      ch.push(...((r.data || []) as typeof chamados)); if (!r.data || r.data.length < 1000) break
    }
    setChamados(ch)
    setNomes(Object.fromEntries(((d.data || []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome])))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const etapasDe = useMemo(() => {
    const mp: Record<string, Etapa[]> = {}
    etapas.forEach((e) => { (mp[e.melhoria_id] ||= []).push(e) })
    return mp
  }, [etapas])

  const modulos = useMemo(() => [...new Set(rows.map((r) => r.modulo))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [rows])
  const temData = !!(iDe || iAte || cDe || cAte)
  /** Filtros de data: início/criação (data_inicio) e finalização (data_conclusao, só das concluídas). Valem para o painel e para a tabela. */
  const porData = useMemo(() => rows.filter((r) =>
    (!iDe || (!!r.data_inicio && r.data_inicio >= iDe)) && (!iAte || (!!r.data_inicio && r.data_inicio <= iAte)) &&
    (!cDe || (r.status === 'Concluído' && !!r.data_conclusao && r.data_conclusao >= cDe)) && (!cAte || (r.status === 'Concluído' && !!r.data_conclusao && r.data_conclusao <= cAte))),
  [rows, iDe, iAte, cDe, cAte])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return porData.filter((r) => (!fMod || r.modulo === fMod) && (!fSt || r.status === fSt) && (!fOrig || (r.origem || 'manual') === fOrig) && (!soVencidas || melhoriaVencida(r, hoje)) &&
      (!t || [r.melhoria, r.descricao, r.objetivo, r.responsavel, r.modulo].join(' ').toLowerCase().includes(t)))
  }, [porData, fMod, fSt, fOrig, q, soVencidas, hoje])
  // em aberto primeiro, concluídas por último (mantém prioridade e prazo dentro de cada grupo)
  const ordenadas = useMemo(() => [...filtered].sort((a, b) => (a.status === 'Concluído' ? 1 : 0) - (b.status === 'Concluído' ? 1 : 0)), [filtered])
  const visiveis = ordenadas.slice(0, limite)
  useEffect(() => { setLimite(150) }, [fMod, fSt, fOrig, q, soVencidas, iDe, iAte, cDe, cAte])

  // Painel superior: uma linha por ATIVIDADE (status e % já refletem as etapas). Os filtros de data valem também aqui; os demais afetam só a tabela.
  const items: ItemStat[] = porData.map((r) => {
    const es = etapasDe[r.id] || []
    const pls = es.map((e) => planejadoEtapa(e, hoje)).filter((x): x is number => x !== null)
    return {
      status: r.status, realizado: Number(r.percentual_concluido),
      planejado: es.length ? (pls.length ? Math.round(pls.reduce((a, b) => a + b, 0) / pls.length) : null) : planejadoPct(r.data_inicio, r.data_termino, hoje),
    }
  })

  async function save(p: Partial<Melhoria>) {
    const temEt = !!p.id && (etapasDe[p.id]?.length || 0) > 0
    const payload: any = {
      modulo: (p.modulo || '').trim(), melhoria: (p.melhoria || '').trim(),
      descricao: p.descricao?.trim() || null, descricao_detalhada: p.descricao_detalhada?.trim() || null,
      objetivo: p.objetivo?.trim() || null, objetivo_detalhado: p.objetivo_detalhado?.trim() || null,
      as_is: p.as_is?.trim() || null, to_be: p.to_be?.trim() || null,
      prioridade: Number(p.prioridade) || 3,
      responsavel: p.responsavel?.trim() || null, data_inicio: p.data_inicio || null, data_termino: p.data_termino || null,
      observacoes: p.observacoes?.trim() || null,
    }
    if (!temEt) { // com etapas, status e % vêm do cálculo automático do banco
      payload.status = p.status || 'A Iniciar'
      payload.percentual_concluido = p.status === 'Concluído' ? 100 : Number(p.percentual_concluido) || 0
      payload.data_conclusao = p.status === 'Concluído' ? p.data_conclusao || null : null
    }
    const r = p.id
      ? await supabase.from('backlog_melhorias').update(payload).eq('id', p.id).select('id')
      : await supabase.from('backlog_melhorias').insert({ ...payload, criado_por: uid }).select('id')
    if (r.error) return r.error.message
    if (p.id && (!r.data || r.data.length === 0)) return 'Você não tem permissão para editar este item (somente quem criou, Diretor, Gerente ou Analista Sr).'
    setEdit(null); await load()
    return ''
  }
  async function remove(m: Melhoria) {
    if (!(await confirmar({ titulo: 'Excluir atividade?', mensagem: <>Excluir <b>“{m.melhoria}”</b> com suas etapas e histórico? Fica na <b>Lixeira por 48 horas</b> e pode ser restaurado; depois disso some de vez.</>, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('backlog_melhorias').delete().eq('id', m.id).select('id')
    if (r.error || !r.data?.length) setErr('Não foi possível excluir: ' + (r.error?.message || 'sem permissão.'))
    else { setSelId(null); await load() }
  }
  const exportCsv = () => download(`backlog-melhorias-${hoje}.csv`, toCSV([
    ['Módulo', 'Melhoria', 'Descrição', 'Objetivo', 'AS IS', 'TO BE', 'Prioridade', 'Status', '% concluído', 'Etapas', 'Responsável', 'Início (criação)', 'Término (prazo)', 'Finalização', 'Observações'],
    ...filtered.map((r) => {
      const es = etapasDe[r.id] || []
      return [r.modulo, r.melhoria, r.descricao, r.objetivo, r.as_is, r.to_be, r.prioridade, r.status, r.percentual_concluido, es.length ? `${es.filter((e) => e.status === 'Concluído').length}/${es.length}` : '', r.responsavel, fmtDate(r.data_inicio), fmtDate(r.data_termino), r.status === 'Concluído' ? fmtDate(r.data_conclusao || null) : '', r.observacoes]
    }),
  ]))

  const sel = selId ? rows.find((r) => r.id === selId) : null
  if (sel) {
    return <BacklogDetalhe m={sel} nomes={nomes} podeEditar={canEdit(sel)} podeExcluir={canAdmin(profile!.perfil)} modulos={modulos}
      onBack={() => setSelId(null)} onChanged={load} onDelete={() => remove(sel)} onSaveMelhoria={save} />
  }

  const total = rows.length
  const mesCh = chamados.length ? mesKey(chamados[chamados.length - 1].data_ref) : ''
  const chMes = chamados.filter((c) => mesKey(c.data_ref) === mesCh)
  const chTop = contar(chMes as Chamado[], (c) => c.subcategoria).barras.slice(0, 5).map((b) => ({ label: b.nome, value: b.qtd }))
  const nomeAtiv = (id: string) => rows.find((r) => r.id === id)?.melhoria
  const prog = (r: Melhoria) => { const es = etapasDe[r.id] || []; return es.length ? `${es.filter((e) => e.status === 'Concluído').length}/${es.length}` : '—' }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Backlog de Melhorias</h1>
          <p className="text-sm text-slate-500">Acompanhamento das atividades, etapas, prazos e histórico de status do time.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnG} onClick={exportCsv} disabled={!filtered.length}>⬇ Exportar (CSV)</button>
          <button className={btnP} onClick={() => setEdit({ status: 'A Iniciar', prioridade: 3, percentual_concluido: 0 })}>+ Nova melhoria</button>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}

      {/* ===== Período (topo da página): mês vigente por padrão ===== */}
      <Card className="!p-4">
        <div className="flex flex-wrap items-end gap-3">
          <span className="pb-2 text-sm font-bold text-navy">📅 Período</span>
          <Field label="Criação/início (de)" className="min-w-[150px]"><input className={inp} type="date" value={iDe} max={iAte || undefined} onChange={(e) => setIDe(e.target.value)} /></Field>
          <Field label="Criação/início (até)" className="min-w-[150px]"><input className={inp} type="date" value={iAte} min={iDe || undefined} onChange={(e) => setIAte(e.target.value)} /></Field>
          <Field label="Finalização (de)" className="min-w-[150px]"><input className={inp} type="date" value={cDe} max={cAte || undefined} onChange={(e) => setCDe(e.target.value)} /></Field>
          <Field label="Finalização (até)" className="min-w-[150px]"><input className={inp} type="date" value={cAte} min={cDe || undefined} onChange={(e) => setCAte(e.target.value)} /></Field>
          <button className={btnG + ' ' + btnSm} onClick={() => { setIDe(mesIni); setIAte(mesFim); setCDe(''); setCAte('') }}>Mês atual</button>
          <button className={btnG + ' ' + btnSm} onClick={() => { setIDe(''); setIAte(''); setCDe(''); setCAte('') }}>Todo o período</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{temData ? 'Período aplicado ao painel, à tabela e à exportação.' : 'Mostrando todo o período.'} <b>Criação/início</b>: data de início da atividade (nos chamados, o mês de referência). <b>Finalização</b>: data de conclusão.</p>
        {(cDe || cAte) && <p className="mt-1 text-xs text-amber-700">Filtro de finalização: só entram atividades concluídas com data de conclusão. Os chamados da base não trazem essa data na planilha; informe-a na atividade, se quiser que apareçam.</p>}
      </Card>

      {/* ===== Painel de status (estilo planilha de acompanhamento) ===== */}
      <PainelStatus titulo="Status das Atividades" rotulo="atividades" items={items} ativo={fSt} onStatus={(s) => setFSt(s)} />

      <Card>
        <h3 className="mb-1 font-bold text-navy">Últimas mudanças de status</h3>
        <p className="mb-2 text-xs text-slate-500">Movimentações mais recentes das atividades e etapas.</p>
        {mudancas.length === 0 ? <Empty>Nenhuma mudança de status registrada ainda.</Empty> : (
          <ul className="space-y-1 text-sm">
            {mudancas.slice(0, 8).map((h) => {
              const nome = nomeAtiv(h.melhoria_id)
              const chip = (s: string | null) => s && s in STATUS_COLOR ? <Chip color={STATUS_COLOR[s as Status]}>{s}</Chip> : <span>{s || '—'}</span>
              return (
                <li key={h.id}>
                  <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-violet-200 hover:bg-violet-50/60 disabled:cursor-default disabled:hover:bg-transparent" disabled={!nome} onClick={() => setSelId(h.melhoria_id)}>
                    <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDateTime(h.data_hora)}</span>
                    <span className="min-w-0 flex-1 font-semibold text-navy">{nome || 'Atividade excluída'}{h.etapa_nome ? <span className="font-normal text-slate-500"> · etapa “{h.etapa_nome}”</span> : null}</span>
                    <span className="flex items-center gap-1.5">{chip(h.valor_anterior)} → {chip(h.valor_novo)}</span>
                    <span className="w-28 text-right text-xs text-slate-500">{h.usuario_id ? nomes[h.usuario_id] || '' : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-navy">Chamados da base do backlog {mesCh && <span className="text-sm font-normal text-slate-500">· {mesLabel(mesCh)}</span>}</h3>
          <button className={btnG + ' ' + btnSm} onClick={() => onNavigate('pareto')}>Abrir Pareto backlog →</button>
        </div>
        {chamados.length === 0 ? <p className="mt-2 text-sm text-slate-500">Ainda não há chamados importados. A mesma base alimenta o Pareto backlog.</p> : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
            <div className="flex flex-wrap items-start gap-3 text-sm">
              {([[chMes.length, 'chamados no mês'], [(chMes.length ? Math.round((chMes.filter((c) => noPrazo(c as Chamado)).length / chMes.length) * 100) : 0) + '%', 'no prazo'], [chamados.length, 'na base']] as [string | number, string][]).map(([v, l]) => (
                <div key={l} className="min-w-[110px] rounded-2xl bg-violet-50 px-4 py-3"><div className="text-3xl font-extrabold text-navy">{v}</div><div className="text-xs text-slate-500">{l}</div></div>
              ))}
              <p className="basis-full text-xs text-slate-500">Dos {chamados.length} chamados, {chamados.filter((c) => /(cancel|improced)/i.test(c.status || '') || !c.status).length} (Cancelado/Improcedente) não viram atividade; os {chamados.filter((c) => c.status && !/(cancel|improced)/i.test(c.status)).length} restantes alimentam o painel “Status das Atividades” junto com as melhorias cadastradas.</p>
            </div>
            <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Principais subcategorias do mês</div><HBars rows={chTop} empty="Sem subcategorias." /></div>
          </div>
        )}
      </Card>

      {/* ===== Filtros e tabela ===== */}
      <Card className="!p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Módulo" className="min-w-[160px]"><select className={inp} value={fMod} onChange={(e) => setFMod(e.target.value)}><option value="">Todos</option>{modulos.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Status" className="min-w-[160px]"><select className={inp} value={fSt} onChange={(e) => setFSt(e.target.value)}><option value="">Todos</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Buscar" className="min-w-[200px] flex-1"><input className={inp} placeholder="Melhoria, descrição, objetivo, responsável…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Origem" className="min-w-[170px]"><select className={inp} value={fOrig} onChange={(e) => setFOrig(e.target.value as '' | 'chamado' | 'manual')}><option value="">Todas</option><option value="chamado">Chamados da base</option><option value="manual">Cadastradas aqui</option></select></Field>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={soVencidas} onChange={(e) => setSoVencidas(e.target.checked)} />Somente prazo vencido</label>
          {(fMod || fSt || fOrig || q || soVencidas) && <button className={btnG + ' ' + btnSm} onClick={() => { setFMod(''); setFSt(''); setFOrig(''); setQ(''); setSoVencidas(false) }}>Limpar filtros</button>}
        </div>
        <p className="mt-2 text-xs text-slate-500">{filtered.length} de {total} atividade(s) · em aberto primeiro, por prioridade e prazo. Os chamados da base entram como atividades (marcadas “Chamado”). <b>Clique em uma atividade para abrir a visão detalhada</b> (etapas, status e histórico).</p>
      </Card>

      {loading ? <p className="py-6 text-center text-slate-500">Carregando…</p> : filtered.length === 0 ? (
        <Empty>{total === 0 ? 'Nenhuma melhoria cadastrada ainda. Use “+ Nova melhoria” para começar.' : 'Nenhum item corresponde aos filtros.'}</Empty>
      ) : (<>
        <Card className="hidden !p-0 md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm [&_th]:pr-2">
              <thead className="bg-violet-50/70 text-xs font-bold uppercase tracking-wide text-navy">
                <tr><th className="px-3 py-3">Prior.</th><th>Módulo</th><th>Melhoria</th><th>Descrição</th><th>Objetivo</th><th>AS IS → TO BE</th><th>Status</th><th>%</th><th>Etapas</th><th>Prazo</th><th className="pr-3">Responsável</th></tr>
              </thead>
              <tbody>
                {visiveis.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-slate-100 align-top hover:bg-violet-50/50" onClick={() => setSelId(r.id)}>
                    <td className="px-3 py-2 text-center font-bold text-navy">{r.prioridade}</td>
                    <td className="py-2 pr-2">{r.modulo}</td>
                    <td className="max-w-[200px] py-2 pr-2 font-semibold text-navy">{r.melhoria}{r.origem === 'chamado' && <span className="ml-1 rounded-md bg-violet-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-violet-700">Chamado</span>}</td>
                    <td className="max-w-[240px] py-2 pr-2 text-slate-600"><div style={clamp(3)}>{r.descricao || '—'}</div></td>
                    <td className="max-w-[220px] py-2 pr-2 text-slate-600"><div style={clamp(3)}>{r.objetivo || '—'}</div></td>
                    <td className="max-w-[260px] py-2 pr-2 text-xs text-slate-600">
                      <div style={clamp(2)}><b>AS IS:</b> {r.as_is || '—'}</div><div style={clamp(2)}><b>TO BE:</b> {r.to_be || '—'}</div>
                    </td>
                    <td className="py-2 pr-2"><Chip color={STATUS_COLOR[r.status]}>{r.status}</Chip>{melhoriaVencida(r, hoje) && r.status !== 'Atrasado' && <div className="mt-1 text-[11px] font-semibold text-red-600">prazo vencido</div>}</td>
                    <td className="w-24 py-2 pr-2"><div className="text-xs font-semibold">{Math.round(Number(r.percentual_concluido))}%</div><Bar pct={Number(r.percentual_concluido)} color={STATUS_COLOR[r.status]} /></td>
                    <td className="py-2 pr-2 text-center text-xs font-semibold text-slate-600">{prog(r)}</td>
                    <td className="whitespace-nowrap py-2 pr-2 text-xs text-slate-600">{fmtDate(r.data_inicio)}<br />{fmtDate(r.data_termino)}{r.status === 'Concluído' && r.data_conclusao && <><br /><span className="font-semibold text-emerald-700">✔ {fmtDate(r.data_conclusao)}</span></>}</td>
                    <td className="py-2 pr-3">{r.responsavel || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-3 md:hidden">
          {visiveis.map((r) => (
            <Card key={r.id} className="!p-4">
              <button className="w-full text-left" onClick={() => setSelId(r.id)}>
                <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{r.modulo} · prioridade {r.prioridade}</span><Chip color={STATUS_COLOR[r.status]}>{r.status}</Chip></div>
                <div className="font-semibold text-navy">{r.melhoria}</div>
                {r.descricao && <p className="mt-1 text-sm text-slate-600" style={clamp(2)}>{r.descricao}</p>}
                <div className="mt-2"><Bar pct={Number(r.percentual_concluido)} color={STATUS_COLOR[r.status]} /></div>
                <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{Math.round(Number(r.percentual_concluido))}% · etapas {prog(r)} · {r.responsavel || 'sem responsável'}</span><span>até {fmtDate(r.data_termino)}{melhoriaVencida(r, hoje) ? ' ⚠' : ''}</span></div>
              </button>
            </Card>
          ))}
        </div>
        {ordenadas.length > limite && <div className="text-center"><button className={btnG} onClick={() => setLimite(limite + 300)}>Mostrar mais ({ordenadas.length - limite} restantes)</button></div>}
      </>)}

      {edit && <MelhoriaForm init={edit} modulos={modulos} temEtapas={false} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  )
}
