import { useMemo, useState } from 'react'
import { btnG, btnP, btnSm, Card, inp } from './ui'
import { Chamado, kpis, mesAnterior, mesKey, mesLabel } from '../lib/chamados'
import { download, toCSV, todayStr } from '../lib/rules'
import { compara, fatorPeriodo, naPeriodo, Per } from '../lib/comparativo'

/** Mês atual × mês anterior: veredito rápido (melhorou / piorou) + o que mais subiu e o que mais caiu. Menos chamados = melhor; mais % no prazo = melhor. */
type Dim = 'subcategoria' | 'tipo' | 'categoria'
const DIMS: [Dim, string][] = [['subcategoria', 'Subcategoria'], ['tipo', 'Tipo'], ['categoria', 'Categoria']]
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
const chip = (on: boolean) => 'rounded-md border px-3 py-1 text-xs font-medium transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')

function Metrica({ titulo, ant, atu, delta, bom }: { titulo: string; ant: string; atu: string; delta: string; bom: boolean | null }) {
  const cor = bom === null ? 'text-slate-500' : bom ? 'text-green-700' : 'text-red-600'
  return (
    <div className="rounded-xl bg-white/80 px-3 py-2">
      <div className="text-[11px] font-semibold text-slate-500">{titulo}</div>
      <div className="text-sm text-slate-600">{ant} → <b className="text-lg text-navy">{atu}</b></div>
      <div className={'text-xs font-bold ' + cor}>{delta}</div>
    </div>
  )
}

const naPer = (c: Chamado, p: Per) => naPeriodo(c.data_ref, p)
const perTxt = (p: Per) => (p === 'mes' ? 'mês completo' : p === 'q1' ? '1ª quinzena (dias 1–15)' : p === 'q2' ? '2ª quinzena (dia 16 em diante)' : `dias 1 a ${p.slice(3)}`)
const sel = 'rounded-lg border border-violet-300 bg-white px-2 py-1 text-sm text-navy'

export interface Metas { meta_total_mes: number | null; meta_pct_prazo: number | null }

export default function ComparativoChamados({ rows, meses, mesInicial, filtroTxt, metas, podeMetas, onSalvarMetas }: { rows: Chamado[]; meses: string[]; mesInicial: string; filtroTxt: string; metas: Metas; podeMetas: boolean; onSalvarMetas: (m: Metas) => Promise<string | null> }) {
  const hoje = todayStr()
  const correnteA = mesInicial === hoje.slice(0, 7)
  const [dim, setDim] = useState<Dim>('subcategoria')
  const [mesA, setMesA] = useState(mesInicial)
  const [perA, setPerA] = useState<Per>(correnteA ? `ate${+hoje.slice(8, 10)}` as Per : 'mes')
  const [mesB, setMesB] = useState(mesAnterior(mesInicial))
  const [perB, setPerB] = useState<Per>(correnteA ? `ate${+hoje.slice(8, 10)}` as Per : 'mes')
  const opcoes = useMemo(() => [...new Set([...meses, mesA, mesB])].sort(), [meses, mesA, mesB])
  const rotuloA = `${mesLabel(mesA)} · ${perTxt(perA)}`, rotuloB = `${mesLabel(mesB)} · ${perTxt(perB)}`
  const atual = useMemo(() => rows.filter((c) => mesKey(c.data_ref) === mesA && naPer(c, perA)), [rows, mesA, perA])
  const anterior = useMemo(() => rows.filter((c) => mesKey(c.data_ref) === mesB && naPer(c, perB)), [rows, mesB, perB])
  const mesAtual = rotuloA, mesAnt = rotuloB
  const a = useMemo(() => kpis(atual), [atual])
  const b = useMemo(() => kpis(anterior), [anterior])
  const dHoje = +hoje.slice(8, 10)
  const [editMeta, setEditMeta] = useState(false)
  const [mt, setMt] = useState(''); const [mp, setMp] = useState(''); const [msgMeta, setMsgMeta] = useState('')
  const abrirMeta = () => { setMt(metas.meta_total_mes == null ? '' : String(metas.meta_total_mes)); setMp(metas.meta_pct_prazo == null ? '' : String(metas.meta_pct_prazo)); setMsgMeta(''); setEditMeta(true) }
  async function salvarMeta() {
    const t = mt.trim() === '' ? null : Number(mt), p = mp.trim() === '' ? null : Number(mp.replace(',', '.'))
    if ((t !== null && (!Number.isInteger(t) || t < 0)) || (p !== null && (isNaN(p) || p < 0 || p > 100))) return setMsgMeta('Meta de chamados: número inteiro ≥ 0. Meta de prazo: de 0 a 100.')
    const e = await onSalvarMetas({ meta_total_mes: t, meta_pct_prazo: p }); if (e) return setMsgMeta(e); setEditMeta(false)
  }
  const statusMeta = (k: ReturnType<typeof kpis>, mes: string, per: Per) => {
    const f = fatorPeriodo(mes, per), alvoT = metas.meta_total_mes == null ? null : Math.round(metas.meta_total_mes * f * 10) / 10
    return { alvoT, okT: alvoT == null ? null : k.total <= alvoT, alvoP: metas.meta_pct_prazo, okP: metas.meta_pct_prazo == null || k.pctPrazo == null ? null : k.pctPrazo * 100 >= metas.meta_pct_prazo }
  }
  const mA = statusMeta(a, mesA, perA), mB = statusMeta(b, mesB, perB)
  const temMeta = metas.meta_total_mes != null || metas.meta_pct_prazo != null
  const exportaCsv = () => download(`comparativo-chamados-${mesA}-vs-${mesB}.csv`, toCSV([
    ['Comparativo de chamados', '', ''], ['Atual', rotuloA, ''], ['Comparar com', rotuloB, ''], [],
    ['Indicador', 'Comparar com', 'Atual'],
    ['Chamados abertos', b.total, a.total], ['% dentro do prazo', b.pctPrazo === null ? '' : Math.round(b.pctPrazo * 100) + '%', a.pctPrazo === null ? '' : Math.round(a.pctPrazo * 100) + '%'],
    ['Tipos de chamado', b.tipos, a.tipos], ['Subcategorias', b.subcategorias, a.subcategorias], [],
    [`Variação por ${dim}`, 'Comparar com', 'Atual', 'Diferença'],
    ...todos.map((x) => [x.nome, x.ant, x.atu, x.d]),
  ]))
  const imprimir = () => { document.body.classList.add('imprimindo-comp'); const f = () => { document.body.classList.remove('imprimindo-comp'); window.removeEventListener('afterprint', f) }; window.addEventListener('afterprint', f); window.print() }
  const presets: [string, () => void][] = [
    ['Mês × mês anterior', () => { setPerA('mes'); setPerB('mes'); setMesB(mesAnterior(mesA)) }],
    ['1ª quinzena × 1ª do mês anterior', () => { setPerA('q1'); setPerB('q1'); setMesB(mesAnterior(mesA)) }],
    ['2ª quinzena × 2ª do mês anterior', () => { setPerA('q2'); setPerB('q2'); setMesB(mesAnterior(mesA)) }],
    ['2ª × 1ª quinzena (mesmo mês)', () => { setPerA('q2'); setPerB('q1'); setMesB(mesA) }],
    ...(mesA === hoje.slice(0, 7) ? [[`Mesmos dias (1–${dHoje}) × mês anterior`, () => { setPerA(`ate${dHoje}` as Per); setPerB(`ate${dHoje}` as Per); setMesB(mesAnterior(mesA)) }] as [string, () => void]] : []),
  ]
  const Seletor = ({ rot, mes, setMes, per, setPer }: { rot: string; mes: string; setMes: (m: string) => void; per: Per; setPer: (p: Per) => void }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs font-bold text-slate-500">{rot}</span>
      <select className={sel} aria-label={rot + ' — mês'} value={mes} onChange={(e) => setMes(e.target.value)}>{opcoes.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}</select>
      <select className={sel} aria-label={rot + ' — período'} value={per} onChange={(e) => setPer(e.target.value as Per)}>
        <option value="mes">Mês completo</option><option value="q1">1ª quinzena (1–15)</option><option value="q2">2ª quinzena (16+)</option>
        {per.startsWith('ate') && <option value={per}>{perTxt(per)}</option>}
      </select>
    </div>
  )

  const { veredito, varTotal, dPrazo, sTotal, sPrazo } = compara(a, b)
  const semBase = veredito === 'sem_base'
  const v = { sem_base: { ico: '', t: 'Sem base de comparação', c: 'border-slate-300 bg-slate-50 text-slate-700' },
    melhorou: { ico: '', t: 'Melhorou', c: 'border-green-300 bg-green-50 text-green-800' },
    piorou: { ico: '', t: 'Piorou', c: 'border-red-300 bg-red-50 text-red-800' },
    misto: { ico: '', t: 'Cenário misto', c: 'border-amber-300 bg-amber-50 text-amber-800' },
    estavel: { ico: '', t: 'Estável', c: 'border-slate-300 bg-slate-50 text-slate-700' } }[veredito]
  const pctTxt = (x: number) => (x > 0 ? '▲ +' : x < 0 ? '▼ −' : '') + Math.abs(Math.round(x * 100)) + '%'
  const ppTxt = (x: number) => (x > 0 ? '▲ +' : x < 0 ? '▼ −' : '') + Math.abs(x).toFixed(1).replace('.', ',') + ' p.p.'
  const frase = a.total === b.total ? `O volume de chamados ficou igual (${a.total}).`
    : `${a.total} chamado(s) em ${mesAtual} contra ${b.total} em ${mesAnt} (${pctTxt(varTotal)}).`
  const fraseP = dPrazo === null ? '' : ` O percentual dentro do prazo foi de ${Math.round((b.pctPrazo ?? 0) * 100)}% para ${Math.round((a.pctPrazo ?? 0) * 100)}%.`

  const { sobem, caem, todos } = useMemo(() => {
    const m = new Map<string, { nome: string; ant: number; atu: number }>()
    const add = (items: Chamado[], campo: 'ant' | 'atu') => items.forEach((c) => {
      const nome = (c[dim] ?? '').trim(); if (!nome) return
      const k = norm(nome); const x = m.get(k) ?? { nome, ant: 0, atu: 0 }; x[campo]++; m.set(k, x)
    })
    add(anterior, 'ant'); add(atual, 'atu')
    const l = [...m.values()].map((x) => ({ ...x, d: x.atu - x.ant })).filter((x) => x.d !== 0)
    return { todos: [...l].sort((p, q) => q.d - p.d), sobem: l.filter((x) => x.d > 0).sort((p, q) => q.d - p.d || q.atu - p.atu).slice(0, 7), caem: l.filter((x) => x.d < 0).sort((p, q) => p.d - q.d || q.ant - p.ant).slice(0, 7) }
  }, [atual, anterior, dim])

  const Lista = ({ itens, tit, cor }: { itens: typeof sobem; tit: string; cor: string }) => (
    <div>
      <h4 className={'mb-1 text-sm font-semibold ' + cor}>{tit}</h4>
      {itens.length === 0 ? <p className="text-xs text-slate-400">Nada neste grupo.</p> : (
        <ul className="space-y-1">
          {itens.map((x) => (
            <li key={x.nome} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-navy" title={x.nome}>{x.nome}{x.ant === 0 && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">NOVA</span>}{x.atu === 0 && <span className="ml-1 rounded bg-green-100 px-1 text-[10px] font-bold text-green-700">ZEROU</span>}</span>
              <span className="whitespace-nowrap text-xs text-slate-500">{x.ant} → <b className="text-navy">{x.atu}</b> <b className={x.d > 0 ? 'text-red-600' : 'text-green-600'}>({x.d > 0 ? '+' : '−'}{Math.abs(x.d)})</b></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <Card className="area-comp">
      <div className="mb-3 rounded-md border border-violet-100 bg-violet-50/40 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-navy">Comparativo de períodos</h3>
          <span className="text-xs text-slate-500">Escolha atalhos ou monte o seu: cada lado tem mês e período próprios.</span>
          <span className="ml-auto flex gap-2 print:hidden"><button className={btnG + ' ' + btnSm} onClick={exportaCsv}>CSV</button><button className={btnG + ' ' + btnSm} onClick={imprimir} title="Abre a impressão; escolha “Salvar como PDF”">PDF / imprimir</button></span>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">{presets.map(([l, f]) => <button key={l} className={chip(false)} onClick={f}>{l}</button>)}</div>
        <div className="grid gap-2 lg:grid-cols-2">
          <Seletor rot="Atual" mes={mesA} setMes={setMesA} per={perA} setPer={setPerA} />
          <Seletor rot="Comparar com" mes={mesB} setMes={setMesB} per={perB} setPer={setPerB} />
        </div>
      </div>
      <div className={'rounded-md border p-4 ' + v.c}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl" aria-hidden>{v.ico}</span>
          <div className="min-w-[220px] flex-1">
            <div className="text-lg font-extrabold">{semBase ? v.t : `${v.t} em relação a ${rotuloB}`}</div>
            <p className="text-sm">{semBase ? `Não há chamados em ${rotuloB} para comparar com ${rotuloA} (${a.total} chamado(s)).` : <>{frase}{fraseP}</>}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metrica titulo="Chamados abertos" ant={String(b.total)} atu={String(a.total)} delta={b.total ? pctTxt(varTotal) : '—'} bom={sTotal === 0 ? null : sTotal > 0} />
          <Metrica titulo="% dentro do prazo" ant={b.pctPrazo === null ? '—' : Math.round(b.pctPrazo * 100) + '%'} atu={a.pctPrazo === null ? '—' : Math.round(a.pctPrazo * 100) + '%'} delta={dPrazo === null ? '—' : ppTxt(dPrazo)} bom={sPrazo === 0 ? null : sPrazo > 0} />
          <Metrica titulo="Tipos de chamado" ant={String(b.tipos)} atu={String(a.tipos)} delta={a.tipos === b.tipos ? 'igual' : (a.tipos > b.tipos ? '▲ +' : '▼ −') + Math.abs(a.tipos - b.tipos)} bom={a.tipos === b.tipos ? null : a.tipos < b.tipos} />
          <Metrica titulo="Subcategorias" ant={String(b.subcategorias)} atu={String(a.subcategorias)} delta={a.subcategorias === b.subcategorias ? 'igual' : (a.subcategorias > b.subcategorias ? '▲ +' : '▼ −') + Math.abs(a.subcategorias - b.subcategorias)} bom={a.subcategorias === b.subcategorias ? null : a.subcategorias < b.subcategorias} />
        </div>
        <p className="mt-2 text-[11px] opacity-80">{filtroTxt} Menos chamados e mais % no prazo = melhor. Diferenças pequenas (menos de 5% no volume e 2 p.p. no prazo) contam como estável.</p>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-navy">Metas {temMeta ? <span className="font-normal text-slate-500">(a meta de volume é mensal e proporcional ao período escolhido)</span> : ''}</h4>
          {podeMetas && !editMeta && <button className={btnG + ' ' + btnSm + ' print:hidden'} onClick={abrirMeta}>{temMeta ? 'Editar metas' : 'Definir metas'}</button>}
        </div>
        {editMeta && (
          <div className="mt-2 flex flex-wrap items-end gap-2 print:hidden">
            <label className="text-xs font-semibold text-slate-600">Máx. de chamados por mês<input className={inp + ' mt-1 w-40'} inputMode="numeric" value={mt} onChange={(e) => setMt(e.target.value)} placeholder="ex.: 150" /></label>
            <label className="text-xs font-semibold text-slate-600">Mín. % dentro do prazo<input className={inp + ' mt-1 w-40'} inputMode="decimal" value={mp} onChange={(e) => setMp(e.target.value)} placeholder="ex.: 90" /></label>
            <button className={btnP + ' ' + btnSm} onClick={salvarMeta}>Salvar</button><button className={btnG + ' ' + btnSm} onClick={() => setEditMeta(false)}>Cancelar</button>
            {msgMeta && <span className="text-xs text-red-600">{msgMeta}</span>}
          </div>
        )}
        {!temMeta ? <p className="mt-1 text-xs text-slate-500">{podeMetas ? 'Defina uma meta de volume e/ou de % no prazo para ver se o período está dentro ou fora dela.' : 'Nenhuma meta definida (Analista Sr e Gerente podem definir).'}</p> : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[['Atual', rotuloA, a, mA], ['Comparar com', rotuloB, b, mB]].map(([t, r, k, m]: any) => (
              <div key={t} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <div className="text-[11px] font-bold text-slate-500">{t} · {r}</div>
                {m.alvoT != null && <div>Volume: <b>{k.total}</b> (meta ≤ {String(m.alvoT).replace('.', ',')}) <b className={m.okT ? 'text-green-700' : 'text-red-600'}>{m.okT ? 'dentro' : 'acima da meta'}</b></div>}
                {m.alvoP != null && <div>No prazo: <b>{k.pctPrazo == null ? '—' : Math.round(k.pctPrazo * 100) + '%'}</b> (meta ≥ {m.alvoP}%) {m.okP == null ? '' : <b className={m.okP ? 'text-green-700' : 'text-red-600'}>{m.okP ? 'dentro' : 'abaixo da meta'}</b>}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy">O que mudou: {mesAnt} → {mesAtual}</h3>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Comparar por">
          <span className="text-xs font-bold text-slate-500">Por</span>
          {DIMS.map(([k, l]) => <button key={k} className={chip(dim === k)} aria-pressed={dim === k} onClick={() => setDim(k)}>{l}</button>)}
        </div>
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <Lista itens={sobem} tit="Aumentaram (atenção)" cor="text-red-600" />
        <Lista itens={caem} tit="Diminuíram (melhoraram)" cor="text-green-700" />
      </div>
    </Card>
  )
}
