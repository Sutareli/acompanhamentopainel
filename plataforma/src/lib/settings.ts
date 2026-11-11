import { supabase } from './supabase'

export interface Settings { atuacao_min: number; pausa_min: number; reunioes_min: number; margem_min: number }
export const DEFAULT_SETTINGS: Settings = { atuacao_min: 300, pausa_min: 60, reunioes_min: 120, margem_min: 108 }

/** Configuração do usuário; se não houver, a global; se não houver, o padrão (9h48). */
export async function loadSettings(uid: string): Promise<Settings> {
  const { data, error } = await supabase.from('app_settings').select('*').or(`user_id.eq.${uid},user_id.is.null`)
  if (error) throw new Error(error.message)
  const s = data?.find((r) => r.user_id === uid) || data?.find((r) => r.user_id === null)
  return s ? { atuacao_min: s.atuacao_min, pausa_min: s.pausa_min, reunioes_min: s.reunioes_min, margem_min: s.margem_min } : DEFAULT_SETTINGS
}

export async function saveSettings(uid: string, s: Settings, global = false) {
  const q = supabase.from('app_settings')
  const { data: ex, error: e1 } = global
    ? await q.select('id').is('user_id', null).maybeSingle()
    : await q.select('id').eq('user_id', uid).maybeSingle()
  if (e1) throw new Error(e1.message)
  const row = { ...s, user_id: global ? null : uid }
  const r = ex ? await supabase.from('app_settings').update(s).eq('id', ex.id) : await supabase.from('app_settings').insert(row)
  if (r.error) throw new Error(r.error.message)
}
