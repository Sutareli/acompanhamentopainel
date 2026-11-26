// Edge Function (Supabase): gera uma SENHA TEMPORÁRIA para um usuário (sem depender de e-mail). Somente ANALISTAS SR ativos podem chamar.
// O usuário é obrigado a criar a própria senha no primeiro acesso (user_metadata.trocar_senha).
// A chave service_role existe APENAS aqui (servidor do Supabase) — nunca no navegador nem no Cloudflare.
// Funciona igual com o app hospedado no Cloudflare Pages: o navegador chama a função pelo domínio do Supabase.
//
// Deploy:   supabase functions deploy definir-senha
// Secrets:  supabase secrets set SITE_URL=https://SEU-APP.pages.dev
//           supabase secrets set ALLOWED_ORIGINS=https://SEU-APP.pages.dev,https://seu-dominio.com.br
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

function corsFor(req: Request) {
  // Se ALLOWED_ORIGINS estiver definido, só essas origens são aceitas (recomendado em produção).
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const origin = req.headers.get('Origin') || ''
  // Sem ALLOWED_ORIGINS, só a origem de SITE_URL é aceita (nunca '*').
  const site = (Deno.env.get('SITE_URL') || '').replace(/\/+$/, '')
  const lista = allowed.length ? allowed : site ? [site] : []
  const allow = lista.includes(origin) ? origin : (lista[0] || 'null')
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

function gerarSenha(): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'   // sem caracteres que se confundem (0/O, 1/l/I)
  const b = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(b, (n) => A[n % A.length]).join('')
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json(401, { error: 'Não autenticado.' })

    const admin = createClient(url, service)
    const { data: me } = await admin.from('profiles').select('perfil,ativo').eq('id', user.id).single()
    if (!me || !me.ativo || me.perfil !== 'analista_sr' && me.perfil !== 'gerente') return json(403, { error: 'Apenas Analista Sr e Gerente podem definir senha temporária.' })

    const { user_id } = await req.json()
    if (typeof user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user_id)) return json(400, { error: 'Usuário inválido.' })
    if (user_id === user.id) return json(400, { error: 'Para a sua própria senha, peça a outro Analista Sr ou use “Esqueci minha senha”.' })
    const { data: alvo } = await admin.from('profiles').select('id,nome,ativo').eq('id', user_id).maybeSingle()
    if (!alvo) return json(404, { error: 'Usuário não encontrado.' })
    if (!alvo.ativo) return json(400, { error: 'Usuário inativo: reative antes de definir a senha.' })

    const { data: atual, error: e0 } = await admin.auth.admin.getUserById(user_id)
    if (e0 || !atual?.user) return json(404, { error: 'Conta de acesso não encontrada.' })
    const senha = gerarSenha()
    const { error } = await admin.auth.admin.updateUserById(user_id, {
      password: senha,
      email_confirm: true,
      user_metadata: { ...(atual.user.user_metadata || {}), trocar_senha: true },
    })
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true, senha, nome: alvo.nome })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'Erro interno ao definir a senha.' })
  }
})
