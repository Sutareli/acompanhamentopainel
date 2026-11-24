import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, download, fmtDate, PERFIL_LABEL, todayStr, toCSV, TZ } from '../lib/rules'
import { ehDiaUtil } from '../lib/sla'
import { Acesso, janela, LinhaAc, montar, PessoaAc } from '../lib/acessos'
import { btnG, btnP, btnSm, Card, Empty, Kpi, Msg } from '../components/ui'

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const corPct = (p: number | null) => (p === null ? '#94a3b8' : p >= 80 ? '#1fa65a' : p >= 50 ? '#f59e0b' : '#dc2626')

/** Visão gerencial de acesso: quem abriu a plataforma em cada dia. */
export default function Acessos() {
  const [pessoas, setPessoas] = useState<PessoaAc[]>([])
  const [acessos, setAcessos] = useState<Acesso[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [periodo, setPeriodo] = useState<7 | 14 | 30 | 'mes'>(14)
  const [comGestao, setComGestao] = useState(false)
  const [ordem, setOrdem] = useState<'nome' | 'aderencia'>('nome')
  const hoje = todayStr()

  const [atualizadoEm, setAtualizadoEm] = useState('')
  const carregar = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('profiles').select('id,nome,perfil,ativo').order('nome'),
      supabase.from('acessos').select('*').gte('dia', addDays(hoje, -62)),
    ])
    if (p.error || a.error) setErr('Não foi possível carregar os acessos: ' + (p.error || a.error)!.message + ' (a migração 037 foi executada?)')
    else setErr('')
    setPessoas(((p.data || []) as (PessoaAc & { ativo: boolean })[]).filter((x) => x.ativo))
    setAcessos((a.data || []) as Acesso[]); setLoading(false); setAtualizadoEm(new Date().toISOString())
  }, [hoje])
  useEffect(() => {   // atualiza sozinho a cada 2 minutos para acompanhar o dia
    carregar(); const t = setInterval(carregar, 120_000); return () => clearInterval(t)
  }, [carregar])

  const dias = useMemo(() => janela(hoje, periodo === 'mes' ? Number(hoje.slice(8, 10)) : periodo), [hoje, periodo])
  const grupo = useMemo(() => pessoas.filter((p) => comGestao || p.perfil === 'analista' || p.perfil === 'guardiao'), [pessoas, comGestao])
  const linhas = useMemo(() => {
    const l = montar(grupo, acessos, dias, hoje, ehDiaUtil)
    return ordem === 'nome' ? l : l.slice().sort((x, y) => (x.pct ?? 101) - (y.pct ?? 101) || x.pessoa.nome.localeCompare(y.pessoa.nome))
  }, [grupo, acessos, dias, hoje, ordem])

  const hojeUtil = ehDiaUtil(hoje)
  const acessaramHoje = linhas.filter((l) => l.dias[hoje]).length
  const comPct = linhas.filter((l) => l.pct !== null)
  const media = comPct.length ? Math.round(comPct.reduce((s, l) => s + (l.pct as number), 0) / comPct.length) : null
  const alerta = linhas.filter((l) => l.semAcesso >= 2).sort((a, b) => b.semAcesso - a.semAcesso)
  const inicioRegistro = acessos.filter((a) => a.origem === 'app').reduce<string>((m, a) => (!m || a.dia < m ? a.dia : m), '')
  const compacto = dias.length > 14

  function exportar() {
    const cab = ['Nome', 'Perfil', ...dias.map(fmtDate), 'Dias úteis', 'Com acesso', 'Aderência %', 'Último acesso']
    const corpo = linhas.map((l) => [l.pessoa.nome, PERFIL_LABEL[l.pessoa.perfil as keyof typeof PERFIL_LABEL] || l.pessoa.perfil,
      ...dias.map((d) => (l.dias[d] ? 'acessou' : ehDiaUtil(d) && d < hoje ? 'sem acesso' : '')), l.uteis, l.comAcesso, l.pct ?? '', l.ultimo ? dataHora(l.ultimo) : ''])
    download(`acessos-${hoje}.csv`, '﻿' + toCSV([cab, ...corpo]))
  }

  const celula = (l: LinhaAc, d: string) => {
    const a = l.dias[d], util = ehDiaUtil(d), passado = d < hoje
    const det = a ? `${l.pessoa.nome} · ${fmtDate(d)}\nPrimeiro: ${hora(a.primeiro_em)} · último: ${hora(a.ultimo_em)}${a.origem === 'historico' ? '\n(estimado pelas ações registradas)' : ''}` : `${l.pessoa.nome} · ${fmtDate(d)}\n${!util ? 'Sem expediente' : passado ? 'Não acessou' : 'Ainda não acessou hoje'}`
    let cls = 'bg-slate-100 text-slate-300', txt = '–'
    if (a) { cls = a.origem === 'historico' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-emerald-100 text-emerald-800'; txt = compacto ? '✓' : a.origem === 'historico' ? '~' + hora(a.primeiro_em) : hora(a.primeiro_em) }
    else if (util && passado) { cls = 'bg-red-50 text-red-600'; txt = '✗' }
    else if (util && d === hoje) { cls = 'bg-amber-50 text-amber-600'; txt = '·' }
    return <td key={d} className="p-0.5 text-center"><div title={det} className={'mx-auto grid h-8 place-items-center rounded text-[11px] font-semibold ' + cls} style={{ minWidth: compacto ? 20 : 46 }}>{txt}</div></td>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="border-l-4 border-indigo-600 pl-3 text-2xl font-bold text-ink">Acesso da equipe</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {([7, 14, 30, 'mes'] as const).map((p) => (
            <button key={p} className={periodo === p ? btnP : btnG} aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>{p === 'mes' ? 'Mês atual' : `${p} dias`}</button>))}
          <button className={btnG} onClick={carregar} title={atualizadoEm ? 'Atualizado às ' + hora(atualizadoEm) + ' (atualiza sozinho a cada 2 minutos)' : ''}>Atualizar{atualizadoEm ? ' · ' + hora(atualizadoEm) : ''}</button>
          <button className={btnG} onClick={exportar} disabled={!linhas.length}>Exportar CSV</button>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : (<>
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Acessaram hoje" value={hojeUtil ? `${acessaramHoje} de ${linhas.length}` : acessaramHoje} sub={hojeUtil ? 'Quem já abriu a plataforma hoje' : 'Hoje não é dia útil'} color={hojeUtil && acessaramHoje < linhas.length ? '#f59e0b' : '#1fa65a'} pct={linhas.length ? (acessaramHoje / linhas.length) * 100 : 0} />
          <Kpi label="Aderência no período" value={media === null ? '—' : media + '%'} sub="Dias úteis com acesso ÷ dias úteis (média das pessoas)" color={corPct(media)} pct={media ?? 0} />
          <Kpi label="Sem acesso há 2 dias úteis ou mais" value={alerta.length} sub={alerta.length ? alerta.map((a) => `${a.pessoa.nome.split(' ')[0]} (${a.semAcesso})`).join(' · ') : 'Ninguém neste momento'} color={alerta.length ? '#dc2626' : '#1fa65a'} />
        </div>
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={comGestao} onChange={(e) => setComGestao(e.target.checked)} /> Incluir gestão (Analista Sr, Gerente, Diretor)</label>
            <label className="flex items-center gap-2">Ordenar por
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={ordem} onChange={(e) => setOrdem(e.target.value as 'nome' | 'aderencia')}>
                <option value="nome">Nome</option><option value="aderencia">Menor aderência primeiro</option></select></label>
          </div>
          {linhas.length === 0 ? <Empty>Nenhum usuário para exibir.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead><tr>
                  <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left text-xs font-semibold text-slate-500">Pessoa</th>
                  {dias.map((d) => { const util = ehDiaUtil(d); return <th key={d} className={'px-0.5 pb-2 text-center text-[11px] font-semibold ' + (d === hoje ? 'text-indigo-700' : util ? 'text-slate-600' : 'text-slate-300')}>
                    <div>{compacto ? SEMANA[new Date(d + 'T12:00:00Z').getUTCDay()].slice(0, 1) : SEMANA[new Date(d + 'T12:00:00Z').getUTCDay()]}</div><div title={fmtDate(d)}>{compacto ? d.slice(8) : d.slice(8) + '/' + d.slice(5, 7)}</div></th> })}
                  <th className="pl-3 pb-2 text-left text-xs font-semibold text-slate-500">Aderência</th>
                  <th className="pl-3 pb-2 text-left text-xs font-semibold text-slate-500">Último acesso</th>
                </tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.pessoa.id} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1 pr-3"><div className="font-semibold text-ink">{l.pessoa.nome}</div><div className="text-[11px] text-slate-500">{PERFIL_LABEL[l.pessoa.perfil as keyof typeof PERFIL_LABEL] || l.pessoa.perfil}</div></td>
                      {dias.map((d) => celula(l, d))}
                      <td className="whitespace-nowrap pl-3"><span className="text-base font-bold" style={{ color: corPct(l.pct) }}>{l.pct === null ? '—' : l.pct + '%'}</span> <span className="text-xs text-slate-500">{l.comAcesso}/{l.uteis} dias</span></td>
                      <td className="whitespace-nowrap pl-3 text-xs text-slate-600">{l.ultimo ? dataHora(l.ultimo) : 'nunca acessou'}{l.semAcesso >= 2 && <span className="ml-1 rounded bg-red-100 px-1 font-semibold text-red-700">{l.semAcesso} dias sem acesso</span>}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">08:30</span> acessou (hora do primeiro acesso)
            <span className="rounded bg-red-50 px-2 py-0.5 font-semibold text-red-600">✗</span> dia útil sem acesso
            <span className="rounded bg-amber-50 px-2 py-0.5 font-semibold text-amber-600">·</span> hoje, ainda não acessou
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-400">–</span> fim de semana ou feriado
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Acesso = abrir a plataforma no dia (registrado ao entrar e a cada 10 minutos de uso). {inicioRegistro ? `O registro automático começou em ${fmtDate(inicioRegistro)}; ` : 'O registro automático começa a valer a partir da publicação desta versão; '}
            antes disso o acesso é <b>estimado</b> pelas ações registradas no sistema (marcado com ~), então quem só consultou sem alterar nada não aparece. Hoje só entra na aderência de quem já acessou.
          </p>
        </Card>
      </>)}
    </div>
  )
}
