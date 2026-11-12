import { FormEvent, useState } from 'react'
import { useAuth } from './AuthContext'
import { btnP, Field, inp, Msg } from '../components/ui'
import AuthShell from '../components/AuthShell'

export function Login() {
  const { signIn, resetPassword, authError } = useAuth()
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(''); setOk('')
    if (!email.trim()) return setErr('Informe o e-mail.')
    if (mode === 'login' && !pw) return setErr('Informe a senha.')
    setBusy(true)
    try {
      if (mode === 'login') { const m = await signIn(email, pw); if (m) setErr(m) }
      else { const m = await resetPassword(email); if (m) setErr(m); else setOk('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.') }
    } catch { setErr('Falha de conexão. Verifique sua internet e tente novamente.') }
    setBusy(false)
  }

  return (
    <AuthShell title={mode === 'login' ? 'Acesse sua conta' : 'Recuperar senha'}>
      {(err || authError) && <Msg kind="erro">{err || authError}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail"><input className={inp} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode === 'login' && <Field label="Senha"><input className={inp} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
        <button className={btnP + ' w-full !py-3 text-base'} disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Enviar link de recuperação'}</button>
      </form>
      <div className="mt-4 text-center">
        <button className="text-sm text-turq underline" onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setErr(''); setOk('') }}>
          {mode === 'login' ? 'Esqueci minha senha' : 'Voltar ao login'}
        </button>
        <p className="mt-3 text-xs text-slate-400">O acesso é feito por convite.</p>
      </div>
    </AuthShell>
  )
}

export function SetPassword() {
  const { setPassword } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (a.length < 10) return setErr('A senha deve ter pelo menos 10 caracteres.')
    if (!/[A-Za-z]/.test(a) || !/\d/.test(a)) return setErr('Use letras e números na senha.')
    if (a !== b) return setErr('As senhas não coincidem.')
    setBusy(true)
    const m = await setPassword(a)
    if (m) setErr(m)
    setBusy(false)
  }
  return (
    <AuthShell title="Definir senha">
      <p className="mb-4 text-center text-sm text-slate-500">Crie a senha de acesso à plataforma.</p>
      {err && <Msg kind="erro">{err}</Msg>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha"><input className={inp} type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Repita a senha"><input className={inp} type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        <button className={btnP + ' w-full !py-3 text-base'} disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </form>
    </AuthShell>
  )
}
