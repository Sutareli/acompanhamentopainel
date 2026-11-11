import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Micro, Perfil } from './rules'

export interface Prof { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean }

/** Carrega microentregas + perfis e recarrega sozinho quando qualquer usuário altera dados (Realtime). */
export function useMicros() {
  const [rows, setRows] = useState<Micro[]>([])
  const [profiles, setProfiles] = useState<Prof[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('v_microdeliveries').select('*').order('data_target'),
      supabase.from('profiles').select('id,nome,email,perfil,ativo').order('nome'),
    ])
    if (m.error || p.error) setError('Não foi possível carregar os dados: ' + (m.error || p.error)!.message)
    else { setRows(m.data as Micro[]); setProfiles(p.data as Prof[]); setError('') }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
    const ch = supabase.channel('micro-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'microdeliveries' }, () => reload())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [reload])

  return { rows, profiles, loading, error, reload }
}
