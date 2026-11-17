import { FormEvent, useState } from 'react'
import { btnG, btnP, Field, inp, Modal, Msg } from './ui'
import { FASES, faseDe, faseIdx, faseInfo, dataDaFase, Melhoria } from '../lib/backlog'
import { fmtDate, todayStr } from '../lib/rules'

/** Avança a melhoria para a próxima etapa do processo, registrando a data (e o que cada etapa pede). */
export default function AvancarFase({ m, onClose, onConfirm }: { m: Melhoria; onClose: () => void; onConfirm: (payload: Record<string, unknown>) => Promise<string> }) {
  const hoje = todayStr()
  const atual = faseDe(m); const prox = FASES[faseIdx(atual) + 1]
  const info = faseInfo(prox)
  const [data, setData] = useState(hoje)
  const [prio, setPrio] = useState(String(m.prioridade || 3))
  const [chamado, setChamado] = useState(m.numero_chamado || '')
  const [prazo, setPrazo] = useState(m.data_termino || '')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  // última data já registrada nas etapas anteriores (a nova não pode ser anterior)
  const anterior = FASES.slice(0, faseIdx(prox)).map((k) => dataDaFase(m, k)).filter(Boolean).sort().pop() || null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!data) return setErr('Informe a data.')
    if (data > hoje) return setErr('A data não pode ser futura.')
    if (anterior && data < anterior) return setErr(`A data não pode ser anterior à etapa anterior (${fmtDate(anterior)}).`)
    if (prazo && prazo < data && prox === 'em_desenvolvimento') return setErr('O prazo não pode ser anterior ao início do desenvolvimento.')
    if (prox === 'priorizada' && !(Number(prio) >= 1)) return setErr('Informe a prioridade (1 ou maior).')
    let p: Record<string, unknown> = { fase: prox }
    if (prox === 'priorizada') p = { ...p, data_priorizacao: data, prioridade: Math.max(1, Number(prio) || 3) }
    else if (prox === 'especificacao') p = { ...p, data_especificacao: data }
    else if (prox === 'chamado_aberto') p = { ...p, data_abertura: data, numero_chamado: chamado.trim() || null }
    else if (prox === 'em_desenvolvimento') p = { ...p, status: 'Em andamento', data_inicio: data, data_termino: prazo || null }
    else if (prox === 'homologacao') p = { ...p, status: m.status === 'Atrasado' || m.status === 'Novo Prazo' ? m.status : 'Em andamento', data_homologacao: data }
    else p = { ...p, status: 'Concluído', percentual_concluido: 100, data_conclusao: data }
    setBusy(true); setErr('')
    const r = await onConfirm(p)
    if (r) { setErr(r); setBusy(false) }
  }
  return (
    <Modal title={`Avançar para: ${info.icon} ${info.label}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Msg kind="erro">{err}</Msg>}
        <p className="text-sm text-slate-600"><b>{m.melhoria}</b><br /><span className="text-xs text-slate-500">{faseInfo(atual).icon} {faseInfo(atual).label} → {info.icon} {info.label}. {info.ajuda}</span></p>
        <Field label={info.dataLabel}><input className={inp} type="date" value={data} max={hoje} min={anterior || undefined} onChange={(e) => setData(e.target.value)} autoFocus /></Field>
        {prox === 'priorizada' && <Field label="Criticidade / prioridade definida na reunião (1 = mais alta)"><input className={inp} type="number" min={1} step={1} value={prio} onChange={(e) => setPrio(e.target.value)} /></Field>}
        {prox === 'chamado_aberto' && <Field label="Nº do chamado (opcional)"><input className={inp} value={chamado} maxLength={60} placeholder="ex.: CH-12345" onChange={(e) => setChamado(e.target.value)} /></Field>}
        {prox === 'em_desenvolvimento' && <Field label="Prazo previsto de entrega (opcional)"><input className={inp} type="date" value={prazo} min={data || undefined} onChange={(e) => setPrazo(e.target.value)} /></Field>}
        {prox === 'producao' && <p className="text-xs text-slate-500">A melhoria passa a Concluída (100%), em produção.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnG} onClick={onClose}>Cancelar</button>
          <button className={btnP} disabled={busy}>{busy ? 'Salvando…' : 'Confirmar'}</button>
        </div>
      </form>
    </Modal>
  )
}
