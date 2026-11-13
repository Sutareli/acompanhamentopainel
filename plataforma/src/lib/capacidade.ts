import { supabase } from './supabase'

export interface CapStatus {
  banco_bytes: number; banco_limite_bytes: number; banco_pct: number
  storage_bytes: number; storage_limite_bytes: number; storage_pct: number
  alerta_pct: number; alerta: boolean; atas_qtd: number; atas_texto_bytes: number; atas_arquivo_bytes: number; janela_aberta: boolean
}
export async function capacidadeStatus(): Promise<{ data?: CapStatus; error?: string }> {
  const r = await supabase.rpc('capacidade_status')
  if (r.error) return { error: r.error.message }
  return { data: r.data as CapStatus }
}
export function fmtMB(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2).replace('.', ',') + ' GB'
  return (b / 1048576).toFixed(b >= 10485760 ? 0 : 1).replace('.', ',') + ' MB'
}
