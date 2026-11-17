import { useMemo, useState } from 'react'
import { Card } from './ui'
import { Chamado, kpis } from '../lib/chamados'

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

export default function ComparativoChamados({ atual, anterior, mesAtual, mesAnt, recorte }: { atual: Chamado[]; anterior: Chamado[]; mesAtual: string; mesAnt: string; recorte: string }) {
  const [dim, setDim] = useState<Dim>('subcategoria')
  const a = useMemo(() => kpis(atual), [atual])
  const b = useMemo(() => kpis(anterior), [anterior])

  const varTotal = b.total ? (a.total - b.total) / b.total : 0
  const dPrazo = a.pctPrazo !== null && b.pctPrazo !== null ? (a.pctPrazo - b.pctPrazo) * 100 : null
  const sTotal = Math.abs(varTotal) < 0.05 ? 0 : varTotal < 0 ? 1 : -1       // menos de 5% de diferença = estável
  const sPrazo = dPrazo === null || Math.abs(dPrazo) < 2 ? 0 : dPrazo > 0 ? 1 : -1   // menos de 2 p.p. = estável
  const score = sTotal + sPrazo
  const v = score > 0 ? { ico: '🟢', t: 'Melhorou', c: 'border-green-300 bg-green-50 text-green-800' }
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
      <div className={'rounded-2xl border p-4 ' + v.c}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl" aria-hidden>{v.ico}</span>
          <div className="min-w-[220px] flex-1">
            <div className="text-lg font-extrabold">{v.t} em relação ao mês anterior</div>
            <p className="text-sm">{frase}{fraseP}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metrica titulo="Chamados abertos" ant={String(b.total)} atu={String(a.total)} delta={b.total ? pctTxt(varTotal) : '—'} bom={sTotal === 0 ? null : sTotal > 0} />
          <Metrica titulo="% dentro do prazo" ant={b.pctPrazo === null ? '—' : Math.round(b.pctPrazo * 100) + '%'} atu={a.pctPrazo === null ? '—' : Math.round(a.pctPrazo * 100) + '%'} delta={dPrazo === null ? '—' : ppTxt(dPrazo)} bom={sPrazo === 0 ? null : sPrazo > 0} />
          <Metrica titulo="Tipos de chamado" ant={String(b.tipos)} atu={String(a.tipos)} delta={a.tipos === b.tipos ? 'igual' : (a.tipos > b.tipos ? '▲ +' : '▼ −') + Math.abs(a.tipos - b.tipos)} bom={a.tipos === b.tipos ? null : a.tipos < b.tipos} />
          <Metrica titulo="Subcategorias" ant={String(b.subcategorias)} atu={String(a.subcategorias)} delta={a.subcategorias === b.subcategorias ? 'igual' : (a.subcategorias > b.subcategorias ? '▲ +' : '▼ −') + Math.abs(a.subcategorias - b.subcategorias)} bom={a.subcategorias === b.subcategorias ? null : a.subcategorias < b.subcategorias} />
        </div>
        <p className="mt-2 text-[11px] opacity-80">{recorte} Menos chamados e mais % no prazo = melhor. Diferenças pequenas (menos de 5% no volume e 2 p.p. no prazo) contam como estável.</p>
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
