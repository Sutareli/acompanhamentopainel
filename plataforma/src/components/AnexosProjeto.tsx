import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, fmtDateTime } from '../lib/rules'
import { EXT_ANEXO, fmtTamanho, LIMITE_ANEXO, MAX_ANEXOS, MIME_ANEXO, extensao, nomeSeguro, validarAnexo } from '../lib/anexos'
import { btnG, btnP, btnSm, Card, Msg } from './ui'

interface Anexo { id: string; nome: string; tamanho: number; tipo: string; caminho: string; criado_por: string; criado_em: string; usuario?: { nome: string } | null }
const BUCKET = 'anexos-projetos'

/** Documentação do projeto: anexar, baixar e remover arquivos PDF ou Word (até 10 MB cada). */
export default function AnexosProjeto({ id }: { id: string }) {
  const { profile } = useAuth()
  const [lista, setLista] = useState<Anexo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [apagar, setApagar] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await supabase.from('anexos_projetos').select('*, usuario:profiles(nome)').eq('projeto_id', id).order('criado_em', { ascending: true })
    if (r.error) return setErr(r.error.message.includes('anexos_projetos') ? 'Anexos indisponíveis: a migração 035 ainda não foi aplicada.' : r.error.message)
    setLista((r.data || []) as unknown as Anexo[])   // não limpa a mensagem de erro/sucesso do último envio
  }, [id])
  useEffect(() => { load() }, [load])

  async function enviar(files: FileList | null) {
    if (!files || !files.length) return
    setErr(''); setOk(''); setBusy(true)
    const enviados: string[] = []; const erros: string[] = []
    let total = lista.length
    for (const f of Array.from(files)) {
      if (total >= MAX_ANEXOS) { erros.push(`Limite de ${MAX_ANEXOS} anexos por projeto atingido.`); break }
      const cab = new Uint8Array(await f.slice(0, 8).arrayBuffer())
      const v = validarAnexo(f.name, f.size, cab); if (v) { erros.push(v); continue }
      if (lista.some((a) => a.nome === f.name && a.tamanho === f.size)) { erros.push(`“${f.name}” já está anexado.`); continue }
      const ext = extensao(f.name), caminho = `${id}/${crypto.randomUUID()}-${nomeSeguro(f.name)}`
      const up = await supabase.storage.from(BUCKET).upload(caminho, f, { contentType: MIME_ANEXO[ext], upsert: false })
      if (up.error) { erros.push(`“${f.name}”: não foi possível enviar (${up.error.message}).`); continue }
      const ins = await supabase.from('anexos_projetos').insert({ projeto_id: id, nome: f.name, tamanho: f.size, tipo: MIME_ANEXO[ext], caminho })
      if (ins.error) { await supabase.storage.from(BUCKET).remove([caminho]); erros.push(`“${f.name}”: não foi possível registrar (${ins.error.message}).`); continue }
      enviados.push(f.name); total++
    }
    setBusy(false); if (ref.current) ref.current.value = ''
    if (enviados.length) setOk(enviados.length === 1 ? `“${enviados[0]}” anexado.` : `${enviados.length} arquivos anexados.`)
    if (erros.length) setErr(erros.join(' '))
    load()
  }
  async function baixar(a: Anexo) {
    setErr('')
    const r = await supabase.storage.from(BUCKET).createSignedUrl(a.caminho, 60, { download: a.nome })   // link temporário (1 min), só para quem está logado
    if (r.error || !r.data) return setErr('Não foi possível baixar: ' + (r.error?.message || 'tente novamente.'))
    const l = document.createElement('a'); l.href = r.data.signedUrl; l.rel = 'noopener'; document.body.appendChild(l); l.click(); l.remove()
  }
  async function remover(a: Anexo) {
    setErr(''); setOk(''); setApagar(null)
    const d = await supabase.from('anexos_projetos').delete().eq('id', a.id).select('id')
    if (d.error) return setErr('Não foi possível remover: ' + d.error.message)
    if (!d.data?.length) return setErr('Você só pode remover o que você mesmo anexou (ou ser Analista Sr).')
    await supabase.storage.from(BUCKET).remove([a.caminho])
    setOk(`“${a.nome}” removido.`); load()
  }

  return (
    <Card className="!p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold text-navy">Documentação {lista.length > 0 && <span className="text-sm font-normal text-slate-500">({lista.length})</span>}</h4>
        <label className={btnP + ' ' + btnSm + ' cursor-pointer ' + (busy ? 'pointer-events-none opacity-60' : '')}>
          {busy ? 'Enviando…' : 'Anexar arquivo'}
          <input ref={ref} type="file" hidden multiple accept={EXT_ANEXO.map((e) => '.' + e).join(',')} aria-label="Anexar documentação (PDF ou Word)" disabled={busy} onChange={(e) => enviar(e.target.files)} />
        </label>
      </div>
      <p className="mb-2 text-xs text-slate-500">PDF ou Word (.doc, .docx), até {LIMITE_ANEXO / 1024 / 1024} MB por arquivo. O PDF costuma ser o formato mais leve.</p>
      {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
      {lista.length === 0 ? <p className="text-sm text-slate-400">Nenhum documento anexado ainda.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {lista.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-navy" title={a.nome}>{a.nome}</div>
                <div className="text-xs text-slate-500">{extensao(a.nome).toUpperCase()} · {fmtTamanho(a.tamanho)} · {a.usuario?.nome || 'Usuário'} · {fmtDateTime(a.criado_em)}</div>
              </div>
              <button className={btnG + ' ' + btnSm} onClick={() => baixar(a)} aria-label={`Baixar ${a.nome}`}>Baixar</button>
              {(a.criado_por === profile?.id || canAdmin(profile!.perfil)) && (apagar === a.id
                ? <span className="flex items-center gap-1 text-xs"><button className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white" onClick={() => remover(a)}>Confirmar remoção</button><button className="underline" onClick={() => setApagar(null)}>cancelar</button></span>
                : <button className="text-xs text-red-600 underline" aria-label={`Remover ${a.nome}`} onClick={() => setApagar(a.id)}>remover</button>)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
