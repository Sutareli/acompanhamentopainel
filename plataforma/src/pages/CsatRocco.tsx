import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, download, fmtDate, fmtDateTime, toCSV } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Empty, Msg, inp } from '../components/ui'
import { agrupar, CsatResp, fmtPct, Grupo, kpis, Kpis, mesDe, QuadroRow, Visao, VISAO_LABEL, VISAO_SUB } from '../lib/csat'
import { MESES } from '../lib/chamados'

/** C-SAT Rocco — dashboard da pesquisa de satisfação da ferramenta Rocco (visões Performance e Executiva).
 *  Leitura: Diretor, Gerente e Analista Sr. A base é atualizada em Importar bases (acumulativa). */
type Linha = CsatResp & { nome: string | null; supervisor: string | null; coordenador: string | null; site: string | null; operacao: string | null; noQuadro: boolean }
type Aba = 'geral' | Visao

const COR_NOTA = ['', '#dc2626', '#f97316', '#94a3b8', '#4ade80', '#16a34a']   // 1–2 insatisfeito · 3 neutro · 4–5 satisfeito (sempre com rótulo)
const COR_VISAO: Record<Visao, string> = { performance: '#4f46b5', executiva: '#0e7490' }
const mesLabel = (k: string) => `${MESES[+k.slice(5, 7) - 1]}/${k.slice(2, 4)}`
const mesAnt = (k: string) => { const y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
const chip = (on: boolean) => 'rounded-md border px-3 py-1 text-xs font-medium transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')
const num = (n: number) => n.toLocaleString('pt-BR')

async function buscarTudo<T>(tabela: string, campos: string, ordem: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const r = await supabase.from(tabela).select(campos).order(ordem, { ascending: true }).range(from, from + 999)
    if (r.error) throw new Error(r.error.message)
    out.push(...((r.data || []) as unknown as T[])); if (!r.data || r.data.length < 1000) break
  }
  return out
}

export default function CsatRocco({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carga, setCarga] = useState<{ em: string; arquivo: string | null } | null>(null)
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('')
  const [aba, setAba] = useState<Aba>('geral')
  const [mes, setMes] = useState<string | null>(null)   // null = mais recente · '' = todos
  const [site, setSite] = useState(''); const [sup, setSup] = useState(''); const [coord, setCoord] = useState(''); const [perg, setPerg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [rs, qd, c] = await Promise.all([
          buscarTudo<CsatResp>('csat_respostas', 'id,visao,data,usuario,pergunta,nota,comentario', 'id'),
          buscarTudo<QuadroRow>('csat_quadro', 'almope,nome,supervisor,coordenador,gerente,site,cargo,operacao', 'almope'),
          supabase.from('csat_cargas').select('em,arquivo').eq('tipo', 'respostas').order('em', { ascending: false }).limit(1),
        ])
        const q = new Map<string, QuadroRow>((qd as QuadroRow[]).map((x): [string, QuadroRow] => [x.almope, x]))
        setLinhas((rs as CsatResp[]).map((r): Linha => { const h = r.usuario ? q.get(r.usuario.trim().toLowerCase()) : undefined; return { ...r, nome: h?.nome ?? null, supervisor: h?.supervisor ?? null, coordenador: h?.coordenador ?? null, site: h?.site ?? null, operacao: h?.operacao ?? null, noQuadro: !!h } }))
        setCarga(c.data?.[0] ?? null)
      } catch (e) {
        const m = (e as Error).message
        setErr(/csat_/.test(m) && /exist|schema/i.test(m) ? 'O módulo ainda não foi instalado no banco: execute a migração supabase/040_csat_rocco.sql no SQL Editor do Supabase.' : m)
      }
      setLoading(false)
    })()
  }, [])

  const meses = useMemo(() => [...new Set(linhas.map((r) => mesDe(r.data)))].sort().reverse(), [linhas])
  const mesSel = mes === null ? meses[0] ?? '' : mes
  // filtros de dimensão (valem para tudo); o mês vale para os cards e quebras, a evolução mensal mostra todos os meses
  const porVisao = useMemo(() => linhas.filter((r) => aba === 'geral' || r.visao === aba), [linhas, aba])
  const opcoes = (f: (r: Linha) => string | null) => [...new Set(porVisao.map(f).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const dim = useMemo(() => porVisao.filter((r) => (!site || r.site === site) && (!sup || r.supervisor === sup) && (!coord || r.coordenador === coord) && (!perg || (r.pergunta ?? '') === perg)), [porVisao, site, sup, coord, perg])
  const doMes = useMemo(() => (mesSel ? dim.filter((r) => mesDe(r.data) === mesSel) : dim), [dim, mesSel])
  const anterior = useMemo(() => (mesSel ? dim.filter((r) => mesDe(r.data) === mesAnt(mesSel)) : []), [dim, mesSel])
  const k = kpis(doMes), kAnt = mesSel && anterior.length ? kpis(anterior) : null
  const semQuadro = useMemo(() => new Set(doMes.filter((r) => r.usuario && !r.noQuadro).map((r) => r.usuario!.toLowerCase())).size, [doMes])
  const filtrosAtivos = !!(site || sup || coord || perg)

  if (loading) return <p className="text-slate-500">Carregando C-SAT…</p>
  const admin = canAdmin(profile?.perfil)

  function baixar() {
    download(`csat-rocco${mesSel ? '-' + mesSel : ''}.csv`, toCSV([
      ['Visão', 'Data', 'Usuário', 'Nome', 'Supervisor', 'Coordenador', 'Site', 'Pergunta', 'Nota', 'Comentário'],
      ...doMes.map((r) => [VISAO_LABEL[r.visao], fmtDate(r.data), r.usuario, r.nome, r.supervisor, r.coordenador, r.site, r.pergunta, r.nota, r.comentario]),
    ]))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">C-SAT Rocco</h1>
          <p className="text-sm text-slate-500">Pesquisa de satisfação da ferramenta Rocco · C-SAT = (notas 4 + notas 5) ÷ total de respostas{carga ? ` · última carga em ${fmtDateTime(carga.em)}` : ''}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnG + ' ' + btnSm} onClick={baixar} disabled={!doMes.length}>Baixar CSV</button>
          {admin && <button className={btnP + ' ' + btnSm} onClick={() => onNavigate('importar')}>Atualizar base →</button>}
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {!err && !linhas.length && <Empty>Nenhuma resposta carregada ainda. {admin ? 'Envie a exportação de C-SAT do Rocco em Importar bases → “C-SAT Rocco — respostas da pesquisa”.' : 'O Analista Sr carrega a base em Importar bases.'}</Empty>}

      {linhas.length > 0 && <>
        <div className="flex flex-wrap gap-1 border-b border-linha" role="tablist">
          {(['geral', 'performance', 'executiva'] as Aba[]).map((a) => (
            <button key={a} role="tab" aria-selected={aba === a} onClick={() => { setAba(a); setSite(''); setSup(''); setCoord(''); setPerg('') }}
              className={'-mb-px border-b-2 px-4 py-2 text-sm ' + (aba === a ? 'border-turq font-semibold text-ink' : 'border-transparent text-slate-500 hover:text-ink')}>
              {a === 'geral' ? 'Visão geral' : VISAO_LABEL[a]}{a !== 'geral' && <span className="ml-1 hidden text-xs font-normal text-slate-400 sm:inline">({VISAO_SUB[a]})</span>}
            </button>
          ))}
        </div>

        <Card className="!p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Sel label="Mês" valor={mesSel} onChange={(v) => setMes(v)} opcoes={meses.map((m) => [m, mesLabel(m)])} todos="Todo o período" />
            <Sel label="Site" valor={site} onChange={setSite} opcoes={opcoes((r) => r.site).map((x) => [x, x])} />
            <Sel label="Coordenador" valor={coord} onChange={setCoord} opcoes={opcoes((r) => r.coordenador).map((x) => [x, x])} />
            <Sel label="Supervisor" valor={sup} onChange={setSup} opcoes={opcoes((r) => r.supervisor).map((x) => [x, x])} />
            <Sel label="Pergunta" valor={perg} onChange={setPerg} opcoes={opcoes((r) => r.pergunta).map((x) => [x, x])} />
          </div>
          {filtrosAtivos && <button className="mt-2 text-xs text-violet-700 underline" onClick={() => { setSite(''); setSup(''); setCoord(''); setPerg('') }}>Limpar filtros</button>}
        </Card>

        {semQuadro > 0 && <Msg kind="aviso">{semQuadro} usuário(s) deste recorte não estão no QUADRO: aparecem sem nome, site e supervisor. {admin && 'Atualize o QUADRO em Importar bases.'}</Msg>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div className="col-span-2 rounded-md border border-violet-100 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">C-SAT {mesSel ? mesLabel(mesSel) : 'do período'}{aba !== 'geral' ? ' · ' + VISAO_LABEL[aba] : ''}</div>
            <div className="mt-1 text-4xl font-bold text-navy">{fmtPct(k.csat)}</div>
            <Delta atual={k.csat} ant={kAnt?.csat ?? null} />
          </div>
          <Tile titulo="Respostas" valor={num(k.total)} sub={kAnt ? `mês anterior: ${num(kAnt.total)}` : undefined} />
          <Tile titulo="Satisfeitos (4–5)" valor={num(k.satisfeitos)} sub={fmtPct(k.total ? (k.satisfeitos / k.total) * 100 : null)} />
          <Tile titulo="Neutros (3)" valor={num(k.neutros)} sub={fmtPct(k.total ? (k.neutros / k.total) * 100 : null)} />
          <Tile titulo="Insatisfeitos (1–2)" valor={num(k.insatisfeitos)} sub={fmtPct(k.total ? (k.insatisfeitos / k.total) * 100 : null)} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Tile titulo="Nota média" valor={k.media === null ? '—' : k.media.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} sub="escala de 1 a 5" />
          <Tile titulo="Respondentes" valor={num(new Set(doMes.map((r) => (r.usuario ?? '').toLowerCase()).filter(Boolean)).size)} sub="usuários distintos" />
          <div className="col-span-2 rounded-md border border-violet-100 bg-white p-4 lg:col-span-4">
            <div className="text-xs font-semibold text-slate-500">Distribuição das notas</div>
            <Distribuicao k={k} />
          </div>
        </div>

        {aba === 'geral' && (
          <div className="grid gap-3 md:grid-cols-2">
            {(['performance', 'executiva'] as Visao[]).map((v) => { const kv = kpis(doMes.filter((r) => r.visao === v)); const ka = kpis(anterior.filter((r) => r.visao === v)); return (
              <Card key={v} className="!p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="flex items-center gap-2 font-semibold text-ink"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: COR_VISAO[v] }} />{VISAO_LABEL[v]}</div><div className="text-xs text-slate-500">{VISAO_SUB[v]}</div></div>
                  <button className="text-xs text-violet-700 underline" onClick={() => setAba(v)}>Abrir visão →</button>
                </div>
                <div className="mt-2 flex items-end gap-4">
                  <div className="text-3xl font-bold text-navy">{fmtPct(kv.csat)}</div>
                  <div className="pb-1 text-xs text-slate-500">{num(kv.total)} resposta(s) · média {kv.media?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) ?? '—'}</div>
                </div>
                <Delta atual={kv.csat} ant={ka.total ? ka.csat : null} />
                <div className="mt-2"><Distribuicao k={kv} compacto /></div>
              </Card>) })}
          </div>
        )}

        <Card>
          <h2 className="font-semibold text-ink">Evolução mensal do C-SAT</h2>
          <p className="text-xs text-slate-500">Todos os meses do histórico, com os filtros de site, coordenador, supervisor e pergunta. Passe o mouse para ver as respostas.</p>
          <Evolucao rows={dim} geral={aba === 'geral'} />
        </Card>

        {mesSel && (
          <Card>
            <h2 className="font-semibold text-ink">C-SAT por dia — {mesLabel(mesSel)}</h2>
            <PorDia rows={doMes} mes={mesSel} />
          </Card>
        )}

        <div className="grid gap-3 xl:grid-cols-2">
          <Card><h2 className="mb-2 font-semibold text-ink">C-SAT por pergunta</h2><TabelaGrupos grupos={agrupar(doMes, (r) => r.pergunta, '(sem pergunta)')} rotulo="Pergunta" /></Card>
          <Card><h2 className="mb-2 font-semibold text-ink">C-SAT por site</h2><TabelaGrupos grupos={agrupar(doMes, (r) => r.site)} rotulo="Site" usuarios /></Card>
          <Card><h2 className="mb-2 font-semibold text-ink">C-SAT por coordenador</h2><TabelaGrupos grupos={agrupar(doMes, (r) => r.coordenador)} rotulo="Coordenador" usuarios /></Card>
          <Card><h2 className="mb-2 font-semibold text-ink">C-SAT por supervisor</h2><TabelaGrupos grupos={agrupar(doMes, (r) => r.supervisor)} rotulo="Supervisor" usuarios /></Card>
        </div>

        <Card><h2 className="mb-2 font-semibold text-ink">Usuários</h2><Usuarios rows={doMes} /></Card>
        <Card><h2 className="mb-2 font-semibold text-ink">Comentários</h2><Comentarios rows={doMes} /></Card>
      </>}
    </div>
  )
}

function Sel({ label, valor, onChange, opcoes, todos = 'Todos' }: { label: string; valor: string; onChange: (v: string) => void; opcoes: [string, string][]; todos?: string }) {
  return (
    <label className="block text-xs font-semibold text-slate-600">{label}
      <select className={inp + ' mt-1 !py-1.5'} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">{todos}</option>
        {opcoes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
function Tile({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return <div className="rounded-md border border-violet-100 bg-white p-4"><div className="text-xs font-semibold text-slate-500">{titulo}</div><div className="mt-1 text-2xl font-bold text-navy">{valor}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
}
function Delta({ atual, ant }: { atual: number | null; ant: number | null }) {
  if (atual === null || ant === null) return <div className="mt-1 text-xs text-slate-400">sem mês anterior para comparar</div>
  const d = atual - ant
  return <div className="mt-1 text-xs text-slate-500">vs mês anterior ({fmtPct(ant)}) <b className={d > 0 ? 'text-green-700' : d < 0 ? 'text-red-600' : 'text-slate-500'}>{d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}{d.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} p.p.</b></div>
}
function Distribuicao({ k, compacto }: { k: Kpis; compacto?: boolean }) {
  if (!k.total) return <p className="mt-2 text-xs text-slate-400">Sem respostas.</p>
  const notas = [1, 2, 3, 4, 5] as const
  const q = (n: number) => (k as unknown as Record<string, number>)['n' + n]
  return (
    <div className="mt-2">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded">
        {notas.map((n) => q(n) > 0 && <div key={n} title={`Nota ${n}: ${q(n)} (${fmtPct((q(n) / k.total) * 100)})`} style={{ width: (q(n) / k.total) * 100 + '%', background: COR_NOTA[n] }} />)}
      </div>
      <div className={'mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-600 ' + (compacto ? 'text-[11px]' : 'text-xs')}>
        {notas.map((n) => <span key={n} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_NOTA[n] }} />Nota {n}: <b>{num(q(n))}</b> ({fmtPct((q(n) / k.total) * 100, 0)})</span>)}
      </div>
    </div>
  )
}

/** Barras verticais de C-SAT (%) por mês; na visão geral, duas barras por mês (Performance e Executiva) com legenda. Eixo único 0–100%. */
function Evolucao({ rows, geral }: { rows: Linha[]; geral: boolean }) {
  const meses = [...new Set(rows.map((r) => mesDe(r.data)))].sort()
  if (!meses.length) return <Empty>Sem respostas para os filtros escolhidos.</Empty>
  const series: { nome: string; cor: string; f: (r: Linha) => boolean }[] = geral
    ? [{ nome: 'Performance', cor: COR_VISAO.performance, f: (r) => r.visao === 'performance' }, { nome: 'Executiva', cor: COR_VISAO.executiva, f: (r) => r.visao === 'executiva' }]
    : [{ nome: 'C-SAT', cor: '#4f46b5', f: () => true }]
  return (
    <div>
      {geral && <div className="mt-2 flex gap-4 text-xs text-slate-600">{series.map((s) => <span key={s.nome} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />{s.nome}</span>)}</div>}
      <div className="relative mt-2 flex h-52 items-end gap-3 overflow-x-auto border-b border-slate-200 pt-6">
        {meses.map((m) => (
          <div key={m} className="flex h-full min-w-[56px] flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-[2px]">
              {series.map((s) => { const kk = kpis(rows.filter((r) => mesDe(r.data) === m && s.f(r))); return (
                <div key={s.nome} className="flex h-full w-full max-w-[34px] flex-col items-center justify-end" title={`${s.nome} · ${mesLabel(m)}: ${fmtPct(kk.csat)} (${kk.satisfeitos} de ${kk.total} respostas)`}>
                  <span className="mb-0.5 text-[10px] text-slate-600">{kk.csat === null ? '—' : Math.round(kk.csat) + '%'}</span>
                  <div className="w-full rounded-t" style={{ height: kk.csat === null ? 2 : Math.max(2, kk.csat) + '%', background: kk.csat === null ? '#e2e8f0' : s.cor }} />
                </div>) })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 overflow-x-auto">{meses.map((m) => <div key={m} className="min-w-[56px] flex-1 pt-1 text-center text-[11px] text-slate-500">{mesLabel(m)}</div>)}</div>
    </div>
  )
}
function PorDia({ rows, mes }: { rows: Linha[]; mes: string }) {
  const dim = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate()
  const dias = Array.from({ length: dim }, (_, i) => { const d = `${mes}-${String(i + 1).padStart(2, '0')}`; return { d, k: kpis(rows.filter((r) => r.data === d)) } })
  if (!rows.length) return <Empty>Sem respostas neste mês.</Empty>
  return (
    <div className="mt-2 flex h-44 items-end gap-[2px] overflow-x-auto border-b border-slate-200 pt-5">
      {dias.map(({ d, k }) => (
        <div key={d} className="flex h-full min-w-[20px] flex-1 flex-col items-center justify-end text-[10px] text-slate-500" title={`${fmtDate(d)}: ${k.total ? `${fmtPct(k.csat)} (${k.satisfeitos} de ${k.total})` : 'sem respostas'}`}>
          <span>{k.csat === null ? '' : Math.round(k.csat)}</span>
          <div className="w-full rounded-t" style={{ height: k.csat === null ? 2 : Math.max(2, k.csat) + '%', background: k.csat === null ? '#e2e8f0' : '#4f46b5' }} />
          <span className="mt-1">{+d.slice(8)}</span>
        </div>
      ))}
    </div>
  )
}

function TabelaGrupos({ grupos, rotulo, usuarios }: { grupos: Grupo[]; rotulo: string; usuarios?: boolean }) {
  const [ord, setOrd] = useState<'total' | 'csat'>('total'); const [mais, setMais] = useState(false)
  if (!grupos.length) return <Empty>Sem respostas.</Empty>
  const L = [...grupos].sort((a, b) => (ord === 'csat' ? (a.k.csat ?? 999) - (b.k.csat ?? 999) : 0) || b.k.total - a.k.total)
  const vis = mais ? L : L.slice(0, 10)
  return (
    <div>
      <div className="mb-2 flex gap-1 text-xs"><span className="py-1 text-slate-500">Ordenar:</span><button className={chip(ord === 'total')} onClick={() => setOrd('total')}>mais respostas</button><button className={chip(ord === 'csat')} onClick={() => setOrd('csat')}>menor C-SAT</button></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-linha text-left text-xs text-slate-500"><th className="py-1 pr-2">{rotulo}</th>{usuarios && <th className="px-2 text-right">Usuários</th>}<th className="px-2 text-right">Respostas</th><th className="px-2 text-right">Insatisf.</th><th className="w-40 px-2">C-SAT</th></tr></thead>
          <tbody>
            {vis.map((g) => (
              <tr key={g.nome} className="border-b border-slate-100">
                <td className="max-w-[260px] truncate py-1.5 pr-2" title={g.nome}>{g.nome}</td>
                {usuarios && <td className="px-2 text-right">{g.usuarios}</td>}
                <td className="px-2 text-right">{num(g.k.total)}</td>
                <td className="px-2 text-right">{g.k.insatisfeitos}</td>
                <td className="px-2"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-turq" style={{ width: (g.k.csat ?? 0) + '%' }} /></div><b className="w-12 text-right">{fmtPct(g.k.csat)}</b></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {L.length > 10 && <button className="mt-2 text-xs text-violet-700 underline" onClick={() => setMais(!mais)}>{mais ? 'Mostrar menos' : `Ver todos (${L.length})`}</button>}
    </div>
  )
}

function Usuarios({ rows }: { rows: Linha[] }) {
  const [busca, setBusca] = useState(''); const [ord, setOrd] = useState<'csat' | 'total'>('csat'); const [mais, setMais] = useState(false)
  const L = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const r of rows) { const u = (r.usuario ?? '(sem usuário)').toLowerCase(); const a = m.get(u); if (a) a.push(r); else m.set(u, [r]) }
    return [...m.entries()].map(([u, it]) => ({ u, nome: it[0].nome, sup: it[0].supervisor, site: it[0].site, k: kpis(it) }))
  }, [rows])
  const b = busca.trim().toLowerCase()
  const F = L.filter((x) => !b || [x.u, x.nome, x.sup, x.site].some((v) => (v ?? '').toLowerCase().includes(b))).sort((a, c) => (ord === 'csat' ? (a.k.csat ?? 999) - (c.k.csat ?? 999) || c.k.total - a.k.total : c.k.total - a.k.total))
  if (!L.length) return <Empty>Sem respostas.</Empty>
  const vis = mais ? F : F.slice(0, 15)
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input className={inp + ' max-w-xs !py-1.5'} placeholder="Buscar usuário, nome, supervisor ou site" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className={chip(ord === 'csat')} onClick={() => setOrd('csat')}>menor C-SAT</button><button className={chip(ord === 'total')} onClick={() => setOrd('total')}>mais respostas</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-linha text-left text-xs text-slate-500"><th className="py-1 pr-2">Usuário</th><th className="px-2">Nome</th><th className="px-2">Supervisor</th><th className="px-2">Site</th><th className="px-2 text-right">Respostas</th><th className="px-2 text-right">Média</th><th className="px-2 text-right">C-SAT</th></tr></thead>
          <tbody>{vis.map((x) => (
            <tr key={x.u} className="border-b border-slate-100"><td className="py-1.5 pr-2 font-mono text-xs">{x.u}</td><td className="px-2">{x.nome ?? <span className="text-slate-400">fora do QUADRO</span>}</td><td className="px-2">{x.sup ?? '—'}</td><td className="px-2">{x.site ?? '—'}</td><td className="px-2 text-right">{x.k.total}</td><td className="px-2 text-right">{x.k.media?.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</td><td className="px-2 text-right font-semibold">{fmtPct(x.k.csat)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {F.length > 15 && <button className="mt-2 text-xs text-violet-700 underline" onClick={() => setMais(!mais)}>{mais ? 'Mostrar menos' : `Ver todos (${F.length})`}</button>}
    </div>
  )
}

function Comentarios({ rows }: { rows: Linha[] }) {
  const [f, setF] = useState<'todos' | 'ins' | 'neu' | 'sat'>('ins'); const [n, setN] = useState(30)
  const com = rows.filter((r) => r.comentario && r.comentario.trim().length > 1)
  const F = com.filter((r) => f === 'todos' || (f === 'ins' ? r.nota <= 2 : f === 'neu' ? r.nota === 3 : r.nota >= 4)).sort((a, b) => b.data.localeCompare(a.data))
  if (!com.length) return <Empty>Nenhum comentário neste recorte.</Empty>
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {([['ins', 'Insatisfeitos (1–2)'], ['neu', 'Neutros (3)'], ['sat', 'Satisfeitos (4–5)'], ['todos', 'Todos']] as const).map(([k, l]) => <button key={k} className={chip(f === k)} onClick={() => { setF(k); setN(30) }}>{l} · {com.filter((r) => k === 'todos' || (k === 'ins' ? r.nota <= 2 : k === 'neu' ? r.nota === 3 : r.nota >= 4)).length}</button>)}
      </div>
      {!F.length ? <Empty>Nenhum comentário nesta faixa.</Empty> : (
        <ul className="space-y-2">
          {F.slice(0, n).map((r, i) => (
            <li key={r.id ?? i} className="rounded-md border border-slate-100 p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className={'rounded px-1.5 py-0.5 font-semibold ' + (r.nota === 3 || r.nota === 4 ? 'text-ink' : 'text-white')} style={{ background: COR_NOTA[r.nota] }}>Nota {r.nota}</span>
                <span>{fmtDate(r.data)}</span><span>· {VISAO_LABEL[r.visao]}</span>
                <span>· {r.nome ?? r.usuario ?? 'sem usuário'}{r.site ? ` · ${r.site}` : ''}</span>
                {r.pergunta && <span className="truncate">· {r.pergunta}</span>}
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{r.comentario}</p>
            </li>
          ))}
        </ul>
      )}
      {F.length > n && <button className={btnG + ' ' + btnSm + ' mt-2'} onClick={() => setN(n + 50)}>Ver mais ({F.length - n} restantes)</button>}
    </div>
  )
}
