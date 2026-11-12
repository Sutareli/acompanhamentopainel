import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmar } from './Confirm'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtDateTime, todayStr } from '../lib/rules'
import { Bar, btnD, btnG, btnP, btnSm, Card, Chip, Empty, inp, Msg } from './ui'
import PainelStatus from './PainelStatus'
import { EtapaForm, MelhoriaForm } from './BacklogForms'
import { Etapa, etapaVencida, fimEtapa, Hist, ItemStat, Melhoria, planejadoEtapa, planejadoPct, Status, STATUS_COLOR } from '../lib/backlog'

const CAMPOS: Record<string, string> = {
  status: 'Status', percentual_concluido: '% concluído', prioridade: 'Prioridade', responsavel: 'Responsável',
  data_inicio: 'Início', data_termino: 'Término', novo_prazo: 'Novo prazo', prazo_realizado: 'Prazo realizado',
}
const GRUPOS: { k: string; label: string; campos: string[] }[] = [
  { k: '', label: 'Todos', campos: [] },
  { k: 'status', label: 'Status', campos: ['status'] },
  { k: 'pct', label: 'Percentual', campos: ['percentual_concluido'] },
  { k: 'prazo', label: 'Prazos', campos: ['data_inicio', 'data_termino', 'novo_prazo', 'prazo_realizado'] },
  { k: 'resp', label: 'Responsável', campos: ['responsavel'] },
]
const isDate = (c: string) => ['data_inicio', 'data_termino', 'novo_prazo', 'prazo_realizado'].includes(c)
const val = (c: string, v: string | null) => (v === null || v === '' ? '—' : isDate(c) ? fmtDate(v) : c === 'percentual_concluido' ? v + '%' : v)

function Dot({ s }: { s: Status }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS_COLOR[s] }} aria-hidden />
}

export default function BacklogDetalhe({ m, nomes, podeEditar, podeExcluir, modulos, onBack, onChanged, onDelete, onSaveMelhoria }: {
  m: Melhoria; nomes: Record<string, string>; podeEditar: boolean; podeExcluir: boolean; modulos: string[]
  onBack: () => void; onChanged: () => Promise<void> | void; onDelete: () => void; onSaveMelhoria: (p: Partial<Melhoria>) => Promise<string>
}) {
  const hoje = todayStr()
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [hist, setHist] = useState<Hist[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [eEtapa, setEEtapa] = useState<Partial<Etapa> | null>(null)
  const [eMel, setEMel] = useState(false)
  const [det, setDet] = useState(false)
  const [fGrupo, setFGrupo] = useState('')
  const [fEtapa, setFEtapa] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('backlog_etapas').select('*').eq('melhoria_id', m.id).order('ordem', { ascending: true }),
      supabase.from('backlog_historico').select('*').eq('melhoria_id', m.id).order('data_hora', { ascending: false }).order('id', { ascending: false }),
    ])
    if (a.error || b.error) setErr('Não foi possível carregar etapas/histórico: ' + (a.error || b.error)!.message)
    else { setEtapas((a.data || []) as Etapa[]); setHist((b.data || []) as Hist[]); setErr('') }
    setLoading(false)
  }, [m.id])
  useEffect(() => { load() }, [load, m.atualizado_em])

  async function refresh() { await load(); await onChanged() }

  async function saveEtapa(p: Partial<Etapa>) {
    const concl = p.status === 'Concluído'
    const payload: any = {
      como: (p.como || '').trim(), responsavel: p.responsavel?.trim() || null,
      data_inicio: p.data_inicio || null, data_termino: p.data_termino || null, novo_prazo: p.novo_prazo || null,
      prazo_realizado: p.prazo_realizado || (concl ? todayStr() : null),
      percentual_concluido: concl ? 100 : Number(p.percentual_concluido) || 0, status: p.status || 'A Iniciar',
      observacoes: p.observacoes?.trim() || null,
    }
    const r = p.id
      ? await supabase.from('backlog_etapas').update(payload).eq('id', p.id).select('id')
      : await supabase.from('backlog_etapas').insert({ ...payload, melhoria_id: m.id, ordem: Math.max(0, ...etapas.map((e) => e.ordem)) + 1 }).select('id')
    if (r.error) return r.error.message
    if (!r.data || r.data.length === 0) return 'Você não tem permissão para alterar etapas desta atividade.'
    setEEtapa(null); await refresh()
    return ''
  }
  async function delEtapa(e: Etapa) {
    if (!(await confirmar({ titulo: 'Excluir etapa?', mensagem: <>Excluir a etapa <b>“{e.como}”</b>? O registro permanece no histórico da atividade.</>, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('backlog_etapas').delete().eq('id', e.id).select('id')
    if (r.error || !r.data?.length) setErr('Não foi possível excluir a etapa: ' + (r.error?.message || 'sem permissão.'))
    else await refresh()
  }

  const items: ItemStat[] = etapas.length
    ? etapas.map((e) => ({ status: e.status, realizado: Number(e.percentual_concluido), planejado: planejadoEtapa(e, hoje) }))
    : [{ status: m.status, realizado: Number(m.percentual_concluido), planejado: planejadoPct(m.data_inicio, m.data_termino, hoje) }]

  const histFiltrado = useMemo(() => {
    const g = GRUPOS.find((x) => x.k === fGrupo)!
    return hist.filter((h) => (!g.campos.length || g.campos.includes(h.campo) || h.campo === 'criacao' || h.campo === 'exclusao') &&
      (!fEtapa || (fEtapa === '__ativ' ? !h.etapa_id && !h.etapa_nome : h.etapa_id === fEtapa)))
  }, [hist, fGrupo, fEtapa])

  const quem = (id: string | null) => (id ? nomes[id] || 'Usuário' : 'Sistema')
  const dl: [string, string | null][] = [['Descrição', m.descricao], ['Descrição detalhada', m.descricao_detalhada], ['Objetivo', m.objetivo], ['Objetivo detalhado', m.objetivo_detalhado], ['AS IS — cenário atual', m.as_is], ['TO BE — cenário futuro', m.to_be], ['Observações', m.observacoes]]

  return (
    <div className="space-y-4">
      <button className="text-sm font-semibold text-violet-700 hover:underline" onClick={onBack}>← Voltar ao backlog</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-navy">{m.melhoria}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Chip color={STATUS_COLOR[m.status]}>{m.status}</Chip><Chip color="#2e1a6e">Prioridade {m.prioridade}</Chip>
            <span>{m.modulo}</span><span>· Responsável: {m.responsavel || '—'}</span><span>· {fmtDate(m.data_inicio)} → {fmtDate(m.data_termino)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeExcluir && <button className={btnD} onClick={onDelete}>Excluir atividade</button>}
          {podeEditar && <button className={btnG} onClick={() => setEMel(true)}>Editar atividade</button>}
          {podeEditar && <button className={btnP} onClick={() => setEEtapa({ status: 'A Iniciar', percentual_concluido: 0 })}>+ Nova etapa</button>}
        </div>
      </div>
      {!podeEditar && <Msg kind="aviso">Você pode acompanhar esta atividade, mas só quem a criou, Diretor, Gerente ou Analista Sr pode alterá-la.</Msg>}
      {err && <Msg kind="erro">{err}</Msg>}

      <PainelStatus titulo={etapas.length ? 'Status das Etapas' : 'Status da Atividade'} rotulo={etapas.length ? 'etapas' : 'atividade'} items={items} />

      <Card className="!p-4">
        <button className="flex w-full items-center justify-between text-left font-bold text-navy" onClick={() => setDet(!det)} aria-expanded={det}>
          <span>Detalhes da atividade (descrição, objetivo, AS IS / TO BE)</span><span>{det ? '▲' : '▼'}</span>
        </button>
        {det && (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {dl.map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold uppercase text-slate-500">{k}</dt><dd className="mt-1 whitespace-pre-wrap">{v || '—'}</dd></div>)}
          </dl>
        )}
      </Card>

      <Card className="!p-0">
        <div className="border-b border-violet-100 px-5 py-3 font-bold text-navy">Etapas (COMO?) <span className="ml-1 text-xs font-normal text-slate-500">{etapas.length ? `${etapas.length} etapa(s) — status e % da atividade são calculados a partir delas` : ''}</span></div>
        {loading ? <p className="p-5 text-slate-500">Carregando…</p> : etapas.length === 0 ? (
          <div className="p-5"><Empty>Sem etapas. {podeEditar ? 'Use “+ Nova etapa” para detalhar o plano (COMO?) e acompanhar prazos e status de cada passo.' : ''}</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm [&_th]:pr-2">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Como?</th><th>Responsável</th><th>Início</th><th>Término</th><th>Novo prazo</th><th>Prazo realizado</th><th className="w-28">% concluído</th><th className="w-28">% planejado</th><th>Status</th><th>Observações</th>{podeEditar && <th className="pr-3" />}</tr>
              </thead>
              <tbody>
                {etapas.map((e) => {
                  const pl = planejadoEtapa(e, hoje)
                  return (
                    <tr key={e.id} className="border-t border-slate-100 align-top">
                      <td className="max-w-[260px] px-3 py-2 font-semibold text-navy">{e.como}</td>
                      <td className="py-2 pr-2">{e.responsavel || '—'}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtDate(e.data_inicio)}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtDate(e.data_termino)}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtDate(e.novo_prazo)}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtDate(e.prazo_realizado)}</td>
                      <td className="py-2 pr-2"><div className="text-xs font-semibold">{Math.round(Number(e.percentual_concluido))}%</div><Bar pct={Number(e.percentual_concluido)} color={STATUS_COLOR[e.status]} /></td>
                      <td className="py-2 pr-2"><div className="text-xs font-semibold">{pl === null ? '—' : pl + '%'}</div><Bar pct={pl || 0} color="#94a3b8" /></td>
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2 whitespace-nowrap"><Dot s={e.status} />{e.status}</span>
                        {etapaVencida(e, hoje) && e.status !== 'Atrasado' && <div className="mt-1 text-[11px] font-semibold text-red-600">prazo vencido ({fmtDate(fimEtapa(e))})</div>}
                      </td>
                      <td className="max-w-[220px] py-2 pr-2 text-xs text-slate-600">{e.observacoes || '—'}</td>
                      {podeEditar && <td className="whitespace-nowrap py-2 pr-3"><button className={btnG + ' ' + btnSm} onClick={() => setEEtapa(e)}>Editar</button> <button className={btnG + ' ' + btnSm + ' !text-red-600'} onClick={() => delEtapa(e)}>Excluir</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-2 font-bold text-navy">Histórico de alterações</h3>
          {GRUPOS.map((g) => (
            <button key={g.k} onClick={() => setFGrupo(g.k)} className={'rounded-full border px-3 py-1 text-xs font-semibold ' + (fGrupo === g.k ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy')}>{g.label}</button>
          ))}
          <select aria-label="Filtrar por etapa" className={inp + ' !w-auto !py-1 text-xs'} value={fEtapa} onChange={(e) => setFEtapa(e.target.value)}>
            <option value="">Todas as etapas</option><option value="__ativ">Só a atividade</option>
            {etapas.map((e) => <option key={e.id} value={e.id}>{e.como.slice(0, 50)}</option>)}
          </select>
        </div>
        {histFiltrado.length === 0 ? <Empty>Sem registros{hist.length ? ' para este filtro' : ' ainda — o histórico começa a ser gravado a partir da atualização do banco'}.</Empty> : (
          <ol className="space-y-2">
            {histFiltrado.map((h) => (
              <li key={h.id} className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">{fmtDateTime(h.data_hora)} · {quem(h.usuario_id)}{h.etapa_nome ? ` · etapa “${h.etapa_nome}”` : h.etapa_id ? ' · etapa' : ' · atividade'}</div>
                  <div className="mt-0.5">
                    {h.campo === 'criacao' ? <b>{h.etapa_nome ? 'Etapa criada' : 'Atividade criada'}</b>
                      : h.campo === 'exclusao' ? <b>Etapa excluída</b>
                      : h.campo === 'status' ? (<><b>Status:</b> {chip(h.valor_anterior)} → {chip(h.valor_novo)}</>)
                      : (<><b>{CAMPOS[h.campo] || h.campo}:</b> {val(h.campo, h.valor_anterior)} → {val(h.campo, h.valor_novo)}</>)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {eEtapa && <EtapaForm init={eEtapa} onClose={() => setEEtapa(null)} onSave={saveEtapa} />}
      {eMel && <MelhoriaForm init={m} modulos={modulos} temEtapas={etapas.length > 0} onClose={() => setEMel(false)} onSave={async (p) => { const r = await onSaveMelhoria(p); if (!r) { setEMel(false); await load() } return r }} />}
    </div>
  )
}

function chip(s: string | null) {
  return s && s in STATUS_COLOR ? <Chip color={STATUS_COLOR[s as Status]}>{s}</Chip> : <span>{s || '—'}</span>
}
