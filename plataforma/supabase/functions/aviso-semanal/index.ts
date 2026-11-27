// Edge Function (Supabase): envia o RESUMO SEMANAL por e-mail (prazos vencidos, SLA estourado, itens sem responsável).
// Quem pode chamar: (1) o agendamento (pg_cron), com o cabeçalho x-cron-secret conferido no banco (função cron_secret_ok); ou
//                   (2) um Analista Sr logado (botão "Enviar agora" em Segurança), para testar.
// O e-mail sai pelo Resend (https://resend.com). Passo a passo: AVISOS_POR_EMAIL.md.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   chave do Resend (obrigatória para enviar)
//   AVISO_REMETENTE  opcional. Ex.: "Gestão de atividades <avisos@seudominio.com.br>" (padrão: onboarding@resend.dev)
//   SITE_URL         endereço do sistema, usado no link do e-mail
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function corsFor(req: Request) {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const site = (Deno.env.get('SITE_URL') || '').replace(/\/+$/, '')
  const lista = allowed.length ? allowed : site ? [site] : []
  const origin = req.headers.get('Origin') || ''
  return { 'Access-Control-Allow-Origin': lista.includes(origin) ? origin : (lista[0] || 'null'), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Vary': 'Origin' }
}

interface Item { titulo: string; modulo: string | null; responsavel: string | null; dias: number }
interface Grupo { total: number; itens: Item[] }
const BLOCOS: [string, string, string][] = [
  ['melhorias_prazo_vencido', '⚠️ Melhorias com prazo vencido', 'atrasada há'],
  ['melhorias_sla_vencido', '⏱️ Melhorias com SLA vencido', 'SLA vencido há'],
  ['melhorias_sem_responsavel', '🙋 Melhorias sem responsável', 'criada há'],
  ['correcoes_prazo_vencido', '🛠️ Correção/manutenção com prazo vencido', 'atrasada há'],
  ['atividades_prazo_vencido', '📦 Projetos e atividades com data target vencida', 'venceu há'],
]

function montar(d: Record<string, Grupo | string>, site: string) {
  const grupos = BLOCOS.map(([k, titulo, verbo]) => ({ titulo, verbo, g: d[k] as Grupo }))
  const total = grupos.reduce((a, x) => a + (x.g?.total || 0), 0)
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1e293b">
  <h2 style="color:#2e1a6e;margin-bottom:4px">Resumo semanal · Gestão de atividades</h2>
  <p style="margin-top:0;color:#64748b">Posição de ${esc(d.hoje)}. ${total ? `<b>${total}</b> ponto(s) de atenção.` : '<b>Tudo em dia.</b> 🎉'}</p>
  ${grupos.map(({ titulo, verbo, g }) => `<h3 style="margin:18px 0 6px;font-size:15px">${titulo}: <span style="color:${g.total ? '#dc2626' : '#16a34a'}">${g.total}</span></h3>
  ${g.total ? `<ul style="padding-left:18px;margin:0">${g.itens.map((i) => `<li style="margin:3px 0"><b>${esc(i.titulo)}</b><br><span style="color:#64748b;font-size:12px">${esc(i.responsavel || 'sem responsável')} · ${verbo} ${i.dias} dia(s)</span></li>`).join('')}${g.total > g.itens.length ? `<li style="color:#64748b">… e mais ${g.total - g.itens.length}</li>` : ''}</ul>` : '<p style="margin:0;color:#16a34a;font-size:13px">Nada pendente ✅</p>'}`).join('')}
  ${site ? `<p style="margin-top:22px"><a href="${esc(site)}" style="background:#2e1a6e;color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Abrir o sistema</a></p>` : ''}
  <p style="color:#94a3b8;font-size:11px;margin-top:22px">Enviado automaticamente toda segunda-feira. Para pausar ou trocar destinatários: Segurança → Aviso semanal por e-mail.</p></div>`
  return { html, total }
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, service)

    // autorização: segredo do agendamento OU Analista Sr logado
    const enviado = req.headers.get('x-cron-secret') || ''
    let teste = false
    const agendado = enviado ? (await admin.rpc('cron_secret_ok', { p: enviado })).data === true : false
    if (agendado) { /* agendamento */ } else {
      const auth = req.headers.get('Authorization') || ''
      const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await caller.auth.getUser()
      if (!user) return json(401, { error: 'Não autorizado.' })
      const { data: me } = await admin.from('profiles').select('perfil,ativo').eq('id', user.id).single()
      if (!me?.ativo || !['analista_sr', 'gerente', 'diretor'].includes(me.perfil)) return json(403, { error: 'Apenas Analista Sr, Gerente e Diretor podem enviar o aviso manualmente.' })
      teste = true
    }

    const { data: cfg } = await admin.from('avisos_config').select('ativo,emails,ultimo_envio').eq('id', 1).single()
    const registra = (r: string) => admin.from('avisos_config').update({ ultimo_envio: new Date().toISOString(), ultimo_resultado: r }).eq('id', 1)
    if (!cfg || !cfg.emails?.length) return json(200, { enviado: false, motivo: 'Nenhum destinatário cadastrado.' })
    if (!teste && !cfg.ativo) return json(200, { enviado: false, motivo: 'Avisos pausados.' })
    if (!teste && cfg.ultimo_envio && Date.now() - Date.parse(cfg.ultimo_envio) < 5 * 86400000) return json(200, { enviado: false, motivo: 'Já enviado nos últimos 5 dias.' })

    const chave = Deno.env.get('RESEND_API_KEY')
    if (!chave) { await registra('NÃO enviado: RESEND_API_KEY não configurada.'); return json(200, { enviado: false, motivo: 'RESEND_API_KEY não configurada (veja AVISOS_POR_EMAIL.md).' }) }

    const { data: dados, error } = await admin.rpc('avisos_dados')
    if (error) { await registra('Erro ao montar os números: ' + error.message.slice(0, 120)); return json(500, { error: 'Falha ao montar os números.' }) }
    const { html, total } = montar(dados, (Deno.env.get('SITE_URL') || '').replace(/\/+$/, ''))
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('AVISO_REMETENTE') || 'Gestão de atividades <onboarding@resend.dev>', to: cfg.emails, subject: `Gestão de atividades — resumo semanal (${total} ponto${total === 1 ? '' : 's'} de atenção)`, html }),
    })
    if (!resp.ok) { const t = (await resp.text()).slice(0, 160); await registra(`FALHOU (${resp.status}): ${t}`); return json(200, { enviado: false, motivo: `O serviço de e-mail recusou (${resp.status}): ${t}` }) }
    await registra(`Enviado a ${cfg.emails.length} destinatário(s): ${total} ponto(s) de atenção.`)
    return json(200, { enviado: true, destinatarios: cfg.emails.length, pontos: total })
  } catch (e) {
    return json(500, { error: 'Erro inesperado: ' + String((e as Error).message || e).slice(0, 200) })
  }
})
