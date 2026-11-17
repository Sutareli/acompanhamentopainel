import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, inp, Msg } from './ui'

export interface Comentario { id: number; entidade: 'melhoria' | 'atividade'; entidade_id: string; autor_id: string; texto: string; mencoes: string[]; criado_em: string }
interface Pessoa { id: string; nome: string }

/** Comentários e menções (@nome) em uma ideia/correção ou em um projeto/atividade. Quem é mencionado vê o aviso no painel “Atenção”. */
export default function Comentarios({ entidade, id }: { entidade: 'melhoria' | 'atividade'; id: string }) {
  const { profile } = useAuth()
  const [lista, setLista] = useState<Comentario[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const nome = (uid: string) => pessoas.find((p) => p.id === uid)?.nome || 'Usuário'

  const load = useCallback(async () => {
    const r = await supabase.from('comentarios').select('*').eq('entidade', entidade).eq('entidade_id', id).order('criado_em', { ascending: true })
    if (r.error) return setErr(r.error.message.includes('comentarios') ? 'Comentários indisponíveis: a migração 025 ainda não foi aplicada.' : r.error.message)
    setErr(''); setLista((r.data || []) as Comentario[])
  }, [entidade, id])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.from('profiles').select('id,nome').eq('ativo', true).order('nome').then((r) => setPessoas((r.data || []) as Pessoa[])) }, [])

  const mencionar = (pid: string) => { const p = pessoas.find((x) => x.id === pid); if (p) setTexto((t) => (t && !t.endsWith(' ') ? t + ' ' : t) + '@' + p.nome + ' ') }
  async function enviar() {
    const t = texto.trim(); if (!t) return
    setBusy(true); setErr('')
    const mencoes = pessoas.filter((p) => t.includes('@' + p.nome)).map((p) => p.id)
    const r = await supabase.from('comentarios').insert({ entidade, entidade_id: id, autor_id: profile!.id, texto: t, mencoes })
    setBusy(false)
    if (r.error) return setErr('Não foi possível comentar: ' + r.error.message)
    setTexto(''); load()
  }
  async function apagar(c: Comentario) {
    const r = await supabase.from('comentarios').delete().eq('id', c.id)
    if (r.error) return setErr(r.error.message)
    load()
  }
  /** destaca @Nome no texto */
  const render = (t: string) => {
    const nomes = pessoas.map((p) => p.nome).sort((a, b) => b.length - a.length)
    const partes: (string | JSX.Element)[] = []; let resto = t, k = 0
    while (resto) {
      const i = resto.indexOf('@'); if (i < 0) { partes.push(resto); break }
      partes.push(resto.slice(0, i)); resto = resto.slice(i)
      const n = nomes.find((x) => resto.startsWith('@' + x))
      if (n) { partes.push(<b key={k++} className="rounded bg-violet-100 px-1 text-violet-800">@{n}</b>); resto = resto.slice(n.length + 1) } else { partes.push('@'); resto = resto.slice(1) }
    }
    return partes
  }

  return (
    <Card className="!p-4">
      <h4 className="mb-2 font-bold text-navy">💬 Comentários {lista.length > 0 && <span className="text-sm font-normal text-slate-500">({lista.length})</span>}</h4>
      {err && <Msg kind="erro">{err}</Msg>}
      {lista.length === 0 ? <p className="mb-3 text-sm text-slate-400">Nenhum comentário ainda. Use para registrar decisões, dúvidas e combinados.</p> : (
        <ul className="mb-3 space-y-2">
          {lista.map((c) => (
            <li key={c.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span><b className="text-navy">{nome(c.autor_id)}</b> · {fmtDateTime(c.criado_em)}</span>
                {(c.autor_id === profile?.id || canAdmin(profile!.perfil)) && <button className="text-red-600 underline" aria-label="Apagar comentário" onClick={() => apagar(c)}>apagar</button>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-800">{render(c.texto)}</p>
            </li>
          ))}
        </ul>
      )}
      <textarea className={inp + ' min-h-[70px]'} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva um comentário… (use “Mencionar” para chamar alguém)" aria-label="Novo comentário" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-violet-300 bg-white px-2 py-1.5 text-xs text-navy" aria-label="Mencionar" value="" onChange={(e) => { mencionar(e.target.value) }}>
          <option value="">@ Mencionar…</option>{pessoas.filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <button className={btnP + ' ' + btnSm} disabled={busy || !texto.trim()} onClick={enviar}>{busy ? 'Enviando…' : 'Comentar'}</button>
        {texto && <button className={btnG + ' ' + btnSm} onClick={() => setTexto('')}>Limpar</button>}
        <span className="ml-auto text-[11px] text-slate-400">{texto.length}/2000</span>
      </div>
    </Card>
  )
}
