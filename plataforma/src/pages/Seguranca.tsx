import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Chip, Empty, Msg } from '../components/ui'

/** Painel de segurança — somente Analista Sr. Mostra o que o agente semanal encontrou e corrigiu e o que ainda precisa de decisão humana. */
interface Exec { id: string; iniciada_em: string; concluida_em: string | null; origem: 'manual' | 'semanal' | 'ia'; total: number; corrigidos: number; pendentes: number; resumo_ia: string | null; modelo_ia: string | null }
interface Achado { id: number; execucao_id: string; severidade: 'alta' | 'media' | 'baixa'; categoria: string; objeto: string | null; descricao: string; recomendacao: string | null; status: 'corrigido' | 'pendente' | 'informativo'; corrigido_em: string | null }
const ORIGEM = { manual: 'Manual', semanal: 'Semanal (automática)', ia: 'Com IA' }
const SEV_COR = { alta: '#dc2626', media: '#d97706', baixa: '#64748b' }
const ST_COR = { corrigido: '#16a34a', pendente: '#dc2626', informativo: '#64748b' }
const ST_NOME = { corrigido: 'Corrigido', pendente: 'Pendente', informativo: 'Informativo' }

export default function Seguranca() {
  const [execs, setExecs] = useState<Exec[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [achados, setAchados] = useState<Achado[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'' | 'manual' | 'ia'>('')
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'corrigido' | 'pendente'>('todos')

  const load = useCallback(async (escolher?: string) => {
    const r = await supabase.from('seguranca_execucoes').select('*').order('iniciada_em', { ascending: false }).limit(20)
    if (r.error) { setErr('Não foi possível carregar: ' + r.error.message + ' (a migração 013 foi executada?)'); setLoading(false); return }
    const lista = (r.data || []) as Exec[]
    setExecs(lista); setErr('')
    const alvo = escolher || sel || lista[0]?.id || null
    setSel(alvo)
    if (alvo) {
      const a = await supabase.from('seguranca_achados').select('*').eq('execucao_id', alvo).order('id')
      setAchados((a.data || []) as Achado[])
    } else setAchados([])
    setLoading(false)
  }, [sel])
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function verificar() {
    setBusy('manual'); setErr(''); setOk('')
    const r = await supabase.rpc('seguranca_verificar', { p_origem: 'manual' })
    setBusy('')
    if (r.error) return setErr(r.error.message)
    setOk('Verificação concluída.'); load(String(r.data))
  }
  async function verificarIA() {
    setBusy('ia'); setErr(''); setOk('')
    const r = await supabase.functions.invoke('agente-seguranca', { body: {} })
    setBusy('')
    const e = (r.data as any)?.error || r.error?.message
    if (e) return setErr('Agente de IA indisponível: ' + e + ' — veja “Como ativar a IA” no README. A verificação automática (sem IA) continua disponível no botão ao lado.')
    setOk('Verificação com IA concluída.'); load((r.data as any)?.execucao_id)
  }
  async function abrir(id: string) {
    setSel(id)
    const a = await supabase.from('seguranca_achados').select('*').eq('execucao_id', id).order('id')
    setAchados((a.data || []) as Achado[])
  }

  const atual = execs.find((e) => e.id === sel) || null
  const lista = achados.filter((a) => (filtro === 'todos' ? true : a.status === filtro)).sort((a, b) => ({ pendente: 0, corrigido: 1, informativo: 2 }[a.status] - { pendente: 0, corrigido: 1, informativo: 2 }[b.status]) || ({ alta: 0, media: 1, baixa: 2 }[a.severidade] - { alta: 0, media: 1, baixa: 2 }[b.severidade]))
  const corrigidosTotal = execs.reduce((s, e) => s + e.corrigidos, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">🛡️ Segurança</h1>
          <p className="text-sm text-slate-500">Agente semanal: verifica o banco, corrige sozinho o que é seguro corrigir e lista o que precisa da sua decisão. Visível só para o Analista Sr.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnG} disabled={!!busy} onClick={verificarIA}>{busy === 'ia' ? 'Analisando…' : '✨ Verificar com IA'}</button>
          <button className={btnP} disabled={!!busy} onClick={verificar}>{busy === 'manual' ? 'Verificando…' : 'Verificar agora'}</button>
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}

      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : execs.length === 0 ? (
        <Card><Empty>Nenhuma verificação registrada ainda. Clique em “Verificar agora” (a verificação semanal automática passa a rodar depois do agendamento descrito no README).</Empty></Card>
      ) : (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="!p-4"><div className="text-xs font-semibold uppercase text-slate-500">Última verificação</div><div className="mt-1 text-lg font-bold text-navy">{fmtDateTime(execs[0].concluida_em || execs[0].iniciada_em)}</div><div className="text-xs text-slate-500">{ORIGEM[execs[0].origem]}</div></Card>
          <Card className="!p-4"><div className="text-xs font-semibold uppercase text-slate-500">Falhas encontradas</div><div className="mt-1 text-3xl font-bold text-navy">{atual?.total ?? 0}</div><div className="text-xs text-slate-500">na verificação selecionada</div></Card>
          <Card className="!p-4"><div className="text-xs font-semibold uppercase text-slate-500">Corrigidas sozinhas</div><div className="mt-1 text-3xl font-bold text-green-600">{atual?.corrigidos ?? 0}</div><div className="text-xs text-slate-500">{corrigidosTotal} no histórico</div></Card>
          <Card className="!p-4"><div className="text-xs font-semibold uppercase text-slate-500">Pendentes (sua decisão)</div><div className={'mt-1 text-3xl font-bold ' + ((atual?.pendentes ?? 0) > 0 ? 'text-red-600' : 'text-green-600')}>{atual?.pendentes ?? 0}</div><div className="text-xs text-slate-500">{(atual?.pendentes ?? 0) > 0 ? 'ver abaixo' : 'nada a fazer'}</div></Card>
        </div>

        {atual?.resumo_ia && (
          <Card className="!border-violet-200 !bg-violet-50/60">
            <h3 className="mb-1 font-bold text-navy">✨ Resumo do agente de IA <span className="text-xs font-normal text-slate-500">{atual.modelo_ia ? `· ${atual.modelo_ia}` : ''}</span></h3>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{atual.resumo_ia}</p>
            <p className="mt-2 text-xs text-slate-500">A IA apenas explica o relatório; as correções automáticas vêm de regras fixas e seguras do banco — ela não executa comandos.</p>
          </Card>
        )}

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-navy">Achados {atual && <span className="text-sm font-normal text-slate-500">· {fmtDateTime(atual.iniciada_em)} · {ORIGEM[atual.origem]}</span>}</h3>
            <div className="flex gap-1.5" role="group" aria-label="Filtrar achados">
              {(['todos', 'pendente', 'corrigido'] as const).map((f) => (
                <button key={f} aria-pressed={filtro === f} onClick={() => setFiltro(f)} className={'rounded-full border px-3 py-1 text-xs font-semibold ' + (filtro === f ? 'border-navy bg-navy text-white' : 'border-violet-300 bg-white text-navy hover:bg-violet-50')}>{f === 'todos' ? 'Todos' : f === 'pendente' ? 'Pendentes' : 'Corrigidos'}</button>
              ))}
            </div>
          </div>
          {lista.length === 0 ? <Empty>Nada nesta visão.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {lista.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color={ST_COR[a.status]}>{ST_NOME[a.status]}</Chip>
                    <Chip color={SEV_COR[a.severidade]}>{a.severidade === 'alta' ? 'Alta' : a.severidade === 'media' ? 'Média' : 'Baixa'}</Chip>
                    <span className="font-semibold text-navy">{a.categoria}</span>
                    {a.objeto && <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{a.objeto}</code>}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{a.descricao}</p>
                  {a.recomendacao && <p className="mt-0.5 text-xs text-slate-500">{a.status === 'corrigido' ? '✔ ' : '➜ '}{a.recomendacao}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-2 font-bold text-navy">Histórico de verificações</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Quando</th><th>Origem</th><th>Achados</th><th>Corrigidos</th><th>Pendentes</th><th /></tr></thead>
              <tbody>
                {execs.map((e) => (
                  <tr key={e.id} className={'border-t border-slate-100 ' + (e.id === sel ? 'bg-violet-50' : '')}>
                    <td className="py-2">{fmtDateTime(e.iniciada_em)}</td><td>{ORIGEM[e.origem]}</td><td>{e.total}</td><td className="text-green-700">{e.corrigidos}</td><td className={e.pendentes ? 'font-bold text-red-600' : ''}>{e.pendentes}</td>
                    <td className="text-right"><button className={btnG + ' ' + btnSm} onClick={() => abrir(e.id)}>Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>)}
    </div>
  )
}
