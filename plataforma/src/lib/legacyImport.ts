import { supabase } from './supabase'
import type { Settings } from './settings'

/** Importa o backup JSON do painel antigo (HTML/LocalStorage). Nunca sobrescreve dados existentes. */

interface LTask { descricao: string; grupo: string | null; done: boolean; at: string | null }
interface LBlock { numero: number; nome: string; min: number; notes: string | null; tasks: LTask[] }
export interface LDay { date: string; blocks: LBlock[]; meet: any[]; imp: any[]; prep: string | null; tempo: number }
export interface Legacy { days: LDay[]; ideas: any[]; settings: Settings }

const CRIT: Record<string, string> = { 'Crítica': 'critica', 'Alta': 'alta', 'Média': 'media', 'Baixa': 'baixa' }
const IMPST: Record<string, string> = { 'Pendente': 'pendente', 'Em andamento': 'em_andamento', 'Concluído': 'concluido' }
const PRIO: Record<string, string> = { 'Alta': 'alta', 'Média': 'media', 'Baixa': 'baixa' }
const IDEAST: Record<string, string> = { 'Nova ideia': 'nova', 'Aguardando desenvolvimento': 'aguardando', 'Em desenvolvimento': 'em_desenvolvimento', 'Concluída': 'concluida', 'Arquivada': 'arquivada' }

export function parseLegacy(o: any): Legacy {
  if (!o || !o.cfg || !o.day || !Array.isArray(o.cfg.blocks)) throw new Error('O arquivo não parece ser um backup do painel antigo.')
  const cb: any[] = o.cfg.blocks.slice(0, 5)
  const days: LDay[] = []

  for (const [date, h] of Object.entries<any>(o.hist || {})) {
    const per: Record<string, LTask[]> = {}
    const add = (s: string, done: boolean) => {
      const i = s.indexOf(': ')
      if (i < 0) return
      const bn = s.slice(0, i)
      let t = s.slice(i + 2)
      let at: string | null = null
      if (done) { const m = t.match(/ \((\d{2}:\d{2})\)$/); if (m) { at = m[1]; t = t.slice(0, -m[0].length) } }
      ;(per[bn] ||= []).push({ descricao: t, grupo: null, done, at })
    }
    ;(h.done || []).forEach((s: string) => add(s, true))
    ;(h.pend || []).forEach((s: string) => add(s, false))
    days.push({
      date,
      blocks: cb.map((b, i) => ({
        numero: i + 1, nome: b.name, min: b.min,
        notes: (h.notes || []).find((n: string) => n.startsWith(b.name + ': '))?.slice(b.name.length + 2) || null,
        tasks: per[b.name] || [],
      })),
      meet: h.meet || [], imp: h.imp || [], prep: h.prep || null, tempo: h.work || 0,
    })
  }

  const D = o.day
  if (D?.date && !days.some((d) => d.date === D.date)) {
    days.push({
      date: D.date,
      blocks: cb.map((b, i) => ({
        numero: i + 1, nome: b.name, min: b.min, notes: D.notes?.[b.id] || null,
        tasks: b.tasks.map((t: any) => ({ descricao: t.t, grupo: t.g || null, done: !!D.done?.[t.id], at: D.done?.[t.id] || null })),
      })),
      meet: D.meet || [], imp: D.imp || [], prep: D.prep || null,
      tempo: Object.values<number>(D.sec || {}).reduce((a, x) => a + x, 0),
    })
  }

  return {
    days,
    ideas: o.ideas || [],
    settings: {
      atuacao_min: cb.reduce((a, b) => a + (b.min || 0), 0),
      pausa_min: o.cfg.pausa ?? 60, reunioes_min: o.cfg.reun ?? 120, margem_min: o.cfg.margem ?? 108,
    },
  }
}

export async function runImport(uid: string, L: Legacy, applySettings: boolean) {
  const r = { dias: 0, ignorados: 0, ideias: 0, ideiasIgnoradas: 0, configuracao: false }

  for (const d of L.days) {
    const ex = await supabase.from('daily_records').select('id').eq('user_id', uid).eq('data', d.date).maybeSingle()
    if (ex.data) { r.ignorados++; continue }
    const rec = await supabase.from('daily_records')
      .insert({ user_id: uid, data: d.date, preparacao_proximo_dia: d.prep, config: { origem: 'importacao_painel_antigo', tempo_total_seg: d.tempo } })
      .select().single()
    if (rec.error) throw new Error(rec.error.message)
    const bl = await supabase.from('daily_blocks')
      .insert(d.blocks.map((b) => ({ user_id: uid, daily_record_id: rec.data.id, numero: b.numero, nome: b.nome, duracao_planejada_min: Math.max(1, b.min), observacoes: b.notes })))
      .select('id,numero')
    if (bl.error) throw new Error(bl.error.message)
    const tasks = d.blocks.flatMap((b) => {
      const id = bl.data.find((x: any) => x.numero === b.numero)!.id
      return b.tasks.map((t, i) => ({
        user_id: uid, block_id: id, descricao: t.descricao, grupo: t.grupo, ordem: i, concluida: t.done,
        concluida_em: t.done && t.at ? `${d.date}T${t.at}:00-03:00` : null,
      }))
    })
    if (tasks.length) { const t = await supabase.from('daily_tasks').insert(tasks); if (t.error) throw new Error(t.error.message) }
    if (d.meet.length) {
      const a = await supabase.from('agenda').insert(d.meet.map((m: any) => ({ user_id: uid, data: d.date, horario: m.h || null, duracao_min: m.d || 0, assunto: m.s || '(sem assunto)', observacoes: m.o || null })))
      if (a.error) throw new Error(a.error.message)
    }
    if (d.imp.length) {
      const a = await supabase.from('imprevistos').insert(d.imp.map((m: any) => ({ user_id: uid, data: d.date, descricao: m.d, criticidade: CRIT[m.p] || 'media', estimativa_min: m.m || 0, status: IMPST[m.s] || 'pendente' })))
      if (a.error) throw new Error(a.error.message)
    }
    r.dias++
  }

  if (L.ideas.length) {
    const have = await supabase.from('ideas').select('titulo').eq('user_id', uid)
    const titles = new Set((have.data || []).map((x: any) => x.titulo))
    const novas = L.ideas.filter((i: any) => !titles.has(i.t))
    r.ideiasIgnoradas = L.ideas.length - novas.length
    if (novas.length) {
      const a = await supabase.from('ideas').insert(novas.map((i: any) => ({
        user_id: uid, titulo: i.t, descricao: i.d || null, prioridade: PRIO[i.p] || 'media', status: IDEAST[i.s] || 'nova',
        criado_em: i.date ? `${i.date}T12:00:00-03:00` : new Date().toISOString(),
      })))
      if (a.error) throw new Error(a.error.message)
      r.ideias = novas.length
    }
  }

  if (applySettings) {
    const ex = await supabase.from('app_settings').select('id').eq('user_id', uid).maybeSingle()
    if (!ex.data) {
      const a = await supabase.from('app_settings').insert({ user_id: uid, ...L.settings })
      if (a.error) throw new Error(a.error.message)
      r.configuracao = true
    }
  }
  return r
}
