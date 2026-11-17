import { FASE_INFO, faseDe, faseIdx, Melhoria, dataDaFase } from '../lib/backlog'
import { fmtDate } from '../lib/rules'

/** Linha do tempo das 5 etapas do processo de melhoria, com a data de cada etapa já cumprida. */
export default function FunilLinha({ m, compacto = false }: { m: Melhoria; compacto?: boolean }) {
  const atual = faseIdx(faseDe(m))
  return (
    <ol className="flex w-full items-start" aria-label="Etapas do processo da melhoria">
      {FASE_INFO.map((f, i) => {
        const feita = i < atual, ativa = i === atual
        const d = dataDaFase(m, f.k)
        return (
          <li key={f.k} className="relative flex min-w-0 flex-1 flex-col items-center text-center" title={`${f.label}${d ? ' — ' + fmtDate(d) : ''}`}>
            {i > 0 && <span className="absolute left-0 right-1/2 top-[11px] h-0.5" style={{ background: i <= atual ? FASE_INFO[atual].cor : '#e2e8f0' }} aria-hidden />}
            {i < FASE_INFO.length - 1 && <span className="absolute left-1/2 right-0 top-[11px] h-0.5" style={{ background: i < atual ? FASE_INFO[atual].cor : '#e2e8f0' }} aria-hidden />}
            <span className="relative z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-[11px] font-bold"
              style={feita ? { background: f.cor, borderColor: f.cor, color: '#fff' } : ativa ? { background: '#fff', borderColor: f.cor, color: f.cor, boxShadow: `0 0 0 3px ${f.cor}33` } : { background: '#fff', borderColor: '#cbd5e1', color: '#94a3b8' }}>
              {feita ? '✓' : i + 1}
            </span>
            {!compacto && (<>
              <span className={'mt-1 w-full truncate text-[10px] leading-tight ' + (ativa ? 'font-bold' : feita ? 'font-semibold text-slate-600' : 'text-slate-400')} style={ativa ? { color: f.cor } : undefined}>{f.curto}</span>
              <span className="text-[10px] leading-tight text-slate-500">{i <= atual ? (d ? fmtDate(d).slice(0, 5) : '—') : ''}</span>
            </>)}
          </li>
        )
      })}
    </ol>
  )
}
