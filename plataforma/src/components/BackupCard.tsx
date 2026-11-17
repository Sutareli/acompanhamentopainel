import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { download, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Msg } from './ui'

interface Snap { id: number; criado_em: string; origem: 'semanal' | 'manual'; qtd_linhas: number }

/** Backup dos dados da equipe: cópia interna semanal (toda segunda, 03:00) + arquivo JSON para guardar fora do Supabase. Só Analista Sr. */
export default function BackupCard() {
  const [lista, setLista] = useState<Snap[]>([])
  const [busy, setBusy] = useState<'' | 'gerar' | 'baixar'>('')
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const load = useCallback(async () => {
    const r = await supabase.from('backup_snapshots').select('id,criado_em,origem,qtd_linhas').order('id', { ascending: false }).limit(12)
    if (r.error) return setErr(r.error.message.includes('backup_snapshots') ? 'Backup indisponível: a migração 025 ainda não foi aplicada.' : r.error.message)
    setLista((r.data || []) as Snap[])
  }, [])
  useEffect(() => { load() }, [load])
  async function gerar() {
    setBusy('gerar'); setErr(''); setOk('')
    const r = await supabase.rpc('backup_gerar_manual'); setBusy('')
    if (r.error) return setErr(r.error.message)
    setOk('Backup interno gerado.'); load()
  }
  async function baixar() {
    setBusy('baixar'); setErr(''); setOk('')
    const r = await supabase.rpc('backup_exportar'); setBusy('')
    if (r.error) return setErr(r.error.message)
    download(`backup-gestao-atividades_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r.data, null, 1), 'application/json;charset=utf-8')
    setOk('Arquivo baixado. Guarde-o em um local seguro (fora do Supabase).')
  }
  const ult = lista[0]
  const velho = !ult || Date.now() - Date.parse(ult.criado_em) > 9 * 86400000
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">💾 Backup dos dados</h3>
          <p className="text-sm text-slate-500">Toda segunda-feira, às 03:00, o sistema guarda uma cópia (projetos, atividades, melhorias, correções, chamados, feriados, metas e comentários) e mantém as 8 mais recentes. Jornadas pessoais e atas <b>não</b> entram, por serem privadas.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnG + ' ' + btnSm} disabled={!!busy} onClick={gerar}>{busy === 'gerar' ? 'Gerando…' : 'Gerar agora'}</button>
          <button className={btnP + ' ' + btnSm} disabled={!!busy} onClick={baixar}>{busy === 'baixar' ? 'Preparando…' : '⬇ Baixar JSON'}</button>
        </div>
      </div>
      {err && <div className="mt-2"><Msg kind="erro">{err}</Msg></div>}{ok && <div className="mt-2"><Msg kind="ok">{ok}</Msg></div>}
      {velho && !err && <div className="mt-2"><Msg kind="aviso">{ult ? `O último backup foi em ${fmtDateTime(ult.criado_em)} (mais de 9 dias).` : 'Ainda não há backup. Clique em “Gerar agora” ou aguarde a próxima segunda-feira.'}</Msg></div>}
      {lista.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {lista.map((s) => <li key={s.id} className="rounded-lg bg-slate-50 px-3 py-1">{fmtDateTime(s.criado_em)} · {s.origem === 'semanal' ? 'semanal (automático)' : 'manual'} · {s.qtd_linhas} registros</li>)}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-400">A cópia interna protege contra exclusões e erros de importação. Contra perda do projeto inteiro no Supabase, guarde também o arquivo JSON fora dele (Drive, OneDrive).</p>
    </Card>
  )
}
