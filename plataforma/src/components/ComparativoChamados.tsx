import { useMemo, useState } from 'react'
import { Card } from './ui'
import { Chamado, kpis, mesAnterior, mesKey, mesLabel } from '../lib/chamados'
import { todayStr } from '../lib/rules'

/** Mês atual × mês anterior: veredito rápido (melhorou / piorou) + o que mais subiu e o que mais caiu. Menos chamados = melhor; mais % no prazo = melhor. */
type Dim = 'subcategoria' | 'tipo' | 'categoria'
const DIMS: [Dim, string][] = [['subcategoria', 'Subcategoria'], ['tipo', 'Tipo'], ['categoria', 'Categoria']]
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
const chip = (on: boolean) => 'rounded-full border px-3 py-1 text-xs font-semibold transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')

function Metrica({ titulo, ant, atu, delta, bom }: { titulo: string; ant: string; atu: string; delta: string; bom: boolean | null }) {
  const cor = bom === null ? 'text-slate-500' : bom ? 'text-green-700' : 'text-red-600'
  return (
    <div className="rounded-xl bg-white/80 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="text-sm text-slate-600">{ant} → <b className="text-lg text-navy">{atu}</b></div>
      <div className={'text-xs font-bold ' + cor}>{delta}</div>
    </div>
  )
}

type Per = 'mes' | 'q1' | 'q2' | `ate${number}`
const dia = (c: Chamado) => +c.data_ref.slice(8, 10)
const naPer = (c: Chamado, p: Per) => p === 'mes' || (p === 'q1' ? dia(c) <= 15 : p === 'q2' ? dia(c) >= 16 : dia(c) <= +p.slice(3))
const perTxt = (p: Per) => (p === 'mes' ? 'mês completo' : p === 'q1' ? '1ª quinzena (dias 1–15)' : p === 'q2' ? '2ª quinzena (dia 16 em diante)' : `dias 1 a ${p.slice(3)}`)
const sel = 'rounded-lg border border-violet-300 bg-white px-2 py-1 text-sm text-navy'

export default function ComparativoChamados({ rows, meses, mesInicial, filtroTxt }: { rows: Chamado[]; meses: string[]; mesInicial: string; filtroTxt: string }) {
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
  const presets: [string, () => void][] = [
    ['Mês × mês anterior', () => { setPerA('mes'); setPerB('mes'); setMesB(mesAnterior(mesA)) }],
    ['1ª quinzena × 1ª do mês anterior', () => { setPerA('q1'); setPerB('q1'); setMesB(mesAnterior(mesA)) }],
    ['2ª quinzena × 2ª do mês anterior', () => { setPerA('q2'); setPerB('q2'); setMesB(mesAnterior(mesA)) }],
    ['2ª × 1ª quinzena (mesmo mês)', () => { setPerA('q2'); setPerB('q1'); setMesB(mesA) }],
    ...(mesA === hoje.slice(0, 7) ? [[`Mesmos dias (1–${dHoje}) × mês anterior`, () => { setPerA(`ate${dHoje}` as Per); setPerB(`ate${dHoje}` as Per); setMesB(mesAnterior(mesA)) }] as [string, () => void]] : []),
  ]
  const Seletor = ({ rot, mes, setMes, per, setPer }: { rot: string; mes: string; setMes: (m: string) => void; per: Per; setPer: (p: Per) => void }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs font-bold uppercase text-slate-500">{rot}</span>
      <select className={sel} aria-label={rot + ' — mês'} value={mes} onChange={(e) => setMes(e.target.value)}>{opcoes.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}</select>
      <select className={sel} aria-label={rot + ' — período'} value={per} onChange={(e) => setPer(e.target.value as Per)}>
        <option value="mes">Mês completo</option><option value="q1">1ª quinzena (1–15)</option><option value="q2">2ª quinzena (16+)</option>
        {per.startsWith('ate') && <option value={per}>{perTxt(per)}</option>}
      </select>
    </div>
  )

  const semBase = b.total === 0
  const varTotal = b.total ? (a.total - b.total) / b.total : 0
  const dPrazo = a.pctPrazo !== null && b.pctPrazo !== null ? (a.pctPrazo - b.pctPrazo) * 100 : null
  const sTotal = Math.abs(varTotal) < 0.05 ? 0 : varTotal < 0 ? 1 : -1       // menos de 5% de diferença = estável
  const sPrazo = dPrazo === null || Math.abs(dPrazo) < 2 ? 0 : dPrazo > 0 ? 1 : -1   // menos de 2 p.p. = estável
  const score = sTotal + sPrazo
  const v = semBase ? { ico: '⚪', t: 'Sem base de comparação', c: 'border-slate-300 bg-slate-50 text-slate-700' } : score > 0 ? { ico: '🟢', t: 'Melhorou', c: 'border-green-300 bg-green-50 text-green-800' }
    : score < 0 ? { ico: '🔴', t: 'Piorou', c: 'border-red-300 bg-red-50 text-red-800' }
    : sTotal !== 0 ? { ico: '🟡', t: 'Cenário misto', c: 'border-amber-300 bg-amber-50 text-amber-800' }
    : { ico: '⚪', t: 'Estável', c: 'border-slate-300 bg-slate-50 text-slate-700' }
  const pctTxt = (x: number) => (x > 0 ? '▲ +' : x < 0 ? '▼ −' : '') + Math.abs(Math.round(x * 100)) + '%'
  const ppTxt = (x: number) => (x > 0 ? '▲ +' : x < 0 ? '▼ −' : '') + Math.abs(x).toFixed(1).replace('.', ',') + ' p.p.'
  const frase = a.total === b.total ? `O volume de chamados ficou igual (${a.total}).`
    : `${a.total} chamado(s) em ${mesAtual} contra ${b.total} em ${mesAnt} (${pctTxt(varTotal)}).`
  const fraseP = dPrazo === null ? '' : ` O percentual dentro do prazo foi de ${Math.round((b.pctPrazo ?? 0) * 100)}% para ${Math.round((a.pctPrazo ?? 0) * 100)}%.`

  const { sobem, caem } = useMemo(() => {
    const m = new Map<string, { nome: string; ant: number; atu: number }>()
    const add = (items: Chamado[], campo: 'ant' | 'atu') => items.forEach((c) => {
      const nome = (c[dim] ?? '').trim(); if (!nome) return
      const k = norm(nome); const x = m.get(k) ?? { nome, ant: 0, atu: 0 }; x[campo]++; m.set(k, x)
    })
    add(anterior, 'ant'); add(atual, 'atu')
    const l = [...m.values()].map((x) => ({ ...x, d: x.atu - x.ant })).filter((x) => x.d !== 0)
    return { sobem: l.filter((x) => x.d > 0).sort((p, q) => q.d - p.d || q.atu - p.atu).slice(0, 7), caem: l.filter((x) => x.d < 0).sort((p, q) => p.d - q.d || q.ant - p.ant).slice(0, 7) }
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
    <Card>
      <div className="mb-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-navy">Comparativo de períodos</h3>
          <span className="text-xs text-slate-500">Escolha atalhos ou monte o seu: cada lado tem mês e período próprios.</span>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">{presets.map(([l, f]) => <button key={l} className={chip(false)} onClick={f}>{l}</button>)}</div>
        <div className="grid gap-2 lg:grid-cols-2">
          <Seletor rot="Atual" mes={mesA} setMes={setMesA} per={perA} setPer={setPerA} />
          <Seletor rot="Comparar com" mes={mesB} setMes={setMesB} per={perB} setPer={setPerB} />
        </div>
      </div>
      <div className={'rounded-2xl border p-4 ' + v.c}>
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy">O que mudou: {mesAnt} → {mesAtual}</h3>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Comparar por">
          <span className="text-xs font-bold uppercase text-slate-500">Por</span>
          {DIMS.map(([k, l]) => <button key={k} className={chip(dim === k)} aria-pressed={dim === k} onClick={() => setDim(k)}>{l}</button>)}
        </div>
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <Lista itens={sobem} tit="🔺 Aumentaram (atenção)" cor="text-red-600" />
        <Lista itens={caem} tit="🔻 Diminuíram (melhoraram)" cor="text-green-700" />
      </div>
    </Card>
  )
}
