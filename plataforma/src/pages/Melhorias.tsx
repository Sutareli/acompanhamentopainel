import { CSSProperties, useEffect, useMemo, useState } from 'react'
import { confirmar } from '../components/Confirm'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, canViewAll, download, fmtDate, toCSV, todayStr } from '../lib/rules'
import { Bar, btnD, btnG, btnP, btnSm, Card, Chip, Empty, Field, inp, Msg } from '../components/ui'
import BacklogDetalhe from '../components/BacklogDetalhe'
import { MelhoriaForm } from '../components/BacklogForms'
import OrganizarFila from '../components/OrganizarFila'
import AvancarFase from '../components/AvancarFase'
import FunilLinha from '../components/FunilLinha'
import MelhoriasGerencial from '../components/MelhoriasGerencial'
import { podeAjustarSla, slaAtual, slaAtrasado } from '../lib/sla'
import { pctDaFase, Fase, FASE_INFO, FASES, emDev, faseDe, faseIdx, faseInfo, dataDaFase, diasEntre, Melhoria, vencida, STATUS_COLOR } from '../lib/backlog'

/**
 * Módulo "Melhorias" — acompanha cada melhoria ao longo do processo:
 *   Ideia → Priorização (reunião semanal) → Especificação → Chamado aberto → Desenvolvimento → Homologação → Produção
 * Cada melhoria tem um responsável (usuário da plataforma) desde a ideia; o desenvolvimento é sempre da mesma empresa.
 * Mesma estrutura do banco do Backlog (etapas, histórico e permissões), filtrada por tipo_backlog = 'melhoria'.
 */
const clamp = (n: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden' })
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000
type Aba = 'abertas' | 'todas' | Fase
type Modo = 'quadro' | 'lista'
type Visao = 'acompanhamento' | 'gerencial' | 'analitico'

/** Texto de prazo (entrega): "vence em 5 dias", "atrasada há 3 dias", "sem prazo". */
function prazoInfo(m: Melhoria, hoje: string): { txt: string; cor: string } {
  if (faseDe(m) === 'producao') return { txt: m.data_conclusao ? `em produção desde ${fmtDate(m.data_conclusao)}` : 'em produção', cor: '#16a34a' }
  if (!m.data_termino) return { txt: 'sem prazo definido', cor: '#d97706' }
  const d = dayNum(m.data_termino) - dayNum(hoje)
  if (d < 0) return { txt: `atrasada há ${-d} dia${d === -1 ? '' : 's'}`, cor: '#dc2626' }
  if (d === 0) return { txt: 'vence hoje', cor: '#d97706' }
  return { txt: `vence em ${d} dia${d === 1 ? '' : 's'}`, cor: d <= 7 ? '#d97706' : '#475569' }
}
const resumoDe = (m: Melhoria) => m.descricao || m.descricao_detalhada || m.objetivo || null
const nome = (a: Melhoria, b: Melhoria) => a.melhoria.localeCompare(b.melhoria, 'pt-BR')
/** Ordem dentro de cada etapa: quem espera há mais tempo / vence antes aparece primeiro. */
function ordenar(k: Fase) {
  return (a: Melhoria, b: Melhoria) => {
    if (emDev(k)) return (a.data_termino || '9999').localeCompare(b.data_termino || '9999') || a.prioridade - b.prioridade || nome(a, b)
    if (k === 'producao') return (b.data_conclusao || '').localeCompare(a.data_conclusao || '') || nome(a, b)
    if (k === 'ideia') return (a.fila_ideia ?? 9999) - (b.fila_ideia ?? 9999) || (a.ordem_top ?? 9999) - (b.ordem_top ?? 9999) || a.prioridade - b.prioridade || nome(a, b)
    const c = k === 'priorizada' ? 'data_priorizacao' : k === 'especificacao' ? 'data_especificacao' : 'data_abertura'
    return a.prioridade - b.prioridade || ((a[c] as string) || '9999').localeCompare((b[c] as string) || '9999') || nome(a, b)
  }
}
const lerModo = (): Modo => { try { return localStorage.getItem('melhorias-modo') === 'lista' ? 'lista' : 'quadro' } catch { return 'quadro' } }

export default function Melhorias() {
  const { profile } = useAuth()
  const uid = profile!.id
  const hoje = todayStr()
  const [rows, setRows] = useState<Melhoria[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [usuarios, setUsuarios] = useState<{ id: string; nome: string }[]>([])
  const [fResp, setFResp] = useState('')
  const [soSla, setSoSla] = useState(false)
  const [soVenc, setSoVenc] = useState(false)
  const [fFase, setFFase] = useState('')
  const [ordem, setOrdem] = useState<{ k: string; d: 1 | -1 }>({ k: 'etapa', d: 1 })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [visao, setVisao] = useState<Visao>('acompanhamento')
  const [aba, setAba] = useState<Aba>('todas')
  const [modo, setModo] = useState<Modo>(lerModo)
  const [fMod, setFMod] = useState('')
  const [q, setQ] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<Melhoria> | null>(null)
  const [avancar, setAvancar] = useState<Melhoria | null>(null)
  const [filaAberta, setFilaAberta] = useState(false)
  const canEdit = (m: Melhoria) => m.criado_por === uid || m.responsavel_id === uid || canViewAll(profile!.perfil)
  const trocaModo = (m: Modo) => { setModo(m); try { localStorage.setItem('melhorias-modo', m) } catch { /* sem armazenamento */ } }

  async function load() {
    const [a, d] = await Promise.all([
      supabase.from('backlog_melhorias').select('*').eq('tipo_backlog', 'melhoria').order('prioridade', { ascending: true }).order('id', { ascending: true }),
      supabase.from('profiles').select('id,nome,ativo'),
    ])
    if (a.error) setErr('Não foi possível carregar as melhorias: ' + a.error.message + ' (a migração 021 foi executada?)'); else { setErr(''); setRows((a.data || []) as Melhoria[]) }
    const ps = (d.data || []) as { id: string; nome: string; ativo?: boolean }[]
    setNomes(Object.fromEntries(ps.map((p) => [p.id, p.nome])))
    setUsuarios(ps.filter((p) => p.ativo !== false).map((p) => ({ id: p.id, nome: p.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const modulos = useMemo(() => [...new Set(rows.map((r) => r.modulo))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [rows])
  const fase = (r: Melhoria) => faseDe(r)
  const porFase = (k: Fase) => rows.filter((r) => fase(r) === k)
  const abertas = rows.filter((r) => fase(r) !== 'producao')
  const semResp = abertas.filter((r) => !r.responsavel_id)
  const nomeResp = (r: Melhoria) => (r.responsavel_id && nomes[r.responsavel_id]) || r.responsavel || null
  const atrasadas = abertas.filter((r) => vencida(r, hoje))
  const slaVenc = abertas.filter((r) => slaAtrasado(r, hoje))
  const aguardandoChamado = rows.filter((r) => fase(r) === 'priorizada' || fase(r) === 'especificacao')
  const devSemPrazo = rows.filter((r) => emDev(fase(r)) && !r.data_termino)

  const t = q.trim().toLowerCase()
  const passa = (r: Melhoria) => (!soSla || slaAtrasado(r, hoje)) && (!soVenc || vencida(r, hoje)) && (!fMod || r.modulo === fMod) && (!fResp || (fResp === '__sem' ? !r.responsavel_id : r.responsavel_id === fResp)) && (!de || (!!r.data_abertura && r.data_abertura >= de)) && (!ate || (!!r.data_abertura && r.data_abertura <= ate)) &&
    (!t || [r.melhoria, r.descricao, r.descricao_detalhada, r.objetivo, r.modulo, nomeResp(r), r.numero_chamado].join(' ').toLowerCase().includes(t))
  const visiveis = (k: Fase) => porFase(k).filter(passa).sort(ordenar(k))

  async function setPrazo(m: Melhoria, v: string) {
    if (m.data_inicio && v && v < m.data_inicio) return setErr('O prazo não pode ser anterior ao início.')
    const r = await supabase.from('backlog_melhorias').update({ data_termino: v || null }).eq('id', m.id).select('id')
    if (r.error || !r.data?.length) return setErr('Não foi possível salvar o prazo: ' + (r.error?.message || 'sem permissão (somente quem criou, Diretor, Gerente ou Analista Sr).'))
    setErr(''); await load()
  }
  async function setResp(m: Melhoria, id: string) {
    const u = usuarios.find((x) => x.id === id)
    const r = await supabase.from('backlog_melhorias').update({ responsavel_id: id || null, responsavel: u?.nome || null }).eq('id', m.id).select('id')
    if (r.error || !r.data?.length) return setErr('Não foi possível salvar o responsável: ' + (r.error?.message || 'sem permissão (somente quem criou, o responsável, Diretor, Gerente ou Analista Sr).'))
    setErr(''); await load()
  }
  async function confirmarAvanco(m: Melhoria, payload: Record<string, unknown>) {
    const r = await supabase.from('backlog_melhorias').update(payload).eq('id', m.id).select('id')
    if (r.error) return r.error.message
    if (!r.data?.length) return 'Você não tem permissão para alterar esta melhoria (somente quem criou, Diretor, Gerente ou Analista Sr).'
    setAvancar(null); setErr(''); await load()
    return ''
  }
  async function save(p: Partial<Melhoria>) {
    const payload: any = {
      modulo: (p.modulo || '').trim(), melhoria: (p.melhoria || '').trim(),
      descricao: p.descricao?.trim() || null, descricao_detalhada: p.descricao_detalhada?.trim() || null,
      objetivo: p.objetivo?.trim() || null, objetivo_detalhado: p.objetivo_detalhado?.trim() || null,
      as_is: p.as_is?.trim() || null, to_be: p.to_be?.trim() || null,
      prioridade: Number(p.prioridade) || 3, responsavel_id: p.responsavel_id || null, responsavel: usuarios.find((u) => u.id === p.responsavel_id)?.nome || p.responsavel?.trim() || null,
      data_ideia: p.data_ideia || null, data_priorizacao: p.data_priorizacao || null, data_especificacao: p.data_especificacao || null, data_abertura: p.data_abertura || null, data_homologacao: p.data_homologacao || null, numero_chamado: p.numero_chamado?.trim() || null,
      ...(podeAjustarSla(profile!.perfil) ? { sla_chamado_dias_uteis: Number(p.sla_chamado_dias_uteis ?? 3), sla_dev_dias_corridos: Number(p.sla_dev_dias_corridos ?? 15) } : {}),
      data_inicio: p.data_inicio || null, data_termino: p.data_termino || null, observacoes: p.observacoes?.trim() || null,
    }
    payload.status = p.status || 'A Iniciar'
    payload.percentual_concluido = pctDaFase(p.fase || 'ideia')   // o andamento acompanha a etapa do funil
    payload.fase = p.fase || 'ideia'
    payload.data_conclusao = payload.fase === 'producao' ? p.data_conclusao || null : null
    const r = p.id
      ? await supabase.from('backlog_melhorias').update(payload).eq('id', p.id).select('id')
      : await supabase.from('backlog_melhorias').insert({ ...payload, tipo_backlog: 'melhoria', criado_por: uid }).select('id')
    if (r.error) return r.error.message
    if (p.id && (!r.data || r.data.length === 0)) return 'Você não tem permissão para editar este item (somente quem criou, Diretor, Gerente ou Analista Sr).'
    setEdit(null); await load()
    return ''
  }
  async function remove(m: Melhoria) {
    if (!(await confirmar({ titulo: 'Excluir melhoria?', mensagem: <>Excluir <b>“{m.melhoria}”</b> com suas etapas e histórico? Fica na <b>Lixeira por 48 horas</b> e pode ser restaurada; depois disso some de vez.</>, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('backlog_melhorias').delete().eq('id', m.id).select('id')
    if (r.error || !r.data?.length) setErr('Não foi possível excluir: ' + (r.error?.message || 'sem permissão.'))
    else { setSelId(null); await load() }
  }
  const colAn: { k: string; l: string; v: (r: Melhoria) => string | number }[] = [
    { k: 'melhoria', l: 'Melhoria', v: (r) => r.melhoria.toLowerCase() }, { k: 'modulo', l: 'Módulo', v: (r) => r.modulo.toLowerCase() },
    { k: 'etapa', l: 'Etapa', v: (r) => faseIdx(fase(r)) }, { k: 'resp', l: 'Responsável', v: (r) => (nomeResp(r) || '~').toLowerCase() },
    { k: 'prio', l: 'Prior.', v: (r) => r.prioridade }, { k: 'ideia', l: 'Ideia', v: (r) => r.data_ideia || '' },
    { k: 'pri', l: 'Priorização', v: (r) => r.data_priorizacao || '' }, { k: 'esp', l: 'Especif.', v: (r) => r.data_especificacao || '' },
    { k: 'cham', l: 'Chamado', v: (r) => r.data_abertura || '' }, { k: 'dev', l: 'Desenv.', v: (r) => r.data_inicio || '' },
    { k: 'hom', l: 'Homolog.', v: (r) => r.data_homologacao || '' }, { k: 'prazo', l: 'Prazo entrega', v: (r) => r.data_termino || '9999' },
    { k: 'prod', l: 'Produção', v: (r) => dataDaFase(r, 'producao') || '' },
  ]
  const linhasAn = rows.filter((r) => passa(r) && (!fFase || fase(r) === fFase)).sort((a, b) => {
    const c = colAn.find((x) => x.k === ordem.k)!; const va = c.v(a), vb = c.v(b)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
    return (cmp || a.prioridade - b.prioridade || a.melhoria.localeCompare(b.melhoria, 'pt-BR')) * (cmp ? ordem.d : 1)
  })
  const listaExport = () => visao === 'analitico' ? linhasAn : FASES.flatMap((k) => (aba === 'abertas' && k === 'producao') || (aba !== 'abertas' && aba !== 'todas' && aba !== k) ? [] : visiveis(k))
  const exportCsv = () => download(`melhorias-${hoje}.csv`, toCSV([
    ['ID', 'Módulo', 'Melhoria', 'Resumo', 'Objetivo', 'AS IS', 'TO BE', 'Etapa do processo', 'Responsável', 'Prioridade', 'Posição "10 primeiras"', 'Ideia em', 'Priorização em', 'Especificação em', 'Chamado aberto em', 'Nº do chamado', 'Desenvolvimento iniciado em', 'Homologação em', 'Prazo de entrega', 'Em produção desde', 'Status', '% concluído', 'Situação do prazo', 'SLA da etapa', 'Vencimento do SLA'],
    ...listaExport().map((r) => [r.codigo_base, r.modulo, r.melhoria, resumoDe(r), r.objetivo, r.as_is, r.to_be, faseInfo(fase(r)).label, nomeResp(r), r.prioridade, r.ordem_top, fmtDate(r.data_ideia), fmtDate(r.data_priorizacao), fmtDate(r.data_especificacao), fmtDate(r.data_abertura), r.numero_chamado, fmtDate(r.data_inicio), fmtDate(r.data_homologacao), fmtDate(r.data_termino), fmtDate(dataDaFase(r, 'producao')), r.status, pctDaFase(fase(r)), prazoInfo(r, hoje).txt, slaAtual(r, hoje)?.txt ?? '', fmtDate(slaAtual(r, hoje)?.venc)]),
  ]))

  const sel = selId ? rows.find((r) => r.id === selId) : null
  if (sel) {
    return <BacklogDetalhe m={sel} nomes={nomes} usuarios={usuarios} podeEditar={canEdit(sel)} podeExcluir={canAdmin(profile!.perfil)} modulos={modulos}
      onBack={() => setSelId(null)} onChanged={load} onDelete={() => remove(sel)} onSaveMelhoria={save} />
  }

  /** Próxima etapa do processo. */
  const proxima = (r: Melhoria) => { const i = faseIdx(fase(r)); return i < FASES.length - 1 ? FASE_INFO[i + 1] : null }
  const naEtapa = (r: Melhoria) => { const d = dataDaFase(r, fase(r)); if (!d || fase(r) === 'producao') return null; const n = diasEntre(d, hoje); return n < 0 ? null : n === 0 ? 'desde hoje' : `há ${n} dia${n === 1 ? '' : 's'}` }
  const botaoAvancar = (r: Melhoria, mini = false) => {
    const p = proxima(r); if (!p || !canEdit(r)) return null
    return <button className={btnP + ' ' + btnSm + (mini ? ' !px-2 !py-1 !text-[11px]' : '')} onClick={() => setAvancar(r)} title={`Avançar para: ${p.label}`}>{mini ? '→ ' + p.curto : 'Avançar → ' + p.icon + ' ' + p.label}</button>
  }

  const slaBadge = (r: Melhoria, pequeno = false) => {
    const s = slaAtual(r, hoje); if (!s) return null
    return <div className={'mt-1 rounded-lg border px-2 py-1 font-semibold ' + (pequeno ? 'text-[11px]' : 'text-xs')} style={{ color: s.cor, borderColor: s.cor + '66', background: s.cor + '12' }} title={`${s.regra} · início ${fmtDate(s.inicio)} · vence ${fmtDate(s.venc)}`}>{s.estado === 'atrasado' ? '' : ''}{s.txt} <span className="font-normal opacity-80">(até {fmtDate(s.venc)})</span></div>
  }
  const cartao = (r: Melhoria) => {
    const pi = prazoInfo(r, hoje); const resumo = resumoDe(r); const f = faseInfo(fase(r)); const dias = naEtapa(r)
    return (
      <Card key={r.id} className="flex flex-col gap-2 !p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">{r.modulo}</span>
          {r.ordem_top != null && (fase(r) === 'ideia' || fase(r) === 'priorizada') && <span className="rounded-md bg-navy px-1.5 py-0.5 text-[11px] font-bold text-white" title="Posição na lista “10 primeiras”">#{r.ordem_top}</span>}
          <span className="text-[11px] text-slate-500" title="Criticidade/prioridade (1 = mais alta)">prioridade {r.prioridade}</span>
          {r.numero_chamado && <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-[11px] font-bold text-cyan-700" title="Nº do chamado">{r.numero_chamado}</span>}
          <span className="ml-auto"><Chip color={f.cor}>{f.icon} {f.label}</Chip></span>
        </div>
        <button className="text-left font-bold text-navy hover:underline" onClick={() => setSelId(r.id)} title="Abrir detalhes (etapas, histórico, AS IS / TO BE)">{r.melhoria}</button>
        <FunilLinha m={r} />
        <p className="text-sm text-slate-600" style={clamp(3)}>{resumo || <span className="text-slate-400">Sem resumo cadastrado.</span>}</p>
        {r.objetivo && r.objetivo !== resumo && <p className="text-xs text-slate-500" style={clamp(2)}><b>Objetivo:</b> {r.objetivo}</p>}
        <div><div className="flex justify-between text-xs font-semibold text-slate-600"><span>Andamento</span><span>{pctDaFase(fase(r))}%</span></div><Bar pct={pctDaFase(fase(r))} color={f.cor} /></div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-2">
          <label className="text-xs text-slate-500">Prazo de entrega
            <input type="date" className={inp + ' mt-0.5 !py-1 text-sm'} value={r.data_termino || ''} disabled={!canEdit(r) || fase(r) === 'producao'} aria-label={`Prazo de ${r.melhoria}`}
              onChange={(e) => setPrazo(r, e.target.value)} />
          </label>
          <div className="text-right text-xs font-semibold" style={{ color: pi.cor }}>{vencida(r, hoje) ? '' : ''}{pi.txt}</div>
        </div>
        <label className="text-xs text-slate-500">Responsável
          <select className={inp + ' mt-0.5 !py-1 text-sm ' + (!r.responsavel_id ? '!border-amber-400' : '')} value={r.responsavel_id || ''} disabled={!canEdit(r)} aria-label={`Responsável por ${r.melhoria}`} onChange={(e) => setResp(r, e.target.value)}>
            <option value="">Sem responsável</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}{r.responsavel_id && !usuarios.some((u) => u.id === r.responsavel_id) && <option value={r.responsavel_id}>{nomeResp(r) || '(inativo)'}</option>}
          </select>
        </label>
        {slaBadge(r)}
        {(dias || proxima(r)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{dias ? <>Nesta etapa {dias}</> : null}</span>{botaoAvancar(r)}
          </div>
        )}
      </Card>
    )
  }
  /** Fila de ideias: ordem global (sem filtros) e reordenação pelo Analista Sr. */
  const filaGlobal = rows.filter((r) => faseDe(r) === 'ideia').sort(ordenar('ideia'))
  const posFila = (r: Melhoria) => filaGlobal.findIndex((x) => x.id === r.id) + 1
  const podeFila = canAdmin(profile!.perfil)
  async function salvarFila(ids: string[]): Promise<string> {
    const { error } = await supabase.rpc('melhorias_fila_ideias', { p_ids: ids })
    if (error) return 'Não foi possível salvar a fila: ' + error.message + ' (a migração 036 foi executada?)'
    setFilaAberta(false); setErr(''); await load(); return ''
  }
  const mini = (r: Melhoria) => {
    const pi = prazoInfo(r, hoje); const dias = naEtapa(r); const resumo = resumoDe(r)
    return (
      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1">
          {faseDe(r) === 'ideia' && <span className="rounded bg-navy px-1.5 py-0.5 text-[10px] font-bold text-white" title="Posição na fila de ideias">#{posFila(r)}</span>}
          <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-700">{r.modulo}</span>
          <span className="text-[10px] text-slate-500">prior. {r.prioridade}</span>
          {r.numero_chamado && <span className="rounded bg-cyan-50 px-1 py-0.5 text-[10px] font-bold text-cyan-700">{r.numero_chamado}</span>}
        </div>
        <button className="mt-1 text-left text-sm font-bold text-navy hover:underline" onClick={() => setSelId(r.id)}>{r.melhoria}</button>
        {resumo && <p className="mt-1 text-xs text-slate-500" style={clamp(2)}>{resumo}</p>}
        <div className="mt-1 flex items-center gap-1"><div className="flex-1"><Bar pct={pctDaFase(fase(r))} color={faseInfo(fase(r)).cor} /></div><span className="text-[10px] font-semibold text-slate-500">{pctDaFase(fase(r))}%</span></div>
        {slaBadge(r, true)}
        <div className={'mt-1 text-[11px] ' + (r.responsavel_id ? 'text-slate-600' : 'font-semibold text-amber-600')}>{nomeResp(r) || 'sem responsável'}</div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px]">
          <span className="text-slate-500">{fase(r) === 'producao' ? pi.txt : dias ? `Na etapa ${dias}` : ''}</span>
          {(emDev(fase(r)) || r.data_termino) && fase(r) !== 'producao' && <span className="font-semibold" style={{ color: pi.cor }}>{pi.txt}</span>}
        </div>
        {proxima(r) && canEdit(r) && <div className="mt-2 text-right">{botaoAvancar(r, true)}</div>}
      </div>
    )
  }

  const kp = (k: Fase) => {
    const f = faseInfo(k); const n = porFase(k).length
    return (
      <button key={k} className={'rounded-md border bg-white p-3 text-left transition hover:border-violet-300 ' + (aba === k ? 'border-violet-400 ring-2 ring-violet-200' : 'border-slate-200')} onClick={() => setAba(k)} title={f.ajuda}>
        <div className="flex items-center gap-1 text-xs text-slate-500"><span>{FASES.indexOf(k) + 1}.</span><span>{f.icon}</span><span className="truncate">{f.label}</span></div>
        <div className="text-2xl font-extrabold" style={{ color: f.cor }}>{n}</div>
      </button>
    )
  }

  const emQuadro = modo === 'quadro' && (aba === 'abertas' || aba === 'todas')
  const colunas = FASES.filter((k) => (aba === 'abertas' ? k !== 'producao' : aba === 'todas' ? true : aba === k))
  const nada = (aba === 'abertas' || aba === 'todas' ? colunas.flatMap((k) => visiveis(k)) : visiveis(aba as Fase)).length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Melhorias</h1>
          <p className="text-sm text-slate-500">Acompanhe cada melhoria do processo: ideia → priorização → especificação → chamado aberto → desenvolvimento → homologação → produção.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnG} onClick={exportCsv} disabled={!rows.length}>Exportar (CSV)</button>
          <button className={btnP} onClick={() => setEdit({ status: 'A Iniciar', fase: 'ideia', prioridade: 3, percentual_concluido: 0, data_ideia: hoje, responsavel_id: uid, responsavel: usuarios.find((u) => u.id === uid)?.nome || profile!.nome })}>+ Nova melhoria</button>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}

      <div className="flex gap-1" role="tablist" aria-label="Tipo de visão">
        {([['acompanhamento', 'Acompanhamento'], ['gerencial', 'Visão gerencial'], ['analitico', 'Analítico']] as [Visao, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={visao === k} className={'rounded-xl border px-4 py-2 text-sm font-bold ' + (visao === k ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-violet-50')} onClick={() => setVisao(k)}>{l}</button>
        ))}
      </div>

      {visao === 'gerencial' ? (
        loading ? <p className="py-6 text-center text-slate-500">Carregando…</p> :
        <MelhoriasGerencial rows={rows} hoje={hoje} nomeResp={nomeResp} onAbrir={(id) => setSelId(id)} onIrParaEtapa={(k) => { setAba(k); setModo('lista'); setVisao('acompanhamento') }} />
      ) : visao === 'analitico' ? (<>
        <Card className="!p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Módulo" className="min-w-[160px]"><select className={inp} value={fMod} onChange={(e) => setFMod(e.target.value)}><option value="">Todos</option>{modulos.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Etapa" className="min-w-[160px]"><select className={inp} value={fFase} onChange={(e) => setFFase(e.target.value)}><option value="">Todas</option>{FASE_INFO.map((f) => <option key={f.k} value={f.k}>{f.icon} {f.label}</option>)}</select></Field>
            <Field label="Responsável" className="min-w-[170px]"><select className={inp} value={fResp} onChange={(e) => setFResp(e.target.value)}><option value="">Todos</option><option value="__sem">Sem responsável</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></Field>
            <Field label="Buscar" className="min-w-[200px] flex-1"><input className={inp} placeholder="Melhoria, resumo, nº do chamado, responsável…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            <Field label="Chamado aberto de"><input type="date" className={inp} value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} /></Field>
            <Field label="até"><input type="date" className={inp} value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button className={'rounded-full border px-3 py-1 font-semibold ' + (soVenc ? 'border-red-400 bg-red-50 text-red-700 ring-2 ring-red-200' : 'border-slate-200 bg-white text-slate-600')} aria-pressed={soVenc} onClick={() => setSoVenc((v) => !v)}>Só prazo vencido ({atrasadas.length})</button>
            <button className={'rounded-full border px-3 py-1 font-semibold ' + (soSla ? 'border-red-400 bg-red-50 text-red-700 ring-2 ring-red-200' : 'border-slate-200 bg-white text-slate-600')} aria-pressed={soSla} onClick={() => setSoSla((v) => !v)}>Só SLA vencido ({slaVenc.length})</button>
            {(fMod || q || de || ate || fResp || soSla || soVenc || fFase) && <button className={btnG + ' ' + btnSm} onClick={() => { setFMod(''); setQ(''); setDe(''); setAte(''); setFResp(''); setSoSla(false); setSoVenc(false); setFFase('') }}>Limpar filtros</button>}
            <span className="ml-auto text-slate-500">{linhasAn.length} de {rows.length} melhorias · clique no cabeçalho para ordenar · “Exportar (CSV)” leva esta lista</span>
          </div>
        </Card>
        {loading ? <p className="py-6 text-center text-slate-500">Carregando…</p> : linhasAn.length === 0 ? <Empty>Nenhuma melhoria com estes filtros.</Empty> : (
          <Card className="!p-0">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600"><tr>
                  {colAn.map((c) => <th key={c.k} className="whitespace-nowrap px-2 py-2"><button className="font-bold hover:text-navy" onClick={() => setOrdem((o) => ({ k: c.k, d: o.k === c.k ? (o.d === 1 ? -1 : 1) : 1 }))} aria-label={`Ordenar por ${c.l}`}>{c.l}{ordem.k === c.k ? (ordem.d === 1 ? ' ▲' : ' ▼') : ''}</button></th>)}
                  <th className="px-2 py-2">Nº chamado</th><th className="px-2 py-2">SLA</th><th className="px-2 py-2 text-right">Ações</th>
                </tr></thead>
                <tbody>{linhasAn.map((r) => { const f = faseInfo(fase(r)); const sl = slaAtual(r, hoje); const pi = prazoInfo(r, hoje); return (
                  <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-violet-50/40">
                    <td className="max-w-[260px] px-2 py-1.5"><button className="text-left font-semibold text-navy hover:underline" onClick={() => setSelId(r.id)}>{r.melhoria}</button></td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{r.modulo}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold" style={{ color: f.cor }}>{f.icon} {f.label}</td>
                    <td className={'px-2 py-1.5 text-xs ' + (r.responsavel_id ? 'text-slate-700' : 'font-semibold text-amber-600')}>{nomeResp(r) || 'sem responsável'}</td>
                    <td className="px-2 py-1.5 text-center text-xs">{r.prioridade}</td>
                    {[r.data_ideia, r.data_priorizacao, r.data_especificacao, r.data_abertura, r.data_inicio, r.data_homologacao].map((d, i) => <td key={i} className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">{fmtDate(d)}</td>)}
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold" style={{ color: pi.cor }}>{r.data_termino ? fmtDate(r.data_termino) : '—'}{vencida(r, hoje) ? ' ' : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">{fmtDate(dataDaFase(r, 'producao'))}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">{r.numero_chamado || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold" style={{ color: sl?.cor || '#94a3b8' }}>{sl ? `${sl.txt} (até ${fmtDate(sl.venc)})` : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <button className={btnG + ' ' + btnSm} onClick={() => setSelId(r.id)}>Abrir</button>{' '}
                      {canAdmin(profile!.perfil) && <button className={btnD + ' ' + btnSm} onClick={() => remove(r)} aria-label={`Excluir ${r.melhoria}`}>Excluir</button>}
                    </td>
                  </tr>) })}</tbody>
              </table>
            </div>
          </Card>
        )}
        {!canAdmin(profile!.perfil) && <p className="text-xs text-slate-500">Só o Analista Sr pode excluir melhorias.</p>}
      </>
      ) : (<>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">{FASES.map((k) => kp(k))}</div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button className={'rounded-full border px-3 py-1 font-semibold ' + (atrasadas.length ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500') + (soVenc ? ' ring-2 ring-red-300' : '')} aria-pressed={soVenc} onClick={() => { setAba('todas'); setSoVenc((v) => !v) }} title="Melhorias abertas com prazo de entrega vencido. Clique para filtrar.">Prazo vencido: {atrasadas.length}</button>
        <button className={'rounded-full border px-3 py-1 font-semibold ' + (slaVenc.length ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500') + (soSla ? ' ring-2 ring-red-300' : '')} aria-pressed={soSla} onClick={() => { setAba('todas'); setSoSla((v) => !v) }} title="Chamado aberto há mais que o SLA sem iniciar o desenvolvimento, ou desenvolvimento além do SLA sem ir para homologação. Clique para filtrar.">SLA vencido: {slaVenc.length}</button>
        <button className={'rounded-full border px-3 py-1 font-semibold ' + (semResp.length ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500')} onClick={() => { setAba('todas'); setFResp('__sem') }} title="Melhorias abertas sem responsável definido">Sem responsável: {semResp.length}</button>
        <span className={'rounded-full border px-3 py-1 font-semibold ' + (aguardandoChamado.length ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500')} title="Priorizadas (ou em especificação) que ainda não tiveram o chamado aberto">Aguardando abertura de chamado: {aguardandoChamado.length}</span>
        <span className={'rounded-full border px-3 py-1 font-semibold ' + (devSemPrazo.length ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500')} title="Em desenvolvimento sem prazo de entrega definido">Em desenvolvimento/homologação sem prazo: {devSemPrazo.length}</span>
      </div>

      <Card className="!p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visão">
            {([['todas', 'Todas'], ...FASE_INFO.map((f) => [f.k, f.curto])] as [Aba, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={aba === k} className={'rounded-full border px-3 py-1.5 text-sm font-semibold ' + (aba === k ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-violet-50')} onClick={() => setAba(k)}>{l}</button>
            ))}
          </div>
          <div className="flex gap-1" role="group" aria-label="Modo de exibição">
            {([['quadro', '▦ Quadro'], ['lista', '☰ Cartões']] as [Modo, string][]).map(([k, l]) => (
              <button key={k} aria-pressed={modo === k} className={'rounded-lg border px-2.5 py-1.5 text-sm font-semibold ' + (modo === k ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-600')} onClick={() => trocaModo(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Módulo" className="min-w-[160px]"><select className={inp} value={fMod} onChange={(e) => setFMod(e.target.value)}><option value="">Todos</option>{modulos.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Responsável" className="min-w-[170px]"><select className={inp} value={fResp} onChange={(e) => setFResp(e.target.value)}><option value="">Todos</option><option value="__sem">Sem responsável</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></Field>
          <Field label="Buscar" className="min-w-[200px] flex-1"><input className={inp} placeholder="Melhoria, resumo, objetivo, nº do chamado, responsável…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Chamado aberto de"><input type="date" className={inp} value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} /></Field>
          <Field label="até"><input type="date" className={inp} value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} /></Field>
          {(fMod || q || de || ate || fResp || soSla || soVenc) && <button className={btnG + ' ' + btnSm} onClick={() => { setFMod(''); setQ(''); setDe(''); setAte(''); setFResp(''); setSoSla(false); setSoVenc(false) }}>Limpar filtros</button>}
        </div>
        {(de || ate) && <p className="mt-2 text-xs text-amber-700">Filtro de data ativo: só aparecem melhorias com chamado aberto no período (as que ainda não têm chamado ficam de fora).</p>}
        <p className="mt-2 text-xs text-slate-500">{aba === 'abertas' || aba === 'todas' ? 'Cada coluna é uma etapa do processo.' : faseInfo(aba).ajuda} Dentro da etapa, quem espera há mais tempo ou vence antes aparece primeiro. <b>Clique no título</b> para abrir os detalhes (AS IS → TO BE e histórico) e use <b>Avançar</b> para registrar a próxima etapa com a data.</p>
      </Card>

      {loading ? <p className="py-6 text-center text-slate-500">Carregando…</p> : rows.length === 0 ? (
        <Empty>Nenhuma melhoria ainda. O Analista Sr importa a base em <b>Importar bases</b>, ou use “+ Nova melhoria”.</Empty>
      ) : nada ? (
        <Empty>Nenhuma melhoria com estes filtros.</Empty>
      ) : emQuadro ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {colunas.map((k) => { const f = faseInfo(k); const l = visiveis(k); return (
            <section key={k} aria-label={f.label} className="flex min-h-[8rem] w-[250px] shrink-0 flex-col rounded-md bg-slate-50 p-2 xl:min-w-[230px] xl:flex-1">
              <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-bold" style={{ color: f.cor }}><span>{f.icon}</span>{f.label}<span className="ml-auto rounded-full bg-white px-2 text-xs text-slate-600">{l.length}</span></h2>
              {k === 'ideia' && <div className="mb-2 px-1 text-[11px] text-slate-500">Fila: #1 é a próxima a ser priorizada.{podeFila && <button className={btnG + ' ' + btnSm + ' mt-1 w-full'} onClick={() => setFilaAberta(true)}>⇅ Organizar fila de ideias</button>}</div>}
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-0.5">{l.length ? l.map((r) => mini(r)) : <p className="px-1 py-4 text-center text-xs text-slate-400">Nada nesta etapa.</p>}</div>
            </section>
          ) })}
        </div>
      ) : (
        <>{(aba === 'abertas' || aba === 'todas' ? colunas : [aba as Fase]).map((k) => { const f = faseInfo(k); const l = visiveis(k); return (
          <section key={k} aria-label={f.label}>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-navy"><span className="inline-block h-3 w-3 rounded-full" style={{ background: f.cor }} />{f.icon} {f.label} <span className="text-sm font-normal text-slate-500">({l.length})</span></h2>
            {l.length === 0 ? <Empty>Nada nesta etapa com estes filtros.</Empty> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{l.map((r) => cartao(r))}</div>}
          </section>
        ) })}</>
      )}

      </>)}

      {edit && <MelhoriaForm funil usuarios={usuarios} init={edit} modulos={modulos} temEtapas={false} onClose={() => setEdit(null)} onSave={save} />}
      {filaAberta && <OrganizarFila ideias={filaGlobal} nomeResp={nomeResp} onClose={() => setFilaAberta(false)} onSave={salvarFila} />}
      {avancar && <AvancarFase m={avancar} onClose={() => setAvancar(null)} onConfirm={(p) => confirmarAvanco(avancar, p)} />}
    </div>
  )
}
