import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { addDays, DEFAULT_BLOCKS, fmtDate, todayStr } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Chip, Empty, Field, inp, Msg } from '../components/ui'
import { confirmar } from '../components/Confirm'

interface Pessoa { id: string; nome: string; perfil: string }
interface Fixa { id: string; analista_id: string; descricao: string; bloco_numero: number; dias: number[]; data_inicio: string; data_fim: string | null; ativa: boolean }
interface Reg { fixa_id: string; concluida: boolean; concluida_em: string | null; data: string }

const DIAS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [7, 'Dom']] as const
const JANELA = 14   // dias de histórico usados no acompanhamento

/** Atividades fixas por pessoa: o Analista Sr define; no To do diário da pessoa elas aparecem travadas (só marcar como feita). */
export default function AtividadesFixas({ somenteLeitura = false }: { somenteLeitura?: boolean }) {
  const { profile } = useAuth()
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [fixas, setFixas] = useState<Fixa[]>([])
  const [regs, setRegs] = useState<Reg[]>([])
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [quem, setQuem] = useState('')            // id da pessoa, ou 'todos'
  const [desc, setDesc] = useState(''); const [bloco, setBloco] = useState(1)
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5])
  const [ini, setIni] = useState(todayStr()); const [fim, setFim] = useState('')
  const hoje = todayStr()

  const load = useCallback(async () => {
    const [p, f, r] = await Promise.all([
      supabase.from('profiles').select('id,nome,perfil').eq('ativo', true).order('nome'),
      supabase.from('atividades_fixas').select('*').order('criado_em'),
      supabase.from('daily_tasks').select('fixa_id,concluida,concluida_em,daily_blocks!inner(daily_records!inner(data))').not('fixa_id', 'is', null).gte('daily_blocks.daily_records.data', addDays(hoje, -JANELA)),
    ])
    if (p.error || f.error) { setErr('Não foi possível carregar: ' + (p.error || f.error)!.message + ' (a migração 030 foi executada?)'); return }
    setPessoas((p.data || []) as Pessoa[]); setFixas((f.data || []) as Fixa[])
    setRegs((r.data || []).map((x: any) => ({ fixa_id: x.fixa_id, concluida: x.concluida, concluida_em: x.concluida_em, data: x.daily_blocks?.daily_records?.data })).filter((x: Reg) => x.data))
    setErr('')
  }, [hoje])
  useEffect(() => { load() }, [load])

  async function adicionar() {
    const d = desc.trim()
    if (!d) { setErr('Escreva a atividade.'); return }
    if (!quem) { setErr('Escolha para quem é a atividade.'); return }
    if (!dias.length) { setErr('Marque ao menos um dia da semana.'); return }
    if (fim && fim < ini) { setErr('A data final não pode ser anterior ao início.'); return }
    const alvo = quem === 'todos' ? pessoas.filter((x) => x.perfil === 'analista' || x.perfil === 'guardiao').map((x) => x.id) : [quem]
    if (!alvo.length) { setErr('Não há analistas ativos para receber a atividade.'); return }
    const r = await supabase.from('atividades_fixas').insert(alvo.map((id) => ({ analista_id: id, descricao: d, bloco_numero: bloco, dias, data_inicio: ini, data_fim: fim || null, criado_por: profile!.id })))
    if (r.error) { setErr('Não foi possível salvar: ' + r.error.message); return }
    setDesc(''); setOk(alvo.length > 1 ? `Atividade criada para ${alvo.length} pessoas. Ela aparece no To do diário de cada uma a partir do próximo acesso.` : 'Atividade criada. Ela aparece no To do diário da pessoa a partir do próximo acesso.'); setErr(''); load()
  }
  async function alternar(f: Fixa) {
    const r = await supabase.from('atividades_fixas').update({ ativa: !f.ativa }).eq('id', f.id)
    if (r.error) setErr('Não foi possível alterar: ' + r.error.message); else load()
  }
  async function excluir(f: Fixa) {
    if (!(await confirmar({ titulo: 'Excluir esta atividade fixa?', mensagem: <>“{f.descricao}” deixa de ser criada nos próximos dias. As tarefas já criadas continuam nos To dos, mas passam a ser editáveis pela pessoa.</>, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('atividades_fixas').delete().eq('id', f.id)
    if (r.error) setErr('Não foi possível excluir: ' + r.error.message); else load()
  }

  const porPessoa = useMemo(() => pessoas.map((p) => ({ p, itens: fixas.filter((f) => f.analista_id === p.id) })).filter((x) => x.itens.length), [pessoas, fixas])
  const situacaoHoje = (f: Fixa) => {
    const h = regs.find((r) => r.fixa_id === f.id && r.data === hoje)
    if (h) return h.concluida ? <Chip color="#2f7a4d">Feita hoje</Chip> : <Chip color="#a9690b">Pendente hoje</Chip>
    const vigente = f.ativa && f.data_inicio <= hoje && (!f.data_fim || f.data_fim >= hoje) && f.dias.includes(new Date(hoje + 'T12:00:00').getDay() || 7)
    return <span className="text-xs text-slate-400">{vigente ? 'Ainda não abriu o To do hoje' : 'Não se aplica hoje'}</span>
  }
  const resumo = (f: Fixa) => { const r = regs.filter((x) => x.fixa_id === f.id); return r.length ? `${r.filter((x) => x.concluida).length} de ${r.length}` : '—' }

  return (
    <div className="space-y-4">
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      {!somenteLeitura && <Card>
        <h2 className="mb-1 font-semibold text-ink">Nova atividade fixa</h2>
        <p className="mb-3 text-sm text-slate-500">Aparece no To do diário da pessoa, no bloco escolhido e nos dias marcados. Ela só consegue marcar como feita; não edita, não move e não exclui.</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Para quem" className="md:col-span-1">
            <select className={inp} value={quem} onChange={(e) => setQuem(e.target.value)}>
              <option value="">Escolha…</option>
              <option value="todos">Todos os analistas e guardiões</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </Field>
          <Field label="Atividade" className="md:col-span-2"><input className={inp} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Conferir fila de chamados antes das 10h" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar() } }} /></Field>
          <Field label="Bloco do dia"><select className={inp} value={bloco} onChange={(e) => setBloco(Number(e.target.value))}>{DEFAULT_BLOCKS.map((b, i) => <option key={i} value={i + 1}>{i + 1}. {b.nome}</option>)}</select></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <fieldset><legend className="mb-1 text-xs text-slate-600">Dias da semana</legend>
            <div className="flex gap-1">{DIAS.map(([n, l]) => (
              <button type="button" key={n} aria-pressed={dias.includes(n)} onClick={() => setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()))}
                className={'rounded-md border px-2.5 py-1 text-xs font-medium ' + (dias.includes(n) ? 'border-navy bg-navy text-white' : 'border-slate-300 bg-white text-slate-600')}>{l}</button>))}</div>
          </fieldset>
          <Field label="Vale a partir de"><input type="date" className={inp + ' !w-auto'} value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
          <Field label="Até (opcional)"><input type="date" className={inp + ' !w-auto'} value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          <button className={btnP} onClick={adicionar}>Adicionar atividade</button>
        </div>
      </Card>}
      {somenteLeitura && <Msg kind="aviso">Somente consulta: só o Analista Sr cria, pausa ou exclui atividades fixas.</Msg>}

      {porPessoa.length === 0 ? <Card><Empty>Nenhuma atividade fixa cadastrada.</Empty></Card> : porPessoa.map(({ p, itens }) => (
        <Card key={p.id} className="!p-0 overflow-x-auto">
          <h3 className="border-b border-linha px-5 py-3 font-semibold text-ink">{p.nome}</h3>
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="px-5 py-2 font-medium">Atividade</th><th className="font-medium">Bloco</th><th className="font-medium">Dias</th><th className="font-medium">Vigência</th><th className="font-medium">Hoje</th><th className="font-medium" title={`Feitas / registradas nos últimos ${JANELA} dias (só conta os dias em que a pessoa abriu o To do)`}>Últimos {JANELA} dias</th><th /></tr></thead>
            <tbody>
              {itens.map((f) => (
                <tr key={f.id} className={'border-t border-linha ' + (f.ativa ? '' : 'text-slate-400')}>
                  <td className="px-5 py-2">{f.descricao}{!f.ativa && <span className="ml-2 text-xs">(pausada)</span>}</td>
                  <td>{f.bloco_numero}. {DEFAULT_BLOCKS[f.bloco_numero - 1]?.nome}</td>
                  <td>{f.dias.length === 5 && f.dias.every((d) => d <= 5) ? 'Seg a sex' : DIAS.filter(([n]) => f.dias.includes(n)).map(([, l]) => l).join(', ')}</td>
                  <td>{fmtDate(f.data_inicio)}{f.data_fim ? ` a ${fmtDate(f.data_fim)}` : ' em diante'}</td>
                  <td>{situacaoHoje(f)}</td>
                  <td>{resumo(f)}</td>
                  <td className="whitespace-nowrap pr-4 text-right">{!somenteLeitura && <><button className={btnG + ' ' + btnSm} onClick={() => alternar(f)}>{f.ativa ? 'Pausar' : 'Reativar'}</button> <button className={btnG + ' ' + btnSm} onClick={() => excluir(f)}>Excluir</button></>}</td>
                </tr>))}
            </tbody>
          </table>
        </Card>))}
    </div>
  )
}
