import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/rules'
import { Card } from './ui'

interface Item { id: number; entidade: 'melhoria' | 'atividade'; entidade_id: string; texto: string; criado_em: string; autor: string; titulo: string; pagina: string }

/** Comentários dos últimos 14 dias em que a pessoa foi mencionada (@nome). Some quando não há nenhum. */
export default function MencoesCard({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { profile } = useAuth()
  const [itens, setItens] = useState<Item[]>([])
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const desde = new Date(Date.now() - 14 * 86400000).toISOString()
      const r = await supabase.from('comentarios').select('id,entidade,entidade_id,texto,criado_em,autor_id').contains('mencoes', [profile!.id]).gte('criado_em', desde).order('criado_em', { ascending: false }).limit(10)
      if (r.error || !r.data?.length || !vivo) return
      const ids = (t: string) => r.data!.filter((c: any) => c.entidade === t).map((c: any) => c.entidade_id)
      const [m, a, p] = await Promise.all([
        ids('melhoria').length ? supabase.from('backlog_melhorias').select('id,melhoria,tipo_backlog').in('id', ids('melhoria')) : Promise.resolve({ data: [] as any[] }),
        ids('atividade').length ? supabase.from('microdeliveries').select('id,demanda').in('id', ids('atividade')) : Promise.resolve({ data: [] as any[] }),
        supabase.from('profiles').select('id,nome').in('id', [...new Set(r.data.map((c: any) => c.autor_id))]),
      ])
      if (!vivo) return
      setItens(r.data.map((c: any) => {
        const mel = (m.data || []).find((x: any) => x.id === c.entidade_id), ati = (a.data || []).find((x: any) => x.id === c.entidade_id)
        return { id: c.id, entidade: c.entidade, entidade_id: c.entidade_id, texto: c.texto, criado_em: c.criado_em, autor: (p.data || []).find((x: any) => x.id === c.autor_id)?.nome || 'Alguém',
          titulo: mel?.melhoria || ati?.demanda || '(item removido)', pagina: c.entidade === 'atividade' ? 'micro' : mel?.tipo_backlog === 'correcao' ? 'backlog' : 'melhorias' }
      }))
    })()
    return () => { vivo = false }
  }, [profile])
  if (!itens.length) return null
  return (
    <Card className="!border-violet-300 !bg-violet-50/60">
      <h3 className="mb-2 font-bold text-navy">Você foi mencionado ({itens.length})</h3>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li key={i.id} className="rounded-xl bg-white px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">{i.autor} · {fmtDateTime(i.criado_em)} · em <button className="font-semibold text-navy underline" onClick={() => onNavigate?.(i.pagina)}>{i.titulo}</button></div>
            <p className="mt-0.5 line-clamp-2 text-slate-700">{i.texto}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
