import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, fmtDateTime, todayStr } from '../lib/rules'
import { confirmar } from '../components/Confirm'
import { btnG, btnP, btnSm, Card, Empty, Field, inp, Modal, Msg } from '../components/ui'

/** Atas importantes: cada pessoa guarda as atas das reuniões que fez — nome, data, breve resumo, texto colado (até 60 mil caracteres) e/ou o arquivo original (Word/PDF, que mantém tabelas e imagens).
 *  Só o dono vê. Clicar numa ata abre a leitura completa. O arquivo fica no Storage (bucket privado "atas"). */
interface Ata { id: string; nome: string; data_reuniao: string; resumo: string | null; texto?: string | null; arquivo_path: string | null; arquivo_nome: string | null; arquivo_tamanho: number | null; criado_em: string; atualizado_em: string }
const MAX_TEXTO = 60000
const MAX_BYTES = 10 * 1024 * 1024
const EXT_OK = ['docx', 'doc', 'pdf']
const MIME: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', pdf: 'application/pdf' }
const LISTA = 'id,nome,data_reuniao,resumo,arquivo_path,arquivo_nome,arquivo_tamanho,criado_em,atualizado_em'   // a lista NÃO traz o texto completo (fica leve); ele é buscado ao abrir a ata
const VAZIO = { nome: '', data_reuniao: todayStr(), resumo: '', texto: '' }

export const extDe = (n: string) => (n.split('.').pop() || '').toLowerCase()
/** Nome seguro para o caminho no Storage (sem acento/espaço/símbolo); o nome original fica na tabela. */
export const nomeSeguro = (n: string) => {
  const e = extDe(n), base = n.slice(0, Math.max(0, n.length - e.length - 1))
  const b = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'ata'
  return `${b}.${e}`
}
export const fmtBytes = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`
export function validarArquivo(f: File): string | null {
  if (!EXT_OK.includes(extDe(f.name))) return 'Use um arquivo Word (.docx ou .doc) ou PDF.'
  if (f.size > MAX_BYTES) return `O arquivo tem ${fmtBytes(f.size)}; o limite é 10 MB.`
  if (f.size === 0) return 'O arquivo está vazio.'
  return null
}

/** Texto seguro para o filtro do PostgREST (.or): remove os caracteres que mudam o significado do filtro. */
export const termoBusca = (q: string) => q.trim().replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').slice(0, 80)

export default function Atas() {
  const { profile } = useAuth()
  const uid = profile!.id
  const [rows, setRows] = useState<Ata[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [q, setQ] = useState(''); const [qAtivo, setQAtivo] = useState(''); const [mes, setMes] = useState('')
  const [lendo, setLendo] = useState<Ata | null>(null)
  const [form, setForm] = useState<{ id?: string; v: typeof VAZIO; atual?: Ata } | null>(null)

  useEffect(() => { const t = setTimeout(() => setQAtivo(termoBusca(q)), 350); return () => clearTimeout(t) }, [q])

  const load = useCallback(async () => {
    let qb = supabase.from('atas').select(LISTA).order('data_reuniao', { ascending: false }).order('criado_em', { ascending: false }).limit(1000)
    if (qAtivo) qb = qb.or(`nome.ilike.%${qAtivo}%,resumo.ilike.%${qAtivo}%,texto.ilike.%${qAtivo}%,arquivo_nome.ilike.%${qAtivo}%`)   // a busca também olha dentro do texto, no banco
    const r = await qb
    if (r.error) { setErr('Não foi possível carregar as atas: ' + r.error.message + ' (a migração 015 foi executada?)'); setLoading(false); return }
    setRows((r.data || []) as Ata[]); setErr(''); setLoading(false)
  }, [qAtivo])
  useEffect(() => { load() }, [load])

  // limpeza de arquivos órfãos (atas excluídas há mais de 48 h) — só na pasta do próprio usuário
  useEffect(() => {
    (async () => {
      try {
        const [lst, lx, at] = await Promise.all([
          supabase.storage.from('atas').list(uid, { limit: 1000 }),
          supabase.from('lixeira').select('dados').eq('tabela', 'atas'),
          supabase.from('atas').select('id'),
        ])
        if (lst.error || at.error) return
        const vivos = new Set<string>(((at.data || []) as any[]).map((a) => a.id))
        ;((lx.data || []) as any[]).forEach((x) => x.dados?.id && vivos.add(x.dados.id))
        const orfaos: string[] = []
        for (const pasta of (lst.data || [])) {
          if (!vivos.has(pasta.name)) {
            const sub = await supabase.storage.from('atas').list(`${uid}/${pasta.name}`, { limit: 100 })
            ;(sub.data || []).forEach((f: any) => orfaos.push(`${uid}/${pasta.name}/${f.name}`))
          }
        }
        if (orfaos.length) await supabase.storage.from('atas').remove(orfaos)
      } catch { /* limpeza é opcional */ }
    })()
  }, [uid, rows.length])

  async function baixar(a: Ata) {
    if (!a.arquivo_path) return
    setErr('')
    const r = await supabase.storage.from('atas').createSignedUrl(a.arquivo_path, 60, { download: a.arquivo_nome || true })
    if (r.error || !r.data?.signedUrl) return setErr('Não foi possível abrir o arquivo: ' + (r.error?.message || 'tente novamente.'))
    const l = document.createElement('a'); l.href = r.data.signedUrl; l.rel = 'noopener'; document.body.appendChild(l); l.click(); l.remove()
  }

  const meses = useMemo(() => Array.from(new Set(rows.map((r) => r.data_reuniao.slice(0, 7)))).sort().reverse(), [rows])
  const lista = rows.filter((r) => !mes || r.data_reuniao.startsWith(mes))

  async function abrir(a: Ata) {
    setErr(''); setLendo({ ...a })                       // abre já com o cabeçalho; o texto chega em seguida
    const r = await supabase.from('atas').select('texto').eq('id', a.id).single()
    if (r.error) return setErr('Não foi possível abrir a ata: ' + r.error.message)
    setLendo({ ...a, texto: (r.data as any).texto ?? '' })
  }
  async function editar(a: Ata) {
    const texto = a.texto ?? ((await supabase.from('atas').select('texto').eq('id', a.id).single()).data as any)?.texto ?? ''
    setLendo(null); setOk(''); setForm({ id: a.id, atual: a, v: { nome: a.nome, data_reuniao: a.data_reuniao, resumo: a.resumo || '', texto } })
  }
  async function excluir(a: Ata) {
    if (!(await confirmar({ titulo: 'Excluir ata?', mensagem: <>A ata <b>“{a.nome}”</b>{a.arquivo_path ? ' e o arquivo' : ''} ficam na <b>Lixeira por 48 horas</b> e podem ser restaurados; depois disso some de vez.</>, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('atas').delete().eq('id', a.id)
    if (r.error) return setErr(r.error.message)
    setLendo(null); setOk('Ata excluída. Dá para restaurar na Lixeira por 48 h.'); load()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">📝 Atas importantes</h1>
          <p className="text-sm text-slate-500">Guarde as atas das reuniões que você fez: cole o texto e/ou anexe o arquivo original. Clique numa ata para ler completa. Só você vê as suas atas.</p>
        </div>
        <button className={btnP} onClick={() => { setOk(''); setForm({ v: { ...VAZIO, data_reuniao: todayStr() } }) }}>+ Nova ata</button>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}

      <Card className="!p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Buscar (nome, resumo, texto ou arquivo)" className="min-w-[200px] flex-1"><input className={inp} placeholder="Digite uma palavra…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Mês da reunião"><select className={inp} value={mes} onChange={(e) => setMes(e.target.value)}><option value="">Todos</option>{meses.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}</select></Field>
          <div className="pb-2 text-sm text-slate-500">{lista.length} ata(s)</div>
        </div>
      </Card>

      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : lista.length === 0 ? (
        <Card><Empty>{!qAtivo && !mes ? 'Nenhuma ata guardada ainda. Clique em “+ Nova ata”.' : 'Nenhuma ata com esses filtros.'}</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {lista.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => abrir(a)} className="block w-full rounded-2xl border border-violet-100 bg-white p-4 text-left shadow-sm transition hover:border-violet-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-turq">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[100px] rounded-xl bg-violet-50 px-3 py-2 text-center"><div className="text-xs font-semibold uppercase text-slate-500">Reunião</div><div className="font-bold text-navy">{fmtDate(a.data_reuniao)}</div></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-navy">{a.nome}</h3>
                    {a.arquivo_path && <span className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">📎 {a.arquivo_nome}</span>}
                    {a.resumo && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-slate-700">{a.resumo}</p>}
                    <p className="mt-1 text-xs text-slate-400">Guardada em {fmtDateTime(a.criado_em)}{Date.parse(a.atualizado_em) - Date.parse(a.criado_em) > 2000 ? ` · editada ${fmtDateTime(a.atualizado_em)}` : ''}</p>
                  </div>
                  <span className="self-center text-sm font-semibold text-violet-700">Ler ata ›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lendo && (
        <Modal title={lendo.nome} onClose={() => setLendo(null)} xl>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="rounded-full bg-violet-50 px-3 py-1 font-semibold text-navy">Reunião de {fmtDate(lendo.data_reuniao)}</span>
            <span>Guardada em {fmtDateTime(lendo.criado_em)}</span>
          </div>
          {lendo.resumo && <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm"><b className="text-navy">Resumo:</b> <span className="whitespace-pre-line">{lendo.resumo}</span></div>}
          {lendo.arquivo_path && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <span>📎 {lendo.arquivo_nome} <small className="text-slate-500">({fmtBytes(lendo.arquivo_tamanho)})</small></span>
              <button className={btnP + ' ' + btnSm + ' ml-auto'} onClick={() => baixar(lendo)}>⬇ Baixar arquivo original</button>
            </div>
          )}
          {lendo.texto === undefined ? <p className="py-8 text-center text-slate-500">Carregando a ata…</p>
            : lendo.texto === '' ? (lendo.arquivo_path ? null : <p className="py-6 text-center text-slate-400">Sem texto.</p>)
            : <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800" tabIndex={0} aria-label="Texto completo da ata">{lendo.texto}</div>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className={btnG + ' ' + btnSm + ' !text-red-600'} onClick={() => excluir(lendo)}>Excluir</button>
            <button className={btnG + ' ' + btnSm} disabled={!lendo.texto} onClick={() => navigator.clipboard?.writeText(lendo.texto || '').then(() => setOk('Texto copiado.'), () => setErr('Não foi possível copiar.'))}>Copiar texto</button>
            <button className={btnG + ' ' + btnSm} onClick={() => editar(lendo)}>Editar</button>
            <button className={btnP + ' ' + btnSm} onClick={() => setLendo(null)}>Fechar</button>
          </div>
        </Modal>
      )}
      {form && <AtaForm uid={uid} init={form} onClose={() => setForm(null)} onSaved={(m) => { setForm(null); setOk(m); load() }} />}
    </div>
  )
}

function AtaForm({ uid, init, onClose, onSaved }: { uid: string; init: { id?: string; v: typeof VAZIO; atual?: Ata }; onClose: () => void; onSaved: (msg: string) => void }) {
  const [v, setV] = useState(init.v)
  const [arq, setArq] = useState<File | null>(null)
  const [tirar, setTirar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const atual = init.atual

  function escolher(f: File | null) {
    if (!f) return setArq(null)
    const e = validarArquivo(f); if (e) { setErr(e); setArq(null); if (ref.current) ref.current.value = ''; return }
    setErr(''); setArq(f); setTirar(false)
  }

  async function salvar(e: FormEvent) {
    e.preventDefault(); setErr('')
    const texto = v.texto.replace(/\r\n/g, '\n').trim()
    const ficaArquivo = !!arq || (!!atual?.arquivo_path && !tirar)
    if (!v.nome.trim()) return setErr('Informe o nome da reunião.')
    if (!v.data_reuniao) return setErr('Informe a data em que a reunião aconteceu.')
    if (!texto && !ficaArquivo) return setErr('Cole o texto da ata e/ou anexe o arquivo.')
    if (texto.length > MAX_TEXTO) return setErr(`O texto tem ${texto.length.toLocaleString('pt-BR')} caracteres; o limite é ${MAX_TEXTO.toLocaleString('pt-BR')}. Anexe o arquivo original para ata maior.`)
    setBusy(true)
    const id = init.id || crypto.randomUUID()
    let novo: { path: string; nome: string; tamanho: number } | null = null
    if (arq) {
      const path = `${uid}/${id}/${Date.now()}_${nomeSeguro(arq.name)}`
      const up = await supabase.storage.from('atas').upload(path, arq, { contentType: MIME[extDe(arq.name)] || arq.type, upsert: false })
      if (up.error) { setBusy(false); return setErr('Não foi possível enviar o arquivo: ' + up.error.message) }
      novo = { path, nome: arq.name, tamanho: arq.size }
    }
    const dados: any = { nome: v.nome.trim(), data_reuniao: v.data_reuniao, resumo: v.resumo.trim() || null, texto: texto || null }
    if (novo) Object.assign(dados, { arquivo_path: novo.path, arquivo_nome: novo.nome, arquivo_tamanho: novo.tamanho })
    else if (tirar) Object.assign(dados, { arquivo_path: null, arquivo_nome: null, arquivo_tamanho: null })
    const r = init.id ? await supabase.from('atas').update(dados).eq('id', id) : await supabase.from('atas').insert({ ...dados, id, user_id: uid })
    if (r.error) {
      if (novo) await supabase.storage.from('atas').remove([novo.path])     // não deixa arquivo solto se o registro falhou
      setBusy(false); return setErr('Não foi possível salvar: ' + r.error.message)
    }
    if (atual?.arquivo_path && (novo || tirar)) await supabase.storage.from('atas').remove([atual.arquivo_path])   // troca/remoção do arquivo antigo
    setBusy(false); onSaved(init.id ? 'Ata atualizada.' : 'Ata guardada.')
  }

  const restante = MAX_TEXTO - v.texto.length
  return (
    <Modal title={init.id ? 'Editar ata' : 'Nova ata'} onClose={busy ? () => {} : onClose} wide>
      <form onSubmit={salvar} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Nome da reunião *" className="sm:col-span-2"><input className={inp} maxLength={200} value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} autoFocus /></Field>
        <Field label="Data da reunião *"><input type="date" className={inp} value={v.data_reuniao} max="2100-01-01" onChange={(e) => setV({ ...v, data_reuniao: e.target.value })} /></Field>
        <Field label="Breve resumo" className="sm:col-span-3"><textarea className={inp + ' min-h-[64px]'} maxLength={1000} value={v.resumo} onChange={(e) => setV({ ...v, resumo: e.target.value })} placeholder="Em 1 ou 2 frases: o que foi decidido…" /></Field>
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 sm:col-span-3">
          <span className="mb-1 block text-sm font-medium text-slate-600">📎 Arquivo original da ata (Word ou PDF, até 10 MB) <span className="font-normal text-slate-500">— mantém tabelas, imagens e formatação</span></span>
          {atual?.arquivo_path && !arq && !tirar && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm">
              <span>📎 {atual.arquivo_nome} <small className="text-slate-500">({fmtBytes(atual.arquivo_tamanho)})</small></span>
              <button type="button" className={btnG + ' ' + btnSm + ' ml-auto !text-red-600'} onClick={() => setTirar(true)}>Remover arquivo</button>
            </div>
          )}
          {tirar && <p className="mb-2 text-sm text-amber-700">O arquivo atual será removido ao salvar. <button type="button" className="underline" onClick={() => setTirar(false)}>Desfazer</button></p>}
          <input ref={ref} type="file" accept=".docx,.doc,.pdf" className="block w-full text-sm" onChange={(e) => escolher(e.target.files?.[0] || null)} />
          {arq && <p className="mt-1 text-xs text-slate-500">Selecionado: {arq.name} ({fmtBytes(arq.size)}){atual?.arquivo_path ? ' — substituirá o arquivo atual' : ''}</p>}
        </div>
        <Field label="Texto da ata (cole aqui — opcional se anexar o arquivo)" className="sm:col-span-3">
          <textarea className={inp + ' min-h-[220px] !rounded-xl font-mono text-[13px] leading-relaxed'} value={v.texto} onChange={(e) => setV({ ...v, texto: e.target.value })} placeholder="Cole o texto da ata (Ctrl+V). Serve para ler direto na tela e para a busca." />
          <span className={'text-xs ' + (restante < 0 ? 'font-semibold text-red-600' : 'text-slate-400')}>{v.texto.length.toLocaleString('pt-BR')} / {MAX_TEXTO.toLocaleString('pt-BR')} caracteres · ao colar só o texto entra (tabelas e imagens ficam no arquivo anexado)</span>
        </Field>
        {err && <div className="sm:col-span-3"><Msg kind="erro">{err}</Msg></div>}
        <div className="flex justify-end gap-2 sm:col-span-3">
          <button type="button" className={btnG} disabled={busy} onClick={onClose}>Cancelar</button>
          <button className={btnP} disabled={busy}>{busy ? 'Salvando…' : 'Salvar ata'}</button>
        </div>
      </form>
    </Modal>
  )
}
