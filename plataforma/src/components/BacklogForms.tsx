import { FormEvent, useState } from 'react'
import { btnG, btnP, Field, inp, Modal, Msg } from './ui'
import { Etapa, Melhoria, STATUS } from '../lib/backlog'
import { todayStr } from '../lib/rules'

const MODULOS_SUGERIDOS = ['Gestão Executiva', 'Tabelas', 'Meus Feedback', 'Todos os módulos']

/** Cadastro/edição da ATIVIDADE (melhoria). Com etapas, status e % são calculados por elas e ficam bloqueados. */
export function MelhoriaForm({ init, modulos, temEtapas, onClose, onSave }: {
  init: Partial<Melhoria>; modulos: string[]; temEtapas: boolean; onClose: () => void; onSave: (p: Partial<Melhoria>) => Promise<string>
}) {
  const [f, setF] = useState<Partial<Melhoria>>(init)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Melhoria, v: any) => setF((p) => ({ ...p, [k]: v }))
  const txt = (k: keyof Melhoria, label: string, rows = 2) => (
    <Field label={label} className="sm:col-span-2"><textarea className={inp} rows={rows} value={(f[k] as string) || ''} onChange={(e) => set(k, e.target.value)} /></Field>
  )
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.modulo?.trim()) return setErr('Informe o módulo.')
    if (!f.melhoria?.trim()) return setErr('Informe o nome da melhoria.')
    const pc = Number(f.percentual_concluido) || 0
    if (pc < 0 || pc > 100) return setErr('O percentual deve estar entre 0 e 100.')
    if ((Number(f.prioridade) || 0) < 1) return setErr('A prioridade deve ser 1 ou maior (1 = mais alta).')
    if (f.data_inicio && f.data_termino && f.data_termino < f.data_inicio) return setErr('O término não pode ser anterior ao início.')
    setBusy(true); setErr('')
    const m = await onSave(f)
    if (m) { setErr(m); setBusy(false) }
  }
  const mods = [...new Set([...MODULOS_SUGERIDOS, ...modulos])]
  return (
    <Modal title={f.id ? 'Editar atividade' : 'Nova melhoria'} wide onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Msg kind="erro">{err}</Msg></div>}
        <Field label="Módulo *"><input className={inp} list="bl-modulos" value={f.modulo || ''} onChange={(e) => set('modulo', e.target.value)} /><datalist id="bl-modulos">{mods.map((m) => <option key={m} value={m} />)}</datalist></Field>
        <Field label="Melhoria — O QUE? (nome curto) *"><input className={inp} value={f.melhoria || ''} onChange={(e) => set('melhoria', e.target.value)} /></Field>
        {txt('descricao', 'Descrição — o que é')}
        {txt('descricao_detalhada', 'Descrição detalhada', 3)}
        {txt('objetivo', 'Objetivo — benefício esperado')}
        {txt('objetivo_detalhado', 'Objetivo detalhado — impacto operacional', 3)}
        {txt('as_is', 'AS IS — cenário atual')}
        {txt('to_be', 'TO BE — cenário futuro esperado')}
        <Field label="Prioridade (1 = mais alta)"><input className={inp} type="number" min={1} step={1} value={f.prioridade ?? 3} onChange={(e) => set('prioridade', e.target.value)} /></Field>
        <Field label="Responsável"><input className={inp} value={f.responsavel || ''} onChange={(e) => set('responsavel', e.target.value)} /></Field>
        <Field label="Status">
          <select className={inp} value={f.status || 'A Iniciar'} disabled={temEtapas} onChange={(e) => { set('status', e.target.value); if (e.target.value === 'Concluído') set('percentual_concluido', 100) }}>
            {STATUS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="% concluído (0 a 100)"><input className={inp} type="number" min={0} max={100} value={f.percentual_concluido ?? 0} disabled={temEtapas || f.status === 'Concluído'} onChange={(e) => set('percentual_concluido', e.target.value)} /></Field>
        {temEtapas && <p className="text-xs text-violet-700 sm:col-span-2">Status e % são calculados automaticamente a partir das etapas desta atividade.</p>}
        <Field label="Data de início"><input className={inp} type="date" value={f.data_inicio || ''} onChange={(e) => set('data_inicio', e.target.value)} /></Field>
        <Field label="Data de término (prazo)"><input className={inp} type="date" value={f.data_termino || ''} min={f.data_inicio || undefined} onChange={(e) => set('data_termino', e.target.value)} /></Field>
        {(f.status === 'Concluído' || f.data_conclusao) && <Field label="Data de finalização (conclusão real)"><input className={inp} type="date" value={f.data_conclusao || ''} onChange={(e) => set('data_conclusao', e.target.value)} /></Field>}
        {txt('observacoes', 'Observações')}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnG} onClick={onClose}>Cancelar</button>
          <button className={btnP} disabled={busy}>{busy ? 'Salvando…' : f.id ? 'Salvar alterações' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Cadastro/edição de ETAPA (COMO?). */
export function EtapaForm({ init, onClose, onSave }: { init: Partial<Etapa>; onClose: () => void; onSave: (p: Partial<Etapa>) => Promise<string> }) {
  const [f, setF] = useState<Partial<Etapa>>(init)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Etapa, v: any) => setF((p) => ({ ...p, [k]: v }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.como?.trim()) return setErr('Descreva a etapa (COMO?).')
    const pc = Number(f.percentual_concluido) || 0
    if (pc < 0 || pc > 100) return setErr('O percentual deve estar entre 0 e 100.')
    if (f.data_inicio && f.data_termino && f.data_termino < f.data_inicio) return setErr('O término não pode ser anterior ao início.')
    if (f.novo_prazo && f.data_termino && f.novo_prazo < f.data_termino) return setErr('O novo prazo deve ser igual ou posterior ao término original.')
    setBusy(true); setErr('')
    const m = await onSave(f)
    if (m) { setErr(m); setBusy(false) }
  }
  return (
    <Modal title={f.id ? 'Editar etapa' : 'Nova etapa'} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Msg kind="erro">{err}</Msg></div>}
        <Field label="COMO? — descrição da etapa *" className="sm:col-span-2"><input className={inp} value={f.como || ''} onChange={(e) => set('como', e.target.value)} /></Field>
        <Field label="Responsável"><input className={inp} value={f.responsavel || ''} onChange={(e) => set('responsavel', e.target.value)} /></Field>
        <Field label="Status">
          <select className={inp} value={f.status || 'A Iniciar'} onChange={(e) => {
            const v = e.target.value; set('status', v)
            if (v === 'Concluído') { set('percentual_concluido', 100); if (!f.prazo_realizado) set('prazo_realizado', todayStr()) }
          }}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="Início"><input className={inp} type="date" value={f.data_inicio || ''} onChange={(e) => set('data_inicio', e.target.value)} /></Field>
        <Field label="Término"><input className={inp} type="date" value={f.data_termino || ''} min={f.data_inicio || undefined} onChange={(e) => set('data_termino', e.target.value)} /></Field>
        <Field label="Novo prazo (se houve replanejamento)"><input className={inp} type="date" value={f.novo_prazo || ''} min={f.data_termino || undefined} onChange={(e) => set('novo_prazo', e.target.value)} /></Field>
        <Field label="Prazo realizado (quando concluída)"><input className={inp} type="date" value={f.prazo_realizado || ''} onChange={(e) => set('prazo_realizado', e.target.value)} /></Field>
        <Field label="% concluído (0 a 100)"><input className={inp} type="number" min={0} max={100} value={f.percentual_concluido ?? 0} disabled={f.status === 'Concluído'} onChange={(e) => set('percentual_concluido', e.target.value)} /></Field>
        <Field label="Observações" className="sm:col-span-2"><textarea className={inp} rows={2} value={f.observacoes || ''} onChange={(e) => set('observacoes', e.target.value)} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className={btnG} onClick={onClose}>Cancelar</button>
          <button className={btnP} disabled={busy}>{busy ? 'Salvando…' : f.id ? 'Salvar alterações' : 'Adicionar etapa'}</button>
        </div>
      </form>
    </Modal>
  )
}
