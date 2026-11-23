import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Prof } from '../lib/useMicros'
import { lerLinkAuth, MSG_EXPIRADO } from '../lib/authLink'

// Links de convite/recuperação chegam com #...type=invite|recovery: o usuário precisa definir a senha.
const link0 = typeof window !== 'undefined' ? lerLinkAuth(window.location.hash, window.location.search) : { precisaSenha: false, erro: '', token: null }
const startsWithLink = link0.precisaSenha || (typeof window !== 'undefined' && /access_token=.*type=(invite|recovery)|type=(invite|recovery).*access_token=/.test(window.location.hash))

interface Ctx {
  session: Session | null
  profile: Prof | null
  loading: boolean
  authError: string
  needsPassword: boolean
  linkError: string                       // link de e-mail inválido/expirado (aparece na tela de login)
  pendingLink: { token_hash: string; type: 'recovery' | 'invite' } | null   // link novo aguardando o clique do usuário
  confirmLink: () => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<string | null>
  setPassword: (password: string) => Promise<string | null>
}
const C = createContext<Ctx>(null as any)
export const AuthContext = C // exportado para testes de renderização
export const useAuth = () => useContext(C)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Prof | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [needsPassword, setNeedsPassword] = useState(startsWithLink)
  const [linkError, setLinkError] = useState(link0.erro)
  const [pendingLink, setPendingLink] = useState(link0.token)

  async function loadProfile(uid: string) {
    const { data, error } = await supabase.from('profiles').select('id,nome,email,perfil,ativo').eq('id', uid).maybeSingle()
    if (error || !data) { setAuthError('Não foi possível carregar seu perfil. Verifique a conexão e tente novamente.'); return }
    if (!data.ativo) { setAuthError('Sua conta está desativada. Procure um Analista Sr da equipe.'); await supabase.auth.signOut(); return }
    setAuthError('')
    setProfile(data as Prof)
  }

  useEffect(() => {   // limpa da barra de endereço o erro/token do link, para não repetir ao recarregar a página
    if (link0.erro || link0.token) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session?.user.user_metadata?.trocar_senha === true) setNeedsPassword(true)   // entrou com senha temporária
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s)
      if (ev === 'PASSWORD_RECOVERY' || s?.user.user_metadata?.trocar_senha === true) setNeedsPassword(true)
      if (s) setTimeout(() => loadProfile(s.user.id), 0)
      else setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: Ctx = {
    session, profile, loading, authError, needsPassword, linkError, pendingLink,
    async confirmLink() {
      if (!pendingLink) return null
      const { error } = await supabase.auth.verifyOtp({ token_hash: pendingLink.token_hash, type: pendingLink.type === 'invite' ? 'invite' : 'recovery' })
      if (error) { setPendingLink(null); setLinkError(MSG_EXPIRADO); return null }
      setPendingLink(null); setNeedsPassword(true); return null
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return error ? (error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message) : null
    },
    async signOut() { await supabase.auth.signOut(); setProfile(null) },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
      return error ? error.message : null
    },
    async setPassword(password) {
      const { error } = await supabase.auth.updateUser({ password, data: { trocar_senha: false } })
      if (!error) { setNeedsPassword(false); window.history.replaceState(null, '', window.location.pathname) }
      return error ? error.message : null
    },
  }
  return <C.Provider value={value}>{children}</C.Provider>
}
