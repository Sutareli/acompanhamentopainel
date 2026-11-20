import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, inp, Msg } from './ui'

interface Cfg { ativo: boolean; emails: string[]; ultimo_envio: string | null; ultimo_resultado: string | null }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Resumo semanal por e-mail (segundas, 08:00): prazos vencidos, SLA estourado e itens sem responsável. Só Analista Sr edita. */
export default function AvisosCard() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [txt, setTxt] = useState('')
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const r = await supabase.from('avisos_config').select('ativo,emails,ultimo_envio,ultimo_resultado').eq('id', 1).maybeSingle()
    if (r.error) return setErr(r.error.message.includes('avisos_config') ? 'Avisos indisponíveis: a migração 025 ainda não foi aplicada.' : r.error.message)
    if (r.data) { setCfg(r.data as Cfg); setTxt((r.data.emails || []).join(', ')) }
  }
  useEffect(() => { load() }, [])
  async function salvar(ativo: boolean) {
    setErr(''); setOk('')
    const emails = [...new Set(txt.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))]
    if (emails.length > 10) return setErr('No máximo 10 e-mails.')
    const ruim = emails.find((e) => !EMAIL.test(e)); if (ruim) return setErr(`E-mail inválido: ${ruim}`)
    setBusy(true); const r = await supabase.from('avisos_config').update({ ativo, emails }).eq('id', 1); setBusy(false)
    if (r.error) return setErr(r.error.message)
    setOk('Salvo.'); load()
  }
  async function testar() {
    setErr(''); setOk(''); setBusy(true)
    const r = await supabase.functions.invoke('aviso-semanal', { body: { teste: true } }); setBusy(false)
    const d = r.data as { enviado?: boolean; motivo?: string; error?: string } | null
    if (r.error && !d) return setErr('Não consegui chamar a função: ela já foi publicada no Supabase? Detalhe: ' + r.error.message)
    if (d?.error) return setErr(d.error)
    if (!d?.enviado) setErr(d?.motivo || 'Não enviado.'); else setOk('E-mail de teste enviado. Confira a caixa de entrada (e o spam).')
    load()
  }
  if (!cfg) return err ? <Card><Msg kind="erro">{err}</Msg></Card> : null
  return (
    <Card>
      <h3 className="font-bold text-navy">Aviso semanal por e-mail</h3>
      <p className="mb-2 text-sm text-slate-500">Toda segunda-feira, às 08:00, os endereços abaixo recebem um resumo: melhorias e correções com prazo vencido, SLA estourado, itens sem responsável e atividades com data target vencida (só títulos e números, sem dados pessoais).</p>
      {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
      <label className="block text-sm"><span className="mb-1 block font-medium text-slate-600">Destinatários (separe por vírgula)</span><input className={inp} value={txt} onChange={(e) => setTxt(e.target.value)} /></label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className={btnP + ' ' + btnSm} disabled={busy} onClick={() => salvar(cfg.ativo)}>Salvar destinatários</button>
        <button className={btnG + ' ' + btnSm} disabled={busy} onClick={() => salvar(!cfg.ativo)}>{cfg.ativo ? 'Pausar avisos' : 'Reativar avisos'}</button>
        <button className={btnG + ' ' + btnSm} disabled={busy} onClick={testar}>Enviar agora (teste)</button>
        <span className={'text-xs font-semibold ' + (cfg.ativo ? 'text-green-700' : 'text-amber-700')}>{cfg.ativo ? '● ativo' : '● pausado'}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{cfg.ultimo_envio ? `Último envio: ${fmtDateTime(cfg.ultimo_envio)} — ${cfg.ultimo_resultado || ''}` : 'Nenhum envio registrado ainda.'}</p>
      <p className="mt-1 text-[11px] text-slate-400">O envio só funciona depois de cadastrar a chave do serviço de e-mail no Supabase (passo a passo em AVISOS_POR_EMAIL.md).</p>
    </Card>
  )
}
