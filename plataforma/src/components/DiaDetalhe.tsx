import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chk, fmtMin, fmtSec, hhmm } from '../lib/rules'
import { Chip, Empty, Msg } from './ui'

/**
 * Detalhe SOMENTE LEITURA de uma jornada (de qualquer usuário a que o RLS permita acesso).
 * Não cria nem altera registros: só consultas SELECT.
 */
export default function DiaDetalhe({ userId, date }: { userId: string; date: string }) {
  const [det, setDet] = useState<any>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let off = false
    setDet(null); setErr('')
    ;(async () => {
      try {
        const rec = chk(await supabase.from('daily_records').select('*').eq('user_id', userId).eq('data', date).maybeSingle()) as any
        if (!rec) { if (!off) setDet({ none: true }); return }
        const [b, a, i] = await Promise.all([
          supabase.from('daily_blocks').select('*, daily_tasks(*)').eq('daily_record_id', rec.id).order('numero'),
          supabase.from('agenda').select('*').eq('user_id', userId).eq('data', date).order('horario'),
          supabase.from('imprevistos').select('*').eq('user_id', userId).eq('data', date),
        ])
        if (!off) setDet({ rec, blocks: chk(b), agenda: chk(a), imps: chk(i) })
      } catch (e: any) { if (!off) setErr(e.message) }
    })()
    return () => { off = true }
  }, [userId, date])

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  if (err) return <Msg kind="erro">{err}</Msg>
  if (!det) return <p className="py-6 text-center text-sm text-slate-500">Carregando…</p>
  if (det.none) return <Empty>Sem registro nesta data.</Empty>

  return (
    <div className="space-y-3 text-sm">
      {det.blocks.map((b: any) => {
        const t = [...b.daily_tasks].sort((x: any, y: any) => x.ordem - y.ordem)
        const el = b.acumulado_seg + (b.em_execucao_desde ? (now - Date.parse(b.em_execucao_desde)) / 1000 : 0)
        return (
          <div key={b.id} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <b>{b.numero}. {b.nome}</b>
              <Chip color="#0ea5b7">{t.filter((x: any) => x.concluida).length}/{t.length} tarefas</Chip>
              {b.em_execucao_desde && <Chip color="#f59e0b">● em execução agora</Chip>}
              <span className="text-slate-500">{fmtSec(el)} de {fmtMin(b.duracao_planejada_min)}</span>
            </div>
            <ul className="ml-1 space-y-0.5">
              {t.map((x: any) => <li key={x.id} className={x.concluida ? 'text-green-700' : 'text-slate-500'}>{x.concluida ? '✔' : '☐'} {x.descricao}{x.concluida && x.concluida_em ? ` (${hhmm(x.concluida_em)})` : ''}</li>)}
            </ul>
            {b.observacoes && <p className="mt-1"><b>Observações:</b> {b.observacoes}</p>}
          </div>
        )
      })}
      <div><b>Reuniões:</b> {det.agenda.length ? det.agenda.map((a: any) => `${a.horario?.slice(0, 5) || '--:--'} ${a.assunto} (${fmtMin(a.duracao_min)})`).join(' · ') : 'nenhuma'}</div>
      <div><b>Imprevistos:</b> {det.imps.length ? det.imps.map((a: any) => `${a.descricao} (${fmtMin(a.estimativa_min)}, ${a.status})`).join(' · ') : 'nenhum'}</div>
      {det.rec.preparacao_proximo_dia && <div><b>Preparação para o próximo dia:</b> {det.rec.preparacao_proximo_dia}</div>}
      {det.rec.config?.origem === 'importacao_painel_antigo' && <p className="text-xs text-slate-500">Dia importado do painel antigo{det.rec.config.tempo_total_seg ? ` · tempo trabalhado original: ${fmtSec(det.rec.config.tempo_total_seg)} (não dividido por bloco)` : ''}.</p>}
    </div>
  )
}
