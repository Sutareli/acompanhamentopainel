import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Melhoria, melhoriaVencida, vencida } from '../lib/backlog'
import { slaAtrasado } from '../lib/sla'
import { fmtDate, todayStr } from '../lib/rules'
import { Card, Empty, Msg } from '../components/ui'
import MencoesCard from '../components/MencoesCard'

interface Micro { id: string; demanda: string; tipo_projeto: 'macro' | 'micro'; data_target: string; quantidade: number; concluido: number; cancelado: number; responsavel_id: string }
interface Grupo { chave: string; icone: string; titulo: string; dica: string; pagina: string; itens: { id: string; txt: string; sub: string }[] }

/** “O que precisa de atenção” — painel inicial para Diretor, Gerente e Analista Sr. Cada cartão leva à tela correspondente. */
export default function Atencao({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [mel, setMel] = useState<Melhoria[] | null>(null)
  const [mic, setMic] = useState<Micro[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const hoje = todayStr()
  useEffect(() => {
    ;(async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('backlog_melhorias').select('*'),
        supabase.from('microdeliveries').select('id,demanda,tipo_projeto,data_target,quantidade,concluido,cancelado,responsavel_id').lt('data_target', hoje),
        supabase.from('profiles').select('id,nome'),
      ])
      if (a.error || b.error) return setErr('Não foi possível carregar: ' + (a.error?.message || b.error?.message))
      setMel((a.data || []) as Melhoria[]); setMic(((b.data || []) as Micro[]).filter((m) => m.quantidade - m.concluido - m.cancelado > 0))
      setNomes(Object.fromEntries(((c.data || []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome])))
    })()
  }, [hoje])

  const grupos: Grupo[] = useMemo(() => {
    if (!mel) return []
    const ideias = mel.filter((m) => m.tipo_backlog === 'melhoria'), corr = mel.filter((m) => m.tipo_backlog === 'correcao')
    const dias = (d: string | null | undefined) => (d ? Math.round((Date.parse(hoje) - Date.parse(d)) / 86400000) : 0)
    const resp = (m: Melhoria) => (m.responsavel_id && nomes[m.responsavel_id]) || m.responsavel || 'sem responsável'
    return [
      { chave: 'pv', icone: '', titulo: 'Melhorias com prazo vencido', dica: 'Prazo de entrega passou e ainda não está em Produção.', pagina: 'melhorias',
        itens: ideias.filter((m) => vencida(m, hoje)).sort((a, b) => (a.data_termino! < b.data_termino! ? -1 : 1)).map((m) => ({ id: m.id, txt: m.melhoria, sub: `${resp(m)} · atrasada há ${dias(m.data_termino)} dia(s)` })) },
      { chave: 'sla', icone: '', titulo: 'Melhorias com SLA vencido', dica: 'Chamado aberto sem iniciar o desenvolvimento, ou desenvolvimento além do SLA.', pagina: 'melhorias',
        itens: ideias.filter((m) => slaAtrasado(m, hoje)).map((m) => ({ id: m.id, txt: m.melhoria, sub: `${resp(m)} · etapa ${m.fase === 'chamado_aberto' ? 'Chamado aberto' : 'Desenvolvimento'}` })) },
      { chave: 'sr', icone: '', titulo: 'Melhorias sem responsável', dica: 'Nenhum usuário definido como responsável.', pagina: 'melhorias',
        itens: ideias.filter((m) => !m.responsavel_id && m.fase !== 'producao').map((m) => ({ id: m.id, txt: m.melhoria, sub: `${m.modulo} · criada em ${fmtDate(m.criado_em.slice(0, 10))}` })) },
      { chave: 'cv', icone: '', titulo: 'Correção/manutenção com prazo vencido', dica: 'Atividades de correção/manutenção que passaram do prazo e não foram concluídas.', pagina: 'backlog',
        itens: corr.filter((m) => melhoriaVencida(m, hoje)).sort((a, b) => (a.data_termino! < b.data_termino! ? -1 : 1)).map((m) => ({ id: m.id, txt: m.melhoria, sub: `${resp(m)} · atrasada há ${dias(m.data_termino)} dia(s)` })) },
      { chave: 'at', icone: '', titulo: 'Projetos e atividades com data target vencida', dica: 'Ainda há unidades a iniciar ou em andamento depois da data target.', pagina: 'micro',
        itens: mic.sort((a, b) => (a.data_target < b.data_target ? -1 : 1)).map((m) => ({ id: m.id, txt: m.demanda, sub: `${nomes[m.responsavel_id] || '—'} · ${m.tipo_projeto === 'macro' ? 'Projeto' : 'Atividade'} · venceu em ${fmtDate(m.data_target)}` })) },
    ]
  }, [mel, mic, nomes, hoje])

  const total = grupos.reduce((a, g) => a + g.itens.length, 0)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">O que precisa de atenção</h1>
        <p className="text-sm text-slate-500">Visão rápida do que está atrasado ou sem dono hoje ({fmtDate(hoje)}). Clique em um cartão para abrir a tela e tratar.</p>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      <MencoesCard onNavigate={onNavigate} />
      {!mel ? <p className="py-10 text-center text-slate-500">Carregando…</p> : (<>
        {total === 0 && <Msg kind="ok">Tudo em dia: nenhum prazo vencido, SLA estourado ou item sem responsável.</Msg>}
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {grupos.map((g) => (
            <Card key={g.chave} className="!p-4">
              <button className="w-full text-left" onClick={() => onNavigate(g.pagina)} title={g.dica}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-600">{g.titulo}</div>
                  <div className={'text-3xl font-semibold ' + (g.itens.length ? 'text-red-700' : 'text-slate-300')}>{g.itens.length}</div>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">{g.dica}</p>
              </button>
              {g.itens.length === 0 ? <p className="mt-2 text-xs text-slate-500">Nada pendente.</p> : (
                <ul className="mt-2 space-y-1">
                  {g.itens.slice(0, 5).map((i) => <li key={i.id} className="rounded-lg bg-slate-50 px-2 py-1 text-xs"><div className="truncate font-semibold text-navy" title={i.txt}>{i.txt}</div><div className="truncate text-slate-500">{i.sub}</div></li>)}
                  {g.itens.length > 5 && <li><button className="text-xs font-semibold text-violet-700 underline" onClick={() => onNavigate(g.pagina)}>ver os outros {g.itens.length - 5}</button></li>}
                </ul>
              )}
            </Card>
          ))}
        </div>
        {mel.length === 0 && <Empty>Ainda não há melhorias cadastradas.</Empty>}
      </>)}
    </div>
  )
}
