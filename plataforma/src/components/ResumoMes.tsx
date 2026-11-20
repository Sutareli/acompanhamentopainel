import { useMemo, useState } from 'react'
import { Card } from './ui'
import ListaChamadosModal from './ListaChamadosModal'
import { Chamado, concluido, improcedente, mesKey, mesLabel, noPrazoPlan, pendente, ResumoMes as Res, resumoMes } from '../lib/chamados'

/** "Resumo Mês" da planilha: 4 gráficos (concluídos, concluídos no prazo, pendentes no prazo, reincidentes) com os últimos meses até o mês escolhido. Mesmas regras da planilha (ver resumoMes em lib/chamados). */
const ESC = '#3b0a8c', CLA = '#a96bff', LIN = '#0891b2'
const pf = (v: number | null) => (v === null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%')
const chip = (on: boolean) => 'rounded-md border px-3 py-1 text-xs font-medium transition ' + (on ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')

type Pred = (c: Chamado) => boolean
interface Cfg { pa: Pred; pb: Pred; titulo: string; nA: string; nB: string; a: (r: Res) => number; b: (r: Res) => number; p: (r: Res) => number | null; nP: string }
const dentro = (c: Chamado) => (c.prazo || '').trim().toLowerCase() === 'dentro do prazo'
const CARDS: Cfg[] = [
  { pa: () => true, pb: concluido, titulo: 'Concluídos', nA: 'Casos', nB: 'Concluídos', a: (r) => r.casos, b: (r) => r.concluidos, p: (r) => r.pctConcluidos, nP: 'Concluídos (%)' },
  { pa: concluido, pb: noPrazoPlan, titulo: 'Concluídos no prazo', nA: 'Concluídos', nB: 'No prazo', a: (r) => r.concluidos, b: (r) => r.noPrazo, p: (r) => r.pctNoPrazo, nP: 'No prazo (%)' },
  { pa: pendente, pb: (c) => pendente(c) && dentro(c), titulo: 'Pendentes no prazo', nA: 'Pendentes', nB: 'No prazo', a: (r) => r.pendentes, b: (r) => r.pendNoPrazo, p: (r) => r.pctPendNoPrazo, nP: 'No prazo (%)' },
  { pa: concluido, pb: (c) => c.reincidente === true, titulo: 'Casos reincidentes', nA: 'Concluídos', nB: 'Reincidentes', a: (r) => r.concluidos, b: (r) => r.reincidentes, p: (r) => r.pctReincidentes, nP: 'Reincidência (%)' },
]

function Grafico({ cfg, dados, abrir }: { cfg: Cfg; dados: Res[]; abrir: (cfg: Cfg, mes: string, serie: 'a' | 'b') => void }) {
  const W = 330, H = 190, PL = 8, PR = 8, PT = 30, PB = 24
  const max = Math.max(1, ...dados.flatMap((d) => [cfg.a(d), cfg.b(d)]))
  const n = dados.length, gw = (W - PL - PR) / n, bw = Math.min(26, gw / 3)
  const base = H - PB, alt = base - PT - 40                    // reserva faixa no topo para a linha de %
  const yB = (v: number) => base - (v / max) * alt
  const yP = (p: number) => PT + 4 + (1 - Math.min(1, Math.max(0, p))) * 34
  const pts = dados.map((d, i) => ({ x: PL + gw * i + gw / 2, p: cfg.p(d) }))
  const linha = pts.filter((q) => q.p !== null).map((q) => `${q.x},${yP(q.p as number)}`).join(' ')
  return (
    <div className="rounded-md border border-violet-100 bg-white p-3">
      <h4 className="text-center font-bold text-violet-600">{cfg.titulo}</h4>
      <div className="mt-1 flex flex-wrap justify-center gap-x-3 text-[11px] text-slate-600">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: ESC }} />{cfg.nA} (q)</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: CLA }} />{cfg.nB} (q)</span>
        <span><i className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: LIN }} />{cfg.nP}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${cfg.titulo}: ` + dados.map((d) => `${mesLabel(d.mes)} ${cfg.a(d)} e ${cfg.b(d)} (${pf(cfg.p(d))})`).join('; ')}>
        <line x1={PL} x2={W - PR} y1={base} y2={base} stroke="#e2e8f0" />
        {dados.map((d, i) => {
          const cx = PL + gw * i + gw / 2, a = cfg.a(d), b = cfg.b(d)
          return (
            <g key={d.mes}>
              <rect x={cx - bw - 1} y={yB(a)} width={bw} height={Math.max(0, base - yB(a))} rx="2" fill={ESC} className="cursor-pointer hover:opacity-80" role="button" tabIndex={0} aria-label={`Ver ${a} chamados: ${cfg.nA} em ${mesLabel(d.mes)}`} onClick={() => abrir(cfg, d.mes, 'a')} onKeyDown={(e) => e.key === 'Enter' && abrir(cfg, d.mes, 'a')}><title>{`${cfg.nA}: ${a} — clique para ver os chamados`}</title></rect>
              <rect x={cx + 1} y={yB(b)} width={bw} height={Math.max(0, base - yB(b))} rx="2" fill={CLA} className="cursor-pointer hover:opacity-80" role="button" tabIndex={0} aria-label={`Ver ${b} chamados: ${cfg.nB} em ${mesLabel(d.mes)}`} onClick={() => abrir(cfg, d.mes, 'b')} onKeyDown={(e) => e.key === 'Enter' && abrir(cfg, d.mes, 'b')}><title>{`${cfg.nB}: ${b} — clique para ver os chamados`}</title></rect>
              <text x={cx - bw / 2 - 1} y={Math.min(base - 3, yB(a) - 3)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e293b">{a}</text>
              <text x={cx + bw / 2 + 1} y={Math.min(base - 3, yB(b) - 3)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e293b">{b}</text>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#475569">{mesLabel(d.mes)}</text>
            </g>
          )
        })}
        {pts.filter((q) => q.p !== null).length > 1 && <polyline fill="none" stroke={LIN} strokeWidth="2.5" strokeLinejoin="round" points={linha} />}
        {pts.map((q, i) => q.p === null ? null : (
          <g key={i}>
            <circle cx={q.x} cy={yP(q.p)} r="3.5" fill={LIN} />
            <rect x={q.x - 22} y={yP(q.p) - 17} width="44" height="14" rx="3" fill="#ecfeff" stroke={LIN} strokeWidth="0.8" />
            <text x={q.x} y={yP(q.p) - 7} textAnchor="middle" fontSize="10" fontWeight="700" fill="#155e75">{pf(q.p)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function ResumoMes({ rows, meses, mesInicial }: { rows: Chamado[]; meses: string[]; mesInicial: string }) {
  const [qtd, setQtd] = useState(3)
  const [mes, setMes] = useState(mesInicial)
  const [det, setDet] = useState<{ titulo: string; itens: Chamado[] } | null>(null)
  const abrir = (cfg: Cfg, m: string, serie: 'a' | 'b') => setDet({ titulo: `${serie === 'a' ? cfg.nA : cfg.nB}${(serie === 'a' ? cfg.nA : cfg.nB) === cfg.titulo ? '' : ' — ' + cfg.titulo} · ${mesLabel(m)}`, itens: rows.filter((r) => mesKey(r.data_ref) === m && !improcedente(r) && (serie === 'a' ? cfg.pa : cfg.pb)(r)) })
  const ate = meses.includes(mes) ? mes : meses[meses.length - 1]
  const lista = useMemo(() => { const i = meses.indexOf(ate); return meses.slice(Math.max(0, i - qtd + 1), i + 1) }, [meses, ate, qtd])
  const dados = useMemo(() => resumoMes(rows, lista), [rows, lista])
  const semReinc = rows.length > 0 && !rows.some((r) => r.reincidente === true || r.reincidente === false)
  const improc = dados.reduce((a, d) => a + d.improcedentes, 0)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">Resumo do mês</h3>
          <p className="text-xs text-slate-500">Mesmos números da aba “Resumo Mês” da planilha. Casos não incluem Improcedentes{improc ? ` (${improc} no período)` : ''}; “no prazo” é sobre os concluídos; os pendentes usam o Status_Prazo da planilha.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs text-navy" aria-label="Até o mês" value={ate} onChange={(e) => setMes(e.target.value)}>{[...meses].reverse().map((m) => <option key={m} value={m}>Até {mesLabel(m)}</option>)}</select>
          {[3, 6].map((n) => <button key={n} className={chip(qtd === n)} aria-pressed={qtd === n} onClick={() => setQtd(n)}>{n} meses</button>)}
        </div>
      </div>
      {semReinc && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">A base carregada não traz a coluna “REINCIDENTE ?”: o gráfico de reincidentes aparece zerado. Importe a base com essa coluna (e com Status_Prazo).</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{CARDS.map((c) => <Grafico key={c.titulo} cfg={c} dados={dados} abrir={abrir} />)}</div>
      <p className="mt-2 text-xs text-slate-500">Clique em uma barra para ver os chamados que formam o número.</p>
      {det && <ListaChamadosModal titulo={det.titulo} itens={det.itens} onClose={() => setDet(null)} />}
    </Card>
  )
}
