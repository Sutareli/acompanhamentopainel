// Edge Function (Supabase): convida um novo usuário por e-mail. Somente GESTORES ativos podem chamar.
// A chave service_role existe APENAS aqui (servidor do Supabase) — nunca no navegador nem no Cloudflare.
// Funciona igual com o app hospedado no Cloudflare Pages: o navegador chama a função pelo domínio do Supabase.
//
// Deploy:   supabase functions deploy invite-user
// Secrets:  supabase secrets set SITE_URL=https://SEU-APP.pages.dev
//           supabase secrets set ALLOWED_ORIGINS=https://SEU-APP.pages.dev,https://seu-dominio.com.br
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PERFIS = ['chefe_do_chefe', 'chefe', 'gestor', 'analista', 'guardiao']

function corsFor(req: Request) {
  // Se ALLOWED_ORIGINS estiver definido, só essas origens são aceitas (recomendado em produção).
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const origin = req.headers.get('Origin') || ''
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
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
    if (!me || !me.ativo || me.perfil !== 'gestor') return json(403, { error: 'Apenas gestores podem convidar usuários.' })

    const { email, nome, perfil } = await req.json()
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'E-mail inválido.' })
    if (typeof nome !== 'string' || !nome.trim()) return json(400, { error: 'Informe o nome.' })
    if (perfil !== undefined && !PERFIS.includes(perfil)) return json(400, { error: 'Perfil inválido.' })

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nome: nome.trim() },
      redirectTo: Deno.env.get('SITE_URL') || undefined,
    })
    if (error) return json(400, { error: error.message })
    // O trigger do banco cria o perfil como 'analista'; o perfil escolhido é aplicado aqui, pelo servidor.
    if (perfil && perfil !== 'analista') {
      const { error: e2 } = await admin.from('profiles').update({ perfil }).eq('id', data.user.id)
      if (e2) return json(500, { error: 'Convite enviado, mas não foi possível definir o perfil: ' + e2.message })
    }
    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
