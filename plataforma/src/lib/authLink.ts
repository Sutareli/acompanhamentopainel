/** Interpreta o endereço de abertura da plataforma quando o usuário chega por um link de e-mail do Supabase (convite / recuperação de senha). */
export interface LinkAuth {
  /** o link trouxe uma sessão (modelo antigo: #access_token=…&type=recovery|invite) → pedir a nova senha */
  precisaSenha: boolean
  /** o link falhou (expirado, já usado ou substituído por um pedido mais novo) → mensagem para o usuário */
  erro: string
  /** modelo novo do e-mail (?token_hash=…&type=recovery|invite): só vale quando o usuário confirma na tela, assim antivírus e leitores de e-mail não gastam o link */
  token: { token_hash: string; type: 'recovery' | 'invite' } | null
}

const MSG_EXPIRADO = 'Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha” e abra somente o e-mail mais recente (cada novo pedido invalida o anterior).'

export function lerLinkAuth(hash: string, search: string): LinkAuth {
  const h = new URLSearchParams(hash.replace(/^#/, '')), s = new URLSearchParams(search.replace(/^\?/, ''))
  const tipo = h.get('type') || s.get('type')
  const erroCod = h.get('error_code') || s.get('error_code') || ''
  const temErro = !!(h.get('error') || s.get('error') || erroCod)
  const th = s.get('token_hash')
  const ok = tipo === 'recovery' || tipo === 'invite'
  return {
    precisaSenha: !temErro && ok && h.has('access_token'),
    erro: temErro ? (/otp_expired|access_denied/.test(erroCod + ' ' + (h.get('error') || s.get('error') || '')) ? MSG_EXPIRADO : 'Não foi possível validar o link: ' + (h.get('error_description') || s.get('error_description') || 'tente novamente.').replace(/\+/g, ' ')) : '',
    token: th && ok ? { token_hash: th, type: tipo as 'recovery' | 'invite' } : null,
  }
}
export { MSG_EXPIRADO }
