// Edge Function (Supabase): convida um novo usuário por e-mail. Somente ANALISTAS SR ativos podem chamar.
// A chave service_role existe APENAS aqui (servidor do Supabase) — nunca no navegador nem no Cloudflare.
// Funciona igual com o app hospedado no Cloudflare Pages: o navegador chama a função pelo domínio do Supabase.
//
// Deploy:   supabase functions deploy invite-user
// Secrets:  supabase secrets set SITE_URL=https://SEU-APP.pages.dev
//           supabase secrets set ALLOWED_ORIGINS=https://SEU-APP.pages.dev,https://seu-dominio.com.br
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const PERFIS = ['diretor', 'gerente', 'analista_sr', 'analista', 'guardiao']

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
    if (!me || !me.ativo || me.perfil !== 'analista_sr') return json(403, { error: 'Apenas Analistas Sr podem convidar usuários.' })

    const { email: emailRaw, nome, perfil } = await req.json()
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : ''
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'E-mail inválido.' })
    if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120) return json(400, { error: 'Informe o nome (até 120 caracteres).' })
    if (perfil !== undefined && !PERFIS.includes(perfil)) return json(400, { error: 'Perfil inválido.' })

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nome: nome.trim() },
      redirectTo: Deno.env.get('SITE_URL') || undefined,
    })
    if (error) return json(400, { error: error.message })
    // O trigger do banco cria o perfil como 'analista'; o perfil escolhido é aplicado aqui, pelo servidor.
    if (perfil && perfil !== 'analista') {
      const { error: e2 } = await admin.from('profiles').update({ perfil }).eq('id', data.user.id)
      if (e2) { console.error(e2); return json(500, { error: 'Convite enviado, mas não foi possível definir o perfil. Ajuste em Configurações.' }) }
    }
    return json(200, { ok: true })
  } catch (e) {
    console.error(e)   // detalhe fica só no log do servidor
    return json(500, { error: 'Erro interno ao enviar o convite.' })
  }
})
