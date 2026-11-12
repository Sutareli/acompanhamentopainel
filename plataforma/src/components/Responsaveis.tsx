import { useMemo, useState } from 'react'
import { aberto, agrupar, Chamado, contar, diasEmAberto, empresaDe, noPrazo, roccoDe, SEM_RESP, statusNome, respDe } from '../lib/chamados'
import { btnG, btnSm, Card, Chip, Empty, HBars, Modal } from '../components/ui'
import ParetoChart from '../components/ParetoChart'
import { download, fmtDate, todayStr, toCSV } from '../lib/rules'

const COR_EMPRESA: Record<string, string> = { Almawave: '#5b21b6', Almaviva: '#0e7490', Outros: '#d97706' }
export const corEmpresa = (n: string) => COR_EMPRESA[n] || '#64748b'
const COR_STATUS: Record<string, string> = { 'A iniciar': '#64748b', 'Em andamento': '#2563eb', Suspenso: '#d97706', Concluído: '#16a34a', Cancelado: '#94a3b8', Improcedente: '#cbd5e1' }
const corStatus = (n: string) => COR_STATUS[n] || '#8b3fff'
const lc = (s: string | null) => (s ?? '').trim().toLowerCase()

/** Barras horizontais empilhadas e clicáveis (uma linha por grupo, segmentos coloridos por série). */
function Empilhadas({ linhas, series, cor, sel, onSel, max = 8 }: { linhas: { nome: string; seg: Record<string, number> }[]; series: string[]; cor: (s: string) => string; sel: string; onSel: (n: string) => void; max?: number }) {
  const ls = linhas.slice(0, max); const tot = (l: { seg: Record<string, number> }) => series.reduce((a, s) => a + (l.seg[s] || 0), 0)
  const m = Math.max(1, ...ls.map(tot))
  if (!ls.length) return <Empty>Sem dados.</Empty>
  return (
    <div className="space-y-1.5">
      {ls.map((l) => (
        <button key={l.nome} onClick={() => onSel(sel === l.nome ? '' : l.nome)} className={'flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-sm hover:bg-violet-50 ' + (sel === l.nome ? 'bg-violet-100' : '')} title="Clique para filtrar por este item">
          <span className="w-32 shrink-0 truncate text-slate-700 sm:w-40">{l.nome}</span>
          <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
            {series.map((s) => (l.seg[s] ? <div key={s} style={{ width: (l.seg[s] / m) * 100 + '%', background: cor(s) }} title={`${s}: ${l.seg[s]}`} /> : null))}
          </div>
          <b className="w-8 text-right">{tot(l)}</b>
        </button>
      ))}
    </div>
  )
}
const Legenda = ({ itens, cor }: { itens: string[]; cor: (s: string) => string }) => (
  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">{itens.map((i) => <span key={i} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cor(i) }} />{i}</span>)}</div>
)
function Kpi({ t, v, sub, cor }: { t: string; v: string | number; sub?: string; cor?: string }) {
  return <div className="rounded-2xl border border-violet-100 bg-white p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t}</div><div className="text-2xl font-extrabold" style={{ color: cor || '#2e1a6e' }}>{v}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
}

/**
 * "Quem é responsável pelos chamados". O cartão e o detalhamento acompanham os filtros do Pareto (mês, tipo e subcategoria).
 * Abertos = A iniciar + Em andamento + Suspenso (Concluído, Cancelado e Improcedente ficam fora).
 */
export default function Responsaveis({ base, itens, filtroTxt }: { base: Chamado[]; itens: Chamado[]; filtroTxt: string }) {
  const [aberta, setAberta] = useState<string | null>(null)   // null = fechada · '' = todas as empresas · 'X' = empresa X
  const emp = useMemo(() => agrupar(itens, empresaDe), [itens])
  const semDado = base.length > 0 && base.every((c) => !c.empresa_responsavel && !c.responsavel)
  const max = Math.max(1, ...emp.map((g) => g.total))
  const totAb = emp.reduce((a, g) => a + g.abertos, 0)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-navy">Quem é responsável pelos chamados</h3>
          <p className="text-xs text-slate-500">Acompanha os filtros acima ({filtroTxt}). Abertos = A iniciar, Em andamento e Suspenso.</p>
        </div>
        <div className="flex items-center gap-3"><span className="rounded-full bg-red-50 px-3 py-1 text-sm font-bold text-red-600">{totAb} abertos</span><button className={btnG + ' ' + btnSm} onClick={() => setAberta('')}>🔎 Ver detalhamento →</button></div>
      </div>
      {semDado ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{base.length > 0 && !('empresa_responsavel' in base[0]) ? 'O banco ainda não tem as colunas de responsável: execute a migração supabase/007_responsaveis_chamados.sql no SQL Editor e depois reimporte a base (Importar bases).' : 'A base importada não tem dados de responsável. Reimporte a base (Importar bases) com o CSV que contém as colunas RESPONSÁVEL, EMPRESA RESPONSÁVEL (ou “Empresa Responsável”) e RESPONSÁVEL ROCCO. Se já fez isso, execute antes a migração 007.'}</p>
      ) : emp.length === 0 ? <div className="mt-3"><Empty>Nenhum chamado neste filtro.</Empty></div> : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {emp.map((g) => (
            <button key={g.nome} onClick={() => setAberta(g.nome)} className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-violet-300 hover:shadow-md" style={{ borderTop: `4px solid ${corEmpresa(g.nome)}` }} title="Clique para ver o detalhamento">
              <div className="flex items-baseline justify-between"><b style={{ color: corEmpresa(g.nome) }}>{g.nome}</b><span className="text-xs text-slate-500">{g.total} chamados</span></div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: (g.total / max) * 100 + '%', background: corEmpresa(g.nome) }} /></div>
              <div className="mt-3 flex items-end justify-between">
                <div><div className="text-3xl font-extrabold" style={{ color: g.abertos ? '#dc2626' : '#16a34a' }}>{g.abertos}</div><div className="text-xs text-slate-500">abertos</div></div>
                <span className="text-xs font-semibold text-violet-700">ver detalhamento →</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {aberta !== null && <Detalhe itens={itens} filtroTxt={filtroTxt} empresa0={aberta} onClose={() => setAberta(null)} />}
    </Card>
  )
}

function Detalhe({ itens, filtroTxt, empresa0, onClose }: { itens: Chamado[]; filtroTxt: string; empresa0: string; onClose: () => void }) {
  const [escopo, setEscopo] = useState<'abertos' | 'todos'>('abertos')
  const [empresa, setEmpresa] = useState(empresa0)
  const [pessoa, setPessoa] = useState('')
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState<string | null>(null)
  const hoje = todayStr()
  const nAb = useMemo(() => itens.filter(aberto).length, [itens])
  const fonte = useMemo(() => (escopo === 'abertos' ? itens.filter(aberto) : itens), [itens, escopo])
  const ref = useMemo(() => fonte.filter((c) => !empresa || empresaDe(c) === empresa), [fonte, empresa])
  // cada gráfico respeita os filtros dos outros (filtro cruzado), exceto o seu próprio
  const f = (c: Chamado, o: { pessoa?: boolean; cat?: boolean; sub?: boolean }) => (o.pessoa === false || !pessoa || roccoDe(c) === pessoa) && (o.cat === false || !cat || (c.categoria || '').trim() === cat) && (o.sub === false || !sub || lc(c.subcategoria) === lc(sub))
  const lista = useMemo(() => ref.filter((c) => f(c, {})).sort((a, b) => (aberto(b) ? 1 : 0) - (aberto(a) ? 1 : 0) || diasEmAberto(b, hoje) - diasEmAberto(a, hoje)), [ref, pessoa, cat, sub, hoje]) // eslint-disable-line react-hooks/exhaustive-deps
  const porEmp = useMemo(() => agrupar(fonte, empresaDe), [fonte])
  const empresas = porEmp.map((g) => g.nome)

  const catRows = useMemo(() => {
    const base = ref.filter((c) => f(c, { cat: false })); const m = new Map<string, Record<string, number>>()
    for (const c of base) { const k = (c.categoria || '').trim() || '(sem categoria)'; const r = m.get(k) || {}; const e = empresaDe(c); r[e] = (r[e] || 0) + 1; m.set(k, r) }
    return [...m.entries()].map(([nome, seg]) => ({ nome, seg })).sort((a, b) => Object.values(b.seg).reduce((x, y) => x + y, 0) - Object.values(a.seg).reduce((x, y) => x + y, 0))
  }, [ref, pessoa, sub]) // eslint-disable-line react-hooks/exhaustive-deps
  const subs = useMemo(() => contar(ref.filter((c) => f(c, { sub: false })), (c) => c.subcategoria), [ref, pessoa, cat]) // eslint-disable-line react-hooks/exhaustive-deps
  const STAT = ['A iniciar', 'Em andamento', 'Suspenso', 'Concluído', 'Cancelado', 'Improcedente']
  const statusDe = (c: Chamado) => { const n = statusNome(c); return STAT.find((s) => lc(s) === lc(n)) || n }
  const roccoRows = useMemo(() => {
    const base = ref.filter((c) => f(c, { pessoa: false })); const m = new Map<string, Record<string, number>>()
    for (const c of base) { const k = roccoDe(c); const r = m.get(k) || {}; const s = statusDe(c); r[s] = (r[s] || 0) + 1; m.set(k, r) }
    return [...m.entries()].map(([nome, seg]) => ({ nome, seg })).sort((a, b) => Object.values(b.seg).reduce((x, y) => x + y, 0) - Object.values(a.seg).reduce((x, y) => x + y, 0))
  }, [ref, cat, sub]) // eslint-disable-line react-hooks/exhaustive-deps
  const statusSeries = STAT.filter((s) => roccoRows.some((r) => r.seg[s]))
  const fases = useMemo(() => agrupar(lista, (c) => (c.fase || '').trim() || '(sem fase)').map((g) => ({ label: g.nome, value: g.total, color: '#8b3fff' })), [lista])
  const idade = useMemo(() => {
    const ab = lista.filter(aberto); const b = [['Até 7 dias', 0, 7], ['8 a 30 dias', 8, 30], ['31 a 90 dias', 31, 90], ['Mais de 90 dias', 91, 1e9]] as [string, number, number][]
    return b.map(([label, lo, hi]) => ({ label, value: ab.filter((c) => { const d = diasEmAberto(c, hoje); return d >= lo && d <= hi }).length, color: lo > 30 ? '#dc2626' : lo > 7 ? '#d97706' : '#16a34a' }))
  }, [lista, hoje])
  const abL = lista.filter(aberto); const comPrazo = lista.filter((c) => c.prazo)
  const idadeMed = abL.length ? Math.round(abL.reduce((a, c) => a + diasEmAberto(c, hoje), 0) / abL.length) : null
  const limpa = () => { setPessoa(''); setCat(''); setSub(null) }
  const temFiltro = !!(pessoa || cat || sub)
  const tabCls = (on: boolean) => 'px-3 py-1.5 text-sm font-semibold ' + (on ? 'bg-navy text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
  const exporta = () => download(`chamados-responsaveis-${escopo}-${hoje}.csv`, toCSV([
    ['ID', 'Data', 'Dias desde a abertura', 'Item - sintoma', 'Cliente', 'Categoria', 'Subcategoria', 'Status', 'Fase', 'Empresa responsável', 'Responsável', 'Responsável ROCCO', 'Prazo'],
    ...lista.map((c) => [c.id_chamado, fmtDate(c.data_identificacao || c.data_ref), diasEmAberto(c, hoje), c.item_sintoma, c.cliente, c.categoria, c.subcategoria, statusNome(c), c.fase, empresaDe(c), respDe(c), roccoDe(c), c.prazo]),
  ]))
  return (
    <Modal title="Quem é responsável pelos chamados" onClose={onClose} xl>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="tablist" aria-label="Escopo">
            <button role="tab" aria-selected={escopo === 'abertos'} className={tabCls(escopo === 'abertos')} onClick={() => setEscopo('abertos')}>Abertos ({nAb})</button>
            <button role="tab" aria-selected={escopo === 'todos'} className={tabCls(escopo === 'todos')} onClick={() => setEscopo('todos')}>Todos do filtro ({itens.length})</button>
          </div>
          <span className="text-xs text-slate-500">Filtro do Pareto: {filtroTxt}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2" role="group" aria-label="Empresa">
            <span className="text-xs font-bold uppercase text-slate-500">Empresa</span>
            <button className={'rounded-full border px-3 py-1 text-xs font-semibold ' + (!empresa ? 'border-navy bg-navy text-white' : 'border-violet-300 text-navy hover:bg-violet-50')} onClick={() => setEmpresa('')}>Todas</button>
            {empresas.map((n) => <button key={n} className={'rounded-full border px-3 py-1 text-xs font-semibold ' + (empresa === n ? 'text-white' : 'bg-white hover:bg-violet-50')} style={{ borderColor: corEmpresa(n), background: empresa === n ? corEmpresa(n) : undefined, color: empresa === n ? undefined : corEmpresa(n) }} onClick={() => setEmpresa(empresa === n ? '' : n)}>{n}</button>)}
          </div>
        </div>

        {fonte.length === 0 ? <Empty>Nenhum chamado neste escopo.</Empty> : (<>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi t="Chamados" v={lista.length} sub={escopo === 'abertos' ? 'abertos' : 'no filtro'} />
            <Kpi t="Abertos" v={abL.length} cor={abL.length ? '#dc2626' : '#16a34a'} sub={lista.length ? Math.round((abL.length / lista.length) * 100) + '% do total' : ''} />
            <Kpi t="No prazo" v={comPrazo.length ? Math.round((comPrazo.filter(noPrazo).length / comPrazo.length) * 100) + '%' : '—'} sub={comPrazo.length ? `${comPrazo.filter(noPrazo).length} de ${comPrazo.length} com prazo` : 'sem dados de prazo'} />
            <Kpi t="Idade média dos abertos" v={idadeMed === null ? '—' : idadeMed + ' d'} />
            <Kpi t="Mais antigo aberto" v={abL.length ? Math.max(...abL.map((c) => diasEmAberto(c, hoje))) + ' d' : '—'} />
          </div>
          {temFiltro && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold uppercase text-slate-500">Filtros do detalhamento:</span>{pessoa && <Chip color="#5b21b6">{pessoa}</Chip>}{cat && <Chip color="#0e7490">{cat}</Chip>}{sub && <Chip color="#d97706">{sub}</Chip>}<button className="font-semibold text-violet-700 underline" onClick={limpa}>limpar</button></div>}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 p-4" aria-label="Categoria por empresa">
              <h4 className="font-bold text-navy">Categoria × empresa responsável</h4>
              <p className="mb-2 text-xs text-slate-500">Clique em uma categoria para cruzar os demais gráficos.</p>
              <Empilhadas linhas={catRows} series={empresas} cor={corEmpresa} sel={cat} onSel={(n) => { setCat(n); setSub(null) }} />
              <Legenda itens={empresas} cor={corEmpresa} />
            </section>
            <section className="rounded-2xl border border-slate-200 p-4" aria-label="Responsável ROCCO por status">
              <h4 className="font-bold text-navy">Responsável ROCCO × status</h4>
              <p className="mb-2 text-xs text-slate-500">Quem está com cada chamado. Clique em uma pessoa para filtrar.</p>
              <Empilhadas linhas={roccoRows} series={statusSeries} cor={corStatus} sel={pessoa} onSel={setPessoa} max={10} />
              <Legenda itens={statusSeries} cor={corStatus} />
            </section>
            <section className="rounded-2xl border border-slate-200 p-4 lg:col-span-2" aria-label="Pareto de subcategoria">
              <h4 className="font-bold text-navy">Subcategoria (Pareto)</h4>
              <p className="mb-1 text-xs text-slate-500">Clique em uma barra para listar os chamados dessa subcategoria.{subs.vazios > 0 && ` ${subs.vazios} chamado(s) sem subcategoria não entram.`}</p>
              <ParetoChart barras={subs.barras} titulo="Pareto por subcategoria (detalhamento)" selecionado={sub} onSelect={setSub} />
            </section>
            <section className="rounded-2xl border border-slate-200 p-4" aria-label="Idade dos abertos">
              <h4 className="font-bold text-navy">Idade dos chamados abertos</h4>
              <p className="mb-2 text-xs text-slate-500">Dias desde a abertura até hoje.</p>
              <HBars rows={idade} empty="Nenhum chamado aberto neste recorte." />
            </section>
            <section className="rounded-2xl border border-slate-200 p-4" aria-label="Fase">
              <h4 className="font-bold text-navy">Fase do chamado</h4>
              <p className="mb-2 text-xs text-slate-500">Em que etapa do fluxo os chamados estão.</p>
              <HBars rows={fases.slice(0, 8)} empty="Sem fase informada." />
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold text-navy">Chamados <span className="text-sm font-normal text-slate-500">({lista.length})</span></h4>
            <button className={btnG + ' ' + btnSm} onClick={exporta} disabled={!lista.length}>⬇ Exportar (CSV)</button>
          </div>
          <div className="max-h-[340px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[980px] text-left text-sm [&_th]:pr-2">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">ID</th><th>Aberto em</th><th>Dias</th><th>Item / sintoma</th><th>Cliente</th><th>Categoria</th><th>Status</th><th>Fase</th><th>Empresa</th><th>Resp. ROCCO</th></tr></thead>
              <tbody>
                {lista.slice(0, 300).map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 text-slate-500">{c.id_chamado || '—'}</td>
                    <td className="whitespace-nowrap py-2 pr-2">{fmtDate(c.data_identificacao || c.data_ref)}</td>
                    <td className={'py-2 pr-2 font-semibold ' + (aberto(c) && diasEmAberto(c, hoje) > 30 ? 'text-red-600' : 'text-slate-600')}>{aberto(c) ? diasEmAberto(c, hoje) : '—'}</td>
                    <td className="max-w-[300px] py-2 pr-2 font-medium text-navy">{c.item_sintoma || '—'}</td>
                    <td className="py-2 pr-2">{c.cliente || '—'}</td>
                    <td className="py-2 pr-2">{c.categoria || '—'}</td>
                    <td className="py-2 pr-2"><Chip color={corStatus(statusDe(c))}>{statusNome(c)}</Chip></td>
                    <td className="py-2 pr-2">{c.fase || '—'}</td>
                    <td className="py-2 pr-2"><span className="font-semibold" style={{ color: corEmpresa(empresaDe(c)) }}>{empresaDe(c)}</span>{respDe(c) !== empresaDe(c) && respDe(c) !== SEM_RESP && <div className="text-xs text-slate-500">{respDe(c)}</div>}</td>
                    <td className="py-2 pr-2">{roccoDe(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lista.length > 300 && <p className="p-3 text-center text-xs text-slate-500">Mostrando os 300 primeiros de {lista.length}. Use “Exportar (CSV)” para ver todos.</p>}
          </div>
        </>)}
      </div>
    </Modal>
  )
}
