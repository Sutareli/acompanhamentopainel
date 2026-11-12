import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, fmtDate, todayStr } from '../lib/rules'
import { btnG, btnP, btnSm, Chip, Msg } from './ui'

export interface TarefaPainel { id: string; descricao: string; concluida: boolean }
export interface BlocoPainel { id: string; numero: number; nome: string; daily_tasks: TarefaPainel[] }

/**
 * Transfere tarefas do Painel para Projetos (microprojetos). Cada tarefa vira UM microprojeto com os padrões:
 * criticidade média · data target = dia seguinte · status A iniciar (1 unidade) · responsável = quem está logado.
 */
export default function EnviarProjetos({ blocos, data, uid, onClose, onDone, onNavigate }: {
  blocos: BlocoPainel[]; data: string; uid: string; onClose: () => void; onDone: () => void; onNavigate?: (p: string) => void
}) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [remover, setRemover] = useState(false)
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState<number | null>(null)
  const alvo = addDays(todayStr(), 1)
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

  useEffect(() => {
    supabase.from('microdeliveries').select('demanda').eq('responsavel_id', uid).then((r) => {
      setExistentes(new Set(((r.data || []) as { demanda: string }[]).map((x) => norm(x.demanda))))
    })
  }, [uid])

  const todas = useMemo(() => blocos.flatMap((b) => b.daily_tasks.map((t) => ({ ...t, bloco: b }))).filter((t) => t.descricao.trim()), [blocos])
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const escolhidas = todas.filter((t) => sel.has(t.id))

  async function enviar() {
    if (!escolhidas.length) return
    setBusy(true); setErr('')
    const linhas = escolhidas.map((t) => ({
      criticidade: 'media', responsavel_id: uid, criado_por: uid, demanda: t.descricao.trim().slice(0, 300), data_target: alvo,
      quantidade: 1, a_iniciar: 1, em_andamento: 0, concluido: 0, cancelado: 0, tipo_projeto: 'micro',
      observacoes: `Criado a partir do Painel (${t.bloco.nome}, ${fmtDate(data)}).`,
    }))
    const r = await supabase.from('microdeliveries').insert(linhas).select('id')   // uma requisição: entra tudo ou nada
    if (r.error) { setBusy(false); return setErr('Não foi possível criar os projetos: ' + r.error.message) }
    if (remover) {
      const d = await supabase.from('daily_tasks').delete().in('id', escolhidas.map((t) => t.id))
      if (d.error) setErr('Os projetos foram criados, mas não consegui remover as tarefas do Painel: ' + d.error.message)
    }
    setBusy(false); setOk(escolhidas.length); onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Enviar tarefas para Projetos" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {ok !== null ? (<>
          <h3 className="mb-2 text-lg font-bold text-navy">✅ {ok} projeto(s) criado(s)</h3>
          <p className="mb-4 text-sm text-slate-600">Eles já estão em <b>Projetos</b> como <b>microprojeto</b>, criticidade <b>Média</b>, status <b>A iniciar</b> e data target <b>{fmtDate(alvo)}</b>.</p>
          {err && <Msg kind="aviso">{err}</Msg>}
          <div className="flex justify-end gap-2">
            <button className={btnG} onClick={onClose}>Fechar</button>
            {onNavigate && <button className={btnP} onClick={() => { onClose(); onNavigate('micro') }}>Ver em Projetos</button>}
          </div>
        </>) : (<>
          <h3 className="mb-1 text-lg font-bold text-navy">📦 Enviar tarefas para Projetos</h3>
          <p className="mb-3 text-sm text-slate-600">Marque as tarefas de {fmtDate(data)}. Cada uma vira um <b>microprojeto</b> com: criticidade <b>Média</b> · status <b>A iniciar</b> · data target <b>{fmtDate(alvo)}</b> (dia seguinte) · você como responsável.</p>
          {todas.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Não há tarefas neste dia.</p> : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <div className="flex gap-2">
                <button type="button" className={btnG + ' ' + btnSm} onClick={() => setSel(new Set(todas.filter((t) => !t.concluida).map((t) => t.id)))}>Marcar pendentes</button>
                <button type="button" className={btnG + ' ' + btnSm} onClick={() => setSel(new Set())}>Limpar seleção</button>
              </div>
              {blocos.filter((b) => b.daily_tasks.some((t) => t.descricao.trim())).map((b) => (
                <div key={b.id}>
                  <div className="mb-1 text-xs font-bold uppercase text-slate-500">Bloco {b.numero} · {b.nome}</div>
                  <ul className="space-y-1">
                    {b.daily_tasks.filter((t) => t.descricao.trim()).map((t) => (
                      <li key={t.id}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-violet-50">
                          <input type="checkbox" className="mt-1" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                          <span className={'flex-1 ' + (t.concluida ? 'text-slate-400 line-through' : '')}>{t.descricao}</span>
                          {existentes.has(norm(t.descricao)) && <Chip color="#d97706">já existe em Projetos</Chip>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" className="mt-1" checked={remover} onChange={(e) => setRemover(e.target.checked)} />
            <span>Remover as tarefas enviadas do Painel (transferir). Desmarcado, elas ficam no Painel também (copiar).</span>
          </label>
          {err && <div className="mt-2"><Msg kind="erro">{err}</Msg></div>}
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnG} onClick={onClose}>Cancelar</button>
            <button className={btnP} disabled={!escolhidas.length || busy} onClick={enviar}>{busy ? 'Enviando…' : `Enviar ${escolhidas.length || ''} para Projetos`}</button>
          </div>
        </>)}
      </div>
    </div>
  )
}
