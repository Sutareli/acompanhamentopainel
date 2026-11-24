import { useEffect } from 'react'
import { supabase } from './supabase'

/** Registra que o usuário abriu a plataforma: ao entrar e a cada 10 min de uso com a aba visível. Falhas são ignoradas. */
export function useRegistrarAcesso(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return
    let ultimo = 0
    const ping = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimo < 10 * 60_000) return
      ultimo = Date.now()
      Promise.resolve(supabase.rpc('registrar_acesso')).catch(() => {})
    }
    ping()
    const t = setInterval(ping, 5 * 60_000)
    document.addEventListener('visibilitychange', ping)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', ping) }
  }, [ativo])
}
