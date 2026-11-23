import { FormEvent, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { btnP, Field, inp, Msg } from '../components/ui'
import AuthShell from '../components/AuthShell'

/** Campo de senha com o botão do olho para mostrar/ocultar o que foi digitado. */
function SenhaInput({ value, onChange, autoComplete, label }: { value: string; onChange: (v: string) => void; autoComplete: string; label: string }) {
  const [ver, setVer] = useState(false)
  return (
    <div className="relative">
      <input className={inp + ' !pr-11'} type={ver ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} spellCheck={false} autoCapitalize="none" />
      <button type="button" onClick={() => setVer(!ver)} aria-pressed={ver} aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'} title={ver ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-slate-500 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-turq">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {ver && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </div>)
}

export function Login() {
  const { signIn, resetPassword, authError, linkError } = useAuth()
  const [mode, setMode] = useState<'login' | 'reset'>(linkError ? 'reset' : 'login')   // link vencido: já abre o pedido de um novo
  const [espera, setEspera] = useState(0)   // segundos até poder pedir outro link (cada pedido novo invalida o anterior)
  useEffect(() => { if (espera <= 0) return; const t = setTimeout(() => setEspera(espera - 1), 1000); return () => clearTimeout(t) }, [espera])
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
      else { const m = await resetPassword(email); if (m) setErr(m); else { setOk('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Abra o e-mail mais recente: cada novo pedido invalida o link anterior, e o link vale por 1 hora.'); setEspera(60) } }
    } catch { setErr('Falha de conexão. Verifique sua internet e tente novamente.') }
    setBusy(false)
  }

  return (
    <AuthShell title={mode === 'login' ? 'Acesse sua conta' : 'Recuperar senha'}>
      {(err || authError || linkError) && <Msg kind="erro">{err || authError || linkError}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail"><input className={inp} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode === 'login' && <Field label="Senha"><SenhaInput label="Senha" autoComplete="current-password" value={pw} onChange={setPw} /></Field>}
        <button className={btnP + ' w-full !py-3 text-base'} disabled={busy || (mode === 'reset' && espera > 0)}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : espera > 0 ? `Link enviado — novo pedido em ${espera}s` : 'Enviar link de recuperação'}</button>
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
        <Field label="Nova senha"><SenhaInput label="Nova senha" autoComplete="new-password" value={a} onChange={setA} /></Field>
        <Field label="Repita a senha"><SenhaInput label="Repita a senha" autoComplete="new-password" value={b} onChange={setB} /></Field>
        <button className={btnP + ' w-full !py-3 text-base'} disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </form>
    </AuthShell>
  )
}

/** Tela do link novo do e-mail (?token_hash=…): o link só é validado quando a pessoa clica, então antivírus e leitores de e-mail não o gastam. */
export function ConfirmarLink() {
  const { confirmLink, pendingLink } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <AuthShell title={pendingLink?.type === 'invite' ? 'Ativar acesso' : 'Criar nova senha'}>
      <p className="mb-4 text-center text-sm text-slate-500">{pendingLink?.type === 'invite' ? 'Confirme para ativar seu acesso e definir a senha.' : 'Confirme para criar uma nova senha de acesso.'}</p>
      <button className={btnP + ' w-full !py-3 text-base'} disabled={busy} onClick={async () => { setBusy(true); await confirmLink(); setBusy(false) }}>{busy ? 'Validando…' : 'Continuar'}</button>
    </AuthShell>
  )
}
