import { supabase } from './supabase'
import { DEFAULT_BLOCKS } from './rules'
import { loadSettings } from './settings'

/**
 * Garante que existe o registro do dia (daily_records + 5 blocos + tarefas).
 * Se houver um dia anterior, copia nomes, durações e tarefas dele (sem marcações);
 * caso contrário (primeiro acesso de um usuário novo) cria os 5 blocos SEM atividades: cada pessoa monta a própria lista.
 * Nunca sobrescreve um dia existente.
 */
export async function ensureDay(uid: string, date: string) {
  const sel = () => supabase.from('daily_records').select('*').eq('user_id', uid).eq('data', date).maybeSingle()
  const cur = await sel()
  if (cur.error) throw new Error(cur.error.message)
  if (cur.data) return cur.data

  let tpl: { numero: number; nome: string; min: number; tasks: { descricao: string; grupo?: string | null }[] }[] =
    DEFAULT_BLOCKS.map((b, i) => ({ numero: i + 1, nome: b.nome, min: b.min, tasks: [] }))

  // Copia a estrutura do dia anterior MAIS RECENTE QUE TENHA TAREFAS (se o usuário apagou a lista de um dia, o próximo não nasce vazio).
  const prevs = await supabase.from('daily_records').select('id').eq('user_id', uid).lt('data', date).order('data', { ascending: false }).limit(10)
  for (const prev of prevs.data || []) {
    const pb = await supabase.from('daily_blocks')
      .select('numero,nome,duracao_planejada_min,daily_tasks(descricao,grupo,ordem,idea_id,futura_id)')
      .eq('daily_record_id', prev.id).order('numero')
    if (pb.data && pb.data.length === 5) {
      const cand = pb.data.map((b: any) => ({
        numero: b.numero, nome: b.nome, min: b.duracao_planejada_min,
        tasks: [...b.daily_tasks].sort((x: any, y: any) => x.ordem - y.ordem).filter((t: any) => !t.idea_id && !t.futura_id)
          .map((t: any) => ({ descricao: t.descricao, grupo: t.grupo })),
      }))
      if (cand.some((b) => b.tasks.length > 0)) { tpl = cand; break }
    }
  }

  const config = await loadSettings(uid)
  const ins = await supabase.from('daily_records').insert({ user_id: uid, data: date, config }).select().single()
  if (ins.error) {
    const again = await sel() // outra aba pode ter criado o dia no mesmo instante
    if (again.data) return again.data
    throw new Error(ins.error.message)
  }
  const rb = await supabase.from('daily_blocks')
    .insert(tpl.map((b) => ({ user_id: uid, daily_record_id: ins.data.id, numero: b.numero, nome: b.nome, duracao_planejada_min: b.min })))
    .select('id,numero')
  if (rb.error) throw new Error(rb.error.message)
  const rows = tpl.flatMap((b) => {
    const id = rb.data.find((x: any) => x.numero === b.numero)!.id
    return b.tasks.map((t, i) => ({ user_id: uid, block_id: id, descricao: t.descricao, grupo: t.grupo || null, ordem: i }))
  })
  if (rows.length) {
    const rt = await supabase.from('daily_tasks').insert(rows)
    if (rt.error) throw new Error(rt.error.message)
  }
  return ins.data
}
