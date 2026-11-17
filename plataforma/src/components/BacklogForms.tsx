import { FormEvent, useState } from 'react'
import { btnG, btnP, Field, inp, Modal, Msg } from './ui'
import { Etapa, FASE_INFO, FASES, Melhoria, STATUS, faseDe, faseIdx } from '../lib/backlog'
import { todayStr } from '../lib/rules'
import { useAuth } from '../auth/AuthContext'
import { podeAjustarSla, SLA_PADRAO } from '../lib/sla'

const MODULOS_SUGERIDOS = ['Gestão Executiva', 'Tabelas', 'Meus Feedback', 'Todos os módulos']

/** Cadastro/edição da ATIVIDADE (melhoria). Com etapas, status e % são calculados por elas e ficam bloqueados. */
export function MelhoriaForm({ init, modulos, temEtapas, funil = false, usuarios = [], onClose, onSave }: {
  init: Partial<Melhoria>; modulos: string[]; temEtapas: boolean; funil?: boolean; usuarios?: { id: string; nome: string }[]; onClose: () => void; onSave: (p: Partial<Melhoria>) => Promise<string>
}) {
  const { profile } = useAuth()
  const podeSla = podeAjustarSla(profile?.perfil)
  const [f, setF] = useState<Partial<Melhoria>>(funil ? { ...init, fase: faseDe({ fase: init.fase, status: init.status || 'A Iniciar' }) } : init)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Melhoria, v: any) => setF((p) => ({ ...p, [k]: v }))
  const fi = faseIdx(f.fase)
  const emDevForm = fi === 4 || fi === 5
  const ATIVOS = ['Em andamento', 'Atrasado', 'Novo Prazo']
  /** Em funil, o status segue a etapa: antes do desenvolvimento = A Iniciar · desenvolvimento/homologação = em andamento (ou Atrasado/Novo Prazo) · produção = Concluído. */
  function mudarFase(k: string) {
    setF((p) => {
      const i = faseIdx(k)
      const status = i < 4 ? 'A Iniciar' : i <= 5 ? (ATIVOS.includes(p.status || '') ? p.status : 'Em andamento') : 'Concluído'
      return { ...p, fase: k as any, status: status as any, percentual_concluido: status === 'Concluído' ? 100 : status === 'A Iniciar' ? 0 : p.percentual_concluido }
    })
  }
  const txt = (k: keyof Melhoria, label: string, rows = 2) => (
    <Field label={label} className="sm:col-span-2"><textarea className={inp} rows={rows} value={(f[k] as string) || ''} onChange={(e) => set(k, e.target.value)} /></Field>
  )
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.modulo?.trim()) return setErr('Informe o módulo.')
    if (!f.melhoria?.trim()) return setErr('Informe o nome da melhoria.')
    const pc = Number(f.percentual_concluido) || 0
    if (!funil && (pc < 0 || pc > 100)) return setErr('O percentual deve estar entre 0 e 100.')
    if ((Number(f.prioridade) || 0) < 1) return setErr('A prioridade deve ser 1 ou maior (1 = mais alta).')
    if (f.data_inicio && f.data_termino && f.data_termino < f.data_inicio) return setErr('O término não pode ser anterior ao início.')
    if (funil) {
      if (!f.responsavel_id) return setErr('Defina o responsável pela melhoria (usuário da plataforma).')
      if (podeSla) { const a = Number(f.sla_chamado_dias_uteis ?? SLA_PADRAO.chamado_dias_uteis), b = Number(f.sla_dev_dias_corridos ?? SLA_PADRAO.dev_dias_corridos)
        if (!Number.isInteger(a) || a < 1 || a > 60) return setErr('SLA chamado → desenvolvimento: informe de 1 a 60 dias úteis.')
        if (!Number.isInteger(b) || b < 1 || b > 365) return setErr('SLA desenvolvimento → homologação: informe de 1 a 365 dias corridos.') }
      const seq = [['Ideia', f.data_ideia], ['Priorização', f.data_priorizacao], ['Especificação', f.data_especificacao], ['Abertura do chamado', f.data_abertura], ['Início do desenvolvimento', f.data_inicio], ['Homologação', f.data_homologacao], ['Produção', f.fase === 'producao' ? f.data_conclusao : null]] as [string, string | null | undefined][]
      const dd = seq.filter(([, d]) => !!d) as [string, string][]
      for (let i = 1; i < dd.length; i++) if (dd[i][1] < dd[i - 1][1]) return setErr(`A data de “${dd[i][0]}” não pode ser anterior à de “${dd[i - 1][0]}”.`)
    }
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
        {funil
          ? <Field label="Responsável pela melhoria (usuário da plataforma) *"><select className={inp} value={f.responsavel_id || ''} onChange={(e) => { const u = usuarios.find((x) => x.id === e.target.value); setF((p) => ({ ...p, responsavel_id: e.target.value || null, responsavel: u?.nome || null })) }}>
              <option value="">Selecione…</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}{f.responsavel_id && !usuarios.some((u) => u.id === f.responsavel_id) && <option value={f.responsavel_id}>{f.responsavel || '(usuário inativo)'}</option>}
            </select></Field>
          : <Field label="Responsável"><input className={inp} value={f.responsavel || ''} onChange={(e) => set('responsavel', e.target.value)} /></Field>}
        {funil && (
          <Field label="Etapa do processo" className="sm:col-span-2">
            <select className={inp} value={f.fase || 'ideia'} onChange={(e) => mudarFase(e.target.value)}>
              {FASES.map((k, i) => <option key={k} value={k}>{i + 1}. {FASE_INFO[i].icon} {FASE_INFO[i].label}</option>)}
            </select>
          </Field>
        )}
        {funil && <p className="text-xs text-slate-500 sm:col-span-2">O andamento (%) acompanha a etapa do funil: Ideia 0% · Priorização 17% · Especificação 33% · Chamado aberto 50% · Desenvolvimento 67% · Homologação 83% · Produção 100%.</p>}
        {funil && emDevForm && (
          <Field label="Situação do desenvolvimento"><select className={inp} value={f.status || 'Em andamento'} disabled={temEtapas} onChange={(e) => set('status', e.target.value)}>{ATIVOS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        )}
        {!funil && <Field label="Status">
          <select className={inp} value={f.status || 'A Iniciar'} disabled={temEtapas} onChange={(e) => { set('status', e.target.value); if (e.target.value === 'Concluído') set('percentual_concluido', 100) }}>
            {STATUS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>}
        {!funil && <Field label="% concluído (0 a 100)"><input className={inp} type="number" min={0} max={100} value={f.percentual_concluido ?? 0} disabled={temEtapas || f.status === 'Concluído'} onChange={(e) => set('percentual_concluido', e.target.value)} /></Field>}
        {temEtapas && <p className="text-xs text-violet-700 sm:col-span-2">Status e % são calculados automaticamente a partir das etapas desta atividade.</p>}
        {funil && (<>
          <p className="text-xs font-bold uppercase tracking-wide text-violet-700 sm:col-span-2">Datas das etapas do processo</p>
          <Field label="💡 Ideia registrada em"><input className={inp} type="date" value={f.data_ideia || ''} onChange={(e) => set('data_ideia', e.target.value)} /></Field>
          <Field label="🗳️ Priorização em reunião em"><input className={inp} type="date" value={f.data_priorizacao || ''} disabled={fi < 1 && !f.data_priorizacao} onChange={(e) => set('data_priorizacao', e.target.value)} /></Field>
          <Field label="📝 Especificação concluída em"><input className={inp} type="date" value={f.data_especificacao || ''} disabled={fi < 2 && !f.data_especificacao} onChange={(e) => set('data_especificacao', e.target.value)} /></Field>
          <Field label="🎫 Chamado aberto em"><input className={inp} type="date" value={f.data_abertura || ''} max={todayStr()} disabled={fi < 3 && !f.data_abertura} onChange={(e) => set('data_abertura', e.target.value)} /></Field>
          <Field label="Nº do chamado"><input className={inp} value={f.numero_chamado || ''} maxLength={60} placeholder="ex.: CH-12345" disabled={fi < 3 && !f.numero_chamado} onChange={(e) => set('numero_chamado', e.target.value)} /></Field>
        </>)}
        <Field label={funil ? '🛠️ Desenvolvimento iniciado em' : 'Data de início'}><input className={inp} type="date" value={f.data_inicio || ''} disabled={funil && fi < 4 && !f.data_inicio} onChange={(e) => set('data_inicio', e.target.value)} /></Field>
        {funil && <Field label="🧪 Homologação iniciada em"><input className={inp} type="date" value={f.data_homologacao || ''} disabled={fi < 5 && !f.data_homologacao} onChange={(e) => set('data_homologacao', e.target.value)} /></Field>}
        <Field label={funil ? 'Prazo de entrega previsto' : 'Data de término (prazo)'}><input className={inp} type="date" value={f.data_termino || ''} min={f.data_inicio || undefined} onChange={(e) => set('data_termino', e.target.value)} /></Field>
        {funil && (<>
          <Field label="⏱ SLA: chamado aberto → desenvolvimento (dias úteis)"><input className={inp} type="number" min={1} max={60} disabled={!podeSla} value={f.sla_chamado_dias_uteis ?? SLA_PADRAO.chamado_dias_uteis} onChange={(e) => set('sla_chamado_dias_uteis', e.target.value as any)} /></Field>
          <Field label="⏱ SLA: desenvolvimento → homologação (dias corridos)"><input className={inp} type="number" min={1} max={365} disabled={!podeSla} value={f.sla_dev_dias_corridos ?? SLA_PADRAO.dev_dias_corridos} onChange={(e) => set('sla_dev_dias_corridos', e.target.value as any)} /></Field>
          <p className="-mt-1 text-xs text-slate-500 sm:col-span-2">{podeSla ? 'SLA próprio desta melhoria (padrão 3 dias úteis e 15 dias corridos). Só Analista Sr e Gerente alteram; os feriados cadastrados em Configurações são descontados.' : '🔒 O SLA desta melhoria só pode ser alterado por Analista Sr e Gerente.'}</p>
        </>)}
        {(funil ? f.fase === 'producao' : f.status === 'Concluído' || f.data_conclusao) && <Field label={funil ? '✅ Em produção desde' : 'Data de finalização (conclusão real)'}><input className={inp} type="date" value={f.data_conclusao || ''} onChange={(e) => set('data_conclusao', e.target.value)} /></Field>}
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
