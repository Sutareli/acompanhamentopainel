import { ReactNode, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, download, fmtDate, fmtDateTime, toCSV } from '../lib/rules'
import { btnG, btnSm, Card, Empty, HBars, Msg } from '../components/ui'
import ParetoChart from '../components/ParetoChart'
import { AreaDias, Rosca } from '../components/Charts2'
import Responsaveis from '../components/Responsaveis'
import { Chamado, contar, kpis, mesAnterior, mesKey, mesLabel, noPrazo, porDia, quinzenaDe, semanaDe, semanasDoMes } from '../lib/chamados'

/** "Pareto backlog" — análise qualitativa dos chamados abertos no backlog (visão da planilha "Análise de backlog"). Leitura para todos; carga só do Analista Sr. */
const lc = (s: string | null) => (s ?? '').trim().toLowerCase()

function Delta({ valor, texto, bomSeSobe }: { valor: number | null; texto: string; bomSeSobe: boolean }) {
  if (valor === null) return <span className="text-xs text-slate-400">sem mês anterior para comparar</span>
  const bom = valor === 0 ? null : bomSeSobe ? valor > 0 : valor < 0
  return <span className="text-xs text-slate-500">vs mês anterior <b className={bom === null ? 'text-slate-500' : bom ? 'text-green-600' : 'text-red-600'}>{(valor > 0 ? '▲ ' : valor < 0 ? '▼ ' : '') + texto}</b></span>
}
function KpiCard({ titulo, valor, sub, children }: { titulo: string; valor: string | number; sub?: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="mt-1 text-3xl font-bold text-navy">{valor}{sub && <span className="ml-2 text-base font-semibold text-violet-600">{sub}</span>}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}
const chip = (on: boolean) => 'rounded-full border px-3 py-1 text-xs font-semibold transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')

export default function ParetoBacklog({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Chamado[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [mes, setMes] = useState<string | null>(null)      // null = ainda não escolhido (usa o mais recente) · '' = todos
  const [tipos, setTipos] = useState<string[]>([])         // chaves em minúsculas; vazio = todos
  const [sub, setSub] = useState<string | null>(null)
  const [quinz, setQuinz] = useState<0 | 1 | 2>(0)       // 0 = mês inteiro · 1 = dias 1–15 · 2 = dia 16 em diante
  const [sem, setSem] = useState(0)                       // 0 = todas as semanas do mês · n = semana n (segunda a domingo)
  const [carga, setCarga] = useState<{ em: string; qtd: number; nome: string } | null>(null)

  async function load() {
    const all: Chamado[] = []
    for (let from = 0; ; from += 1000) {   // o Supabase devolve no máximo 1000 linhas por consulta
      const r = await supabase.from('backlog_chamados').select('*').order('data_ref', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
      if (r.error) { setErr('Não foi possível carregar os chamados: ' + r.error.message); setLoading(false); return }
      all.push(...((r.data || []) as Chamado[]))
      if (!r.data || r.data.length < 1000) break
    }
    setRows(all); setErr('')
    const c = await supabase.from('backlog_chamados_carga').select('em,qtd,usuario_id').order('em', { ascending: false }).limit(1)
    const u = c.data?.[0]
    if (u) {
      const p = u.usuario_id ? await supabase.from('profiles').select('nome').eq('id', u.usuario_id).maybeSingle() : null
      setCarga({ em: u.em, qtd: u.qtd, nome: p?.data?.nome || '' })
    } else setCarga(null)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const meses = useMemo(() => [...new Set(rows.map((r) => mesKey(r.data_ref)))].sort(), [rows])
  const mesSel = mes === null ? meses[meses.length - 1] || '' : mes
  const tiposDisp = useMemo(() => contar(rows, (c) => c.tipo).barras.map((b) => b.nome), [rows])
  const filtraTipo = (c: Chamado) => !tipos.length || tipos.includes(lc(c.tipo))
  const semanas = useMemo(() => (mesSel ? semanasDoMes(mesSel) : []), [mesSel])
  const noPeriodo = (c: Chamado) => (!quinz || quinzenaDe(c.data_ref) === quinz) && (!sem || semanaDe(c.data_ref) === sem)
  const doMes = useMemo(() => rows.filter((r) => (!mesSel || mesKey(r.data_ref) === mesSel) && (!mesSel || noPeriodo(r))), [rows, mesSel, quinz, sem]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtrado = useMemo(() => doMes.filter(filtraTipo), [doMes, tipos])  // eslint-disable-line react-hooks/exhaustive-deps
  const anterior = useMemo(() => (mesSel ? rows.filter((r) => mesKey(r.data_ref) === mesAnterior(mesSel) && (!quinz || quinzenaDe(r.data_ref) === quinz)).filter(filtraTipo) : []), [rows, mesSel, tipos, quinz]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = useMemo(() => kpis(filtrado), [filtrado])
  const kp = useMemo(() => kpis(anterior), [anterior])
  const temAnt = !!mesSel && !sem && anterior.length > 0

  const parTipo = useMemo(() => contar(doMes, (c) => c.tipo).barras, [doMes])            // o gráfico de tipo mostra todos os tipos (é ele que filtra)
  const sc = useMemo(() => contar(filtrado, (c) => c.subcategoria), [filtrado])
  const cat = useMemo(() => contar(filtrado, (c) => c.categoria), [filtrado])
  const tipoRosca = useMemo(() => contar(filtrado, (c) => c.tipo).barras, [filtrado])
  const dias = useMemo(() => (mesSel ? porDia(filtrado, mesSel) : []), [filtrado, mesSel])
  const porMes = useMemo(() => meses.map((m) => ({ label: mesLabel(m), value: rows.filter((r) => mesKey(r.data_ref) === m).filter(filtraTipo).length })), [rows, meses, tipos]) // eslint-disable-line react-hooks/exhaustive-deps
  const lista = useMemo(() => filtrado.filter((c) => !sub || lc(c.subcategoria) === lc(sub)), [filtrado, sub])

  const toggleTipo = (nome: string) => { const t = lc(nome); setSub(null); setTipos((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t])) }
  const escolheMes = (m: string) => { setMes(m); setSub(null); setQuinz(0); setSem(0) }
  const periodoTxt = (quinz ? `${quinz}ª quinzena` : '') + (quinz && sem ? ' · ' : '') + (sem ? `semana ${sem}` : '')
  const exporta = () => download(`chamados-backlog-${mesSel || 'todos'}${quinz ? '-q' + quinz : ''}${sem ? '-s' + sem : ''}.csv`, toCSV([
    ['ID', 'Data ref.', 'Item - sintoma', 'Cliente', 'Tipo', 'Categoria', 'Subcategoria', 'Sistema ofensor', 'Prazo', 'Status', 'Empresa responsável', 'Responsável', 'Responsável ROCCO'],
    ...lista.map((c) => [c.id_chamado, fmtDate(c.data_ref), c.item_sintoma, c.cliente, c.tipo, c.categoria, c.subcategoria, c.sistema_ofensor, c.prazo, c.status, c.empresa_responsavel, c.responsavel, c.responsavel_rocco]),
  ]))
  const pct = (v: number | null) => (v === null ? '—' : Math.round(v * 100) + '%')

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-navy to-violet-700 px-6 py-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wide sm:text-2xl">Análise qualitativa · abertura dos chamados backlog ROCCO</h1>
            <p className="mt-1 text-sm text-violet-200">Principais motivos e ofensores das aberturas de chamados</p>
          </div>
          <div className="text-right text-xs text-violet-200">
            {carga ? <>Base carregada em {fmtDateTime(carga.em)}{carga.nome ? ` por ${carga.nome}` : ''} · {carga.qtd} chamados</> : 'Nenhuma carga registrada'}
            {canAdmin(profile!.perfil) && <div className="mt-2"><button className={btnG + ' ' + btnSm} onClick={() => onNavigate('importar')}>⬆ Atualizar base (Importar bases)</button></div>}
          </div>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}

      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : rows.length === 0 ? (
        <Empty>{canAdmin(profile!.perfil) ? 'Ainda não há chamados na base. Use a janela “Importar bases” com a aba "base" da sua planilha de análise.' : 'Ainda não há chamados na base. Peça ao Analista Sr para importar a planilha.'}</Empty>
      ) : (<>
        {/* ===== filtros (equivalem às segmentações de MÊS_REF e TIPO da planilha) ===== */}
        <Card className="!p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mês de referência">
              <span className="text-xs font-bold uppercase text-slate-500">Mês</span>
              {meses.map((m) => <button key={m} className={chip(mesSel === m)} aria-pressed={mesSel === m} onClick={() => escolheMes(m)}>{mesLabel(m)}</button>)}
              <button className={chip(mesSel === '')} aria-pressed={mesSel === ''} onClick={() => escolheMes('')}>Todos</button>
            </div>
            {mesSel && <>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quinzena">
                <span className="text-xs font-bold uppercase text-slate-500">Quinzena</span>
                {([[0, 'Mês inteiro'], [1, '1ª (dias 1–15)'], [2, '2ª (dia 16 em diante)']] as [0 | 1 | 2, string][]).map(([v, l]) => <button key={v} className={chip(quinz === v)} aria-pressed={quinz === v} onClick={() => { setQuinz(v); setSub(null) }}>{l}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Semana">
                <span className="text-xs font-bold uppercase text-slate-500">Semana</span>
                <button className={chip(sem === 0)} aria-pressed={sem === 0} onClick={() => { setSem(0); setSub(null) }}>Todas</button>
                {semanas.map((w) => <button key={w.n} className={chip(sem === w.n)} aria-pressed={sem === w.n} title="Semana de segunda a domingo" onClick={() => { setSem(w.n); setSub(null) }}>S{w.n} · {String(w.ini).padStart(2, '0')}–{String(w.fim).padStart(2, '0')}</button>)}
              </div>
            </>}
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo de chamado">
              <span className="text-xs font-bold uppercase text-slate-500">Tipo</span>
              {tiposDisp.map((t) => <button key={t} className={chip(tipos.includes(lc(t)))} aria-pressed={tipos.includes(lc(t))} onClick={() => toggleTipo(t)}>{t}</button>)}
              {tipos.length > 0 && <button className={btnG + ' ' + btnSm} onClick={() => { setTipos([]); setSub(null) }}>Limpar tipo</button>}
            </div>
          </div>
        </Card>

        {/* ===== indicadores ===== */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard titulo="Total de chamados" valor={k.total}><Delta valor={temAnt && kp.total ? k.total / kp.total - 1 : null} texto={temAnt && kp.total ? Math.abs(Math.round((k.total / kp.total - 1) * 100)) + '%' : ''} bomSeSobe={false} /></KpiCard>
          <KpiCard titulo="Chamados no prazo" valor={k.noPrazo} sub={pct(k.pctPrazo)}><Delta valor={temAnt && k.pctPrazo !== null && kp.pctPrazo !== null ? (k.pctPrazo - kp.pctPrazo) * 100 : null} texto={temAnt && k.pctPrazo !== null && kp.pctPrazo !== null ? Math.abs((k.pctPrazo - kp.pctPrazo) * 100).toFixed(1).replace('.', ',') + ' p.p.' : ''} bomSeSobe /></KpiCard>
          <KpiCard titulo="Tipos de chamados" valor={k.tipos}><Delta valor={temAnt ? k.tipos - kp.tipos : null} texto={Math.abs(k.tipos - kp.tipos) + ''} bomSeSobe={false} /></KpiCard>
          <KpiCard titulo="Subcategorias" valor={k.subcategorias}><Delta valor={temAnt ? k.subcategorias - kp.subcategorias : null} texto={Math.abs(k.subcategorias - kp.subcategorias) + ''} bomSeSobe={false} /></KpiCard>
        </div>
        {!mesSel && <p className="text-xs text-slate-500">Com “Todos” os meses não há comparação com o mês anterior; os filtros de quinzena e semana aparecem ao escolher um mês.</p>}
        {!!mesSel && !!sem && <p className="text-xs text-slate-500">Filtro de semana: sem comparação com o mês anterior. Semanas vão de segunda a domingo (a 1ª e a última podem ser parciais).</p>}

        {filtrado.length === 0 ? <Empty>Nenhum chamado para este filtro.</Empty> : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <Card>
                <h3 className="font-bold text-navy">Tipo de chamado</h3>
                <p className="mb-2 text-xs text-slate-500">Clique em uma barra para filtrar os demais painéis por esse tipo.</p>
                <ParetoChart barras={parTipo} titulo="Pareto por tipo de chamado" destaque={tipos} onSelect={(n) => n && toggleTipo(n)} />
              </Card>
              <Card>
                <h3 className="font-bold text-navy">Subcategoria de chamado</h3>
                <p className="mb-2 text-xs text-slate-500">Clique em uma barra para listar os chamados dessa subcategoria abaixo.{sc.vazios > 0 && ` ${sc.vazios} chamado(s) sem subcategoria preenchida não entram neste gráfico.`}</p>
                <ParetoChart barras={sc.barras} titulo="Pareto por subcategoria" selecionado={sub} onSelect={setSub} />
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <h3 className="mb-2 font-bold text-navy">{mesSel ? 'Distribuição de chamados por dia' : 'Chamados por mês'}</h3>
                {mesSel ? <AreaDias valores={dias} mes={mesLabel(mesSel)} /> : <HBars rows={porMes} />}
              </Card>
              <Card><h3 className="mb-2 font-bold text-navy">Categoria</h3><Rosca titulo="Chamados por categoria" dados={cat.barras} total={filtrado.length - cat.vazios} rotulo="chamados" /></Card>
              <Card><h3 className="mb-2 font-bold text-navy">Tipo</h3><Rosca titulo="Chamados por tipo" dados={tipoRosca} total={filtrado.length} rotulo="chamados" /></Card>
            </div>
          </div>
        )}

        {/* ===== responsabilidade (clique para detalhar) ===== */}
        <Responsaveis base={rows} itens={lista} filtroTxt={(mesSel ? mesLabel(mesSel) : 'todos os meses') + (periodoTxt ? ' · ' + periodoTxt : '') + (tipos.length ? ' · ' + tipos.join(', ') : '') + (sub ? ' · ' + sub : '')} />

        {/* ===== chamados (detalhe) ===== */}
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 px-5 py-3">
            <h3 className="font-bold text-navy">Chamados{sub ? ` · ${sub}` : ''} <span className="text-sm font-normal text-slate-500">({lista.length})</span></h3>
            <div className="flex gap-2">
              {sub && <button className={btnG + ' ' + btnSm} onClick={() => setSub(null)}>Limpar subcategoria</button>}
              <button className={btnG + ' ' + btnSm} onClick={exporta} disabled={!lista.length}>⬇ Exportar (CSV)</button>
            </div>
          </div>
          {lista.length === 0 ? <div className="p-5"><Empty>Nenhum chamado.</Empty></div> : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[900px] text-left text-sm [&_th]:pr-2">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">ID</th><th>Data</th><th>Item / sintoma</th><th>Cliente</th><th>Tipo</th><th>Subcategoria</th><th>Prazo</th></tr></thead>
                <tbody>
                  {lista.slice(0, 200).map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-500">{c.id_chamado || '—'}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtDate(c.data_ref)}</td>
                      <td className="max-w-[360px] py-2 pr-2 font-medium text-navy">{c.item_sintoma || '—'}</td>
                      <td className="py-2 pr-2">{c.cliente || '—'}</td>
                      <td className="py-2 pr-2">{c.tipo || '—'}</td>
                      <td className="py-2 pr-2">{c.subcategoria || '—'}</td>
                      <td className={'whitespace-nowrap py-2 pr-2 font-semibold ' + (noPrazo(c) ? 'text-green-700' : c.prazo ? 'text-red-600' : 'text-slate-400')}>{c.prazo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lista.length > 200 && <p className="p-3 text-center text-xs text-slate-500">Mostrando os 200 primeiros de {lista.length}. Use “Exportar (CSV)” para ver todos.</p>}
            </div>
          )}
        </Card>
      </>)}

    </div>
  )
}
