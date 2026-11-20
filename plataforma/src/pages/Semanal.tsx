import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, todayStr } from '../lib/rules'
import { confirmar } from '../components/Confirm'
import { btnG, btnP, btnSm, Card, Empty, inp, Msg } from '../components/ui'
import { Bloco, blocosNovos, consolidarPedidos, duplicarBlocos, Item, lerBlocos, moverItem, pedidosTexto, resumoBlocos } from '../lib/semanal'

/** "Semanal Italo": reunião semanal com o diretor. Lista das reuniões + modo condução (um bloco por vez, em tela grande).
 *  Cada texto tem a flag "já discutido"; cada bloco tem a flag "bloco visto". Salva sozinho. Só o dono (Analista Sr) vê. */
interface Sem { id: string; titulo: string; data_reuniao: string; blocos: unknown; atualizado_em: string }
const MAX_IMG = 1400

/** Reduz o print (máx. 1400 px, JPEG) para caber no registro sem pesar.
 *  Não usa URL blob: (a política de segurança do site só admite imagens do próprio site e data:). */
async function reduzir(f: File): Promise<string> {
  let fonte: CanvasImageSource, w: number, h: number
  if (typeof createImageBitmap === 'function') {
    try { const bm = await createImageBitmap(f); fonte = bm; w = bm.width; h = bm.height } catch { fonte = null as never; w = 0; h = 0 }
  } else { fonte = null as never; w = 0; h = 0 }
  if (!fonte) {   // alternativa: lê o arquivo como data URL
    const du = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('leitura')); r.readAsDataURL(f) })
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('imagem inválida')); i.src = du })
    fonte = img; w = img.width; h = img.height
  }
  const k = Math.min(1, MAX_IMG / Math.max(w, h))
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(fonte, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

/** Texto editável sem perder o cursor: o DOM só é reescrito quando o valor mudou por fora. */
function Edita({ valor, onChange, className = '', ativo }: { valor: string; onChange: (v: string) => void; className?: string; ativo: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (ref.current && ref.current.textContent !== valor) ref.current.textContent = valor }, [valor])
  return <span ref={ref} className={className + (ativo ? ' rounded px-1 hover:bg-violet-50 focus:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-400' : '')} contentEditable={ativo} suppressContentEditableWarning role={ativo ? 'textbox' : undefined}
    onInput={(e) => onChange(e.currentTarget.textContent || '')}
    onPaste={(e) => { if (e.clipboardData.files.length) return; e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) }} />
}

export default function Semanal() {
  const [lista, setLista] = useState<Sem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.from('semanais').select('id,titulo,data_reuniao,blocos,atualizado_em').order('data_reuniao', { ascending: false }).order('criado_em', { ascending: false }).limit(200)
    if (r.error) { setErr('Não foi possível carregar: ' + r.error.message + ' (a migração 028 foi executada?)'); setLoading(false); return }
    setLista((r.data || []) as Sem[]); setErr(''); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function criar(base?: Sem) {
    const r = await supabase.from('semanais').insert({ titulo: 'Semanal Italo', data_reuniao: todayStr(), blocos: base ? duplicarBlocos(lerBlocos(base.blocos)) : blocosNovos() }).select('id').single()
    if (r.error) { setErr('Não foi possível criar: ' + r.error.message); return }
    await load(); setAberta(r.data.id)
  }
  async function excluir(s: Sem) {
    if (!(await confirmar({ titulo: 'Excluir esta semanal?', mensagem: `“${s.titulo}” de ${fmtDate(s.data_reuniao)} será apagada com textos e imagens. Não dá para desfazer.`, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('semanais').delete().eq('id', s.id)
    if (r.error) { setErr('Não foi possível excluir: ' + r.error.message); return }
    load()
  }

  if (aberta) return <Condutor id={aberta} onVoltar={() => { setAberta(null); load() }} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1"><h1 className="text-xl font-semibold text-ink">Semanal Italo</h1>
          <p className="text-sm text-slate-500">Acompanhamento semanal com o diretor: Básico, Implantações, Melhorias e customizações, Atualização das atividades e Próximos passos. Só você vê.</p></div>
        <button className={btnP} onClick={() => criar()}>+ Nova semanal</button>
        {lista[0] && <button className={btnG} onClick={() => criar(lista[0])} title="Copia os textos da última semanal (sem marcações e sem imagens)">Duplicar a última</button>}
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : lista.length === 0 ? <Empty>Nenhuma semanal ainda. Clique em “Nova semanal” para começar.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((s) => { const r = resumoBlocos(lerBlocos(s.blocos)); return (
            <Card key={s.id} className="flex flex-col gap-2">
              <button className="text-left" onClick={() => setAberta(s.id)}>
                <div className="text-xs font-semibold text-violet-600">{fmtDate(s.data_reuniao)}</div>
                <div className="text-lg font-bold text-navy">{s.titulo}</div>
                <div className="mt-1 text-xs text-slate-500">{r.vistos}/5 blocos vistos · {r.textos} texto(s) · {r.imagens} imagem(ns) · {r.pedidos} pedido(s){r.pedidosAbertos ? ` (${r.pedidosAbertos} em aberto)` : ''}</div>
              </button>
              <div className="mt-auto flex gap-2 pt-2"><button className={btnP + ' ' + btnSm} onClick={() => setAberta(s.id)}>Abrir</button><button className={btnG + ' ' + btnSm + ' !text-red-600'} onClick={() => excluir(s)}>Excluir</button></div>
            </Card>) })}
        </div>)}
    </div>
  )
}

function Condutor({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const [titulo, setTitulo] = useState(''); const [data, setData] = useState(todayStr())
  const [blocos, setBlocos] = useState<Bloco[]>(blocosNovos())
  const [cur, setCur] = useState(0); const [edit, setEdit] = useState(true)
  const [carregado, setCarregado] = useState(false); const [err, setErr] = useState('')
  const [estado, setEstado] = useState<'salvo' | 'salvando' | 'erro'>('salvo')
  const [novo, setNovo] = useState(''); const [novoPed, setNovoPed] = useState(''); const [zoom, setZoom] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null); const sujo = useRef(false)
  // em tela cheia o menu some (classe no <html>, tratada no index.css); ao sair ou fechar a semanal ele volta
  useEffect(() => {
    const h = () => document.documentElement.classList.toggle('tela-cheia', !!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h); h()
    return () => { document.removeEventListener('fullscreenchange', h); document.documentElement.classList.remove('tela-cheia'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, [])

  useEffect(() => { (async () => {
    const r = await supabase.from('semanais').select('titulo,data_reuniao,blocos').eq('id', id).single()
    if (r.error) { setErr('Não foi possível abrir: ' + r.error.message); return }
    setTitulo(r.data.titulo); setData(r.data.data_reuniao); setBlocos(lerBlocos(r.data.blocos)); setCarregado(true)
  })() }, [id])

  const alterar = (fn: (b: Bloco[]) => Bloco[]) => { sujo.current = true; setEstado('salvando'); setBlocos(fn) }
  const doBloco = (fn: (b: Bloco) => Bloco) => alterar((bs) => bs.map((b, i) => (i === cur ? fn(b) : b)))

  // salvamento automático (aguarda 1 s sem alterações)
  useEffect(() => {
    if (!carregado || !sujo.current) return
    const t = setTimeout(async () => {
      const r = await supabase.from('semanais').update({ titulo: titulo.trim() || 'Semanal Italo', data_reuniao: data || todayStr(), blocos }).eq('id', id)
      if (r.error) { setEstado('erro'); setErr('Não foi possível salvar: ' + r.error.message) } else { setEstado('salvo'); setErr(''); sujo.current = false }
    }, 1000)
    return () => clearTimeout(t)
  }, [blocos, titulo, data, carregado, id])

  const consol = cur >= blocos.length
  const b = blocos[Math.min(cur, blocos.length - 1)]
  const alterarPedidos = (bi: number, fn: (p: Bloco['pedidos']) => Bloco['pedidos']) => alterar((bs) => bs.map((x, j) => (j === bi ? { ...x, pedidos: fn(x.pedidos) } : x)))
  const addPedido = () => { const v = novoPed.trim(); if (!v) return; alterarPedidos(cur, (p) => [...p, { v, ok: false }]); setNovoPed('') }
  const todosPed = consolidarPedidos(blocos)
  const [copiado, setCopiado] = useState(false)
  const go = useCallback((i: number) => { setCur(Math.max(0, Math.min(blocos.length, i))); window.scrollTo({ top: 0 }) }, [blocos.length])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null)
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return
      if (e.key === 'ArrowRight') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1)
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [cur, go])

  async function addFiles(fs: FileList | File[]) {
    for (const f of Array.from(fs)) {
      if (!f.type.startsWith('image/')) continue
      try { const src = await reduzir(f); doBloco((x) => ({ ...x, items: [...x.items, { k: 'i', src, cap: '' }] })) } catch (e) { setErr('Não foi possível ler a imagem' + (f.type ? ` (${f.type})` : '') + '. Tente um print em PNG ou JPG.') }
    }
  }
  useEffect(() => {
    const h = (e: globalThis.ClipboardEvent) => { const fs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addFiles(fs) } }
    document.addEventListener('paste', h); return () => document.removeEventListener('paste', h)
  })

  const add = () => { const v = novo.trim(); if (!v) return; doBloco((x) => ({ ...x, items: [...x.items, { k: 't', v, d: false }] })); setNovo('') }
  const setItem = (i: number, p: Partial<Item>) => doBloco((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? ({ ...it, ...p } as Item) : it)) }))
  const rm = (i: number) => doBloco((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))
  const mv = (i: number, d: -1 | 1) => doBloco((x) => ({ ...x, items: moverItem(x.items, i, d) }))
  const txt = useMemo(() => (b ? b.items.map((it, i) => ({ it, i })).filter((x) => x.it.k === 't') : []), [b])
  const img = useMemo(() => (b ? b.items.map((it, i) => ({ it, i })).filter((x) => x.it.k === 'i') : []), [b])
  const tools = (i: number) => edit && (
    <span className="flex flex-none items-center text-slate-400">
      <button className="rounded px-1.5 hover:bg-slate-100" onClick={() => mv(i, -1)} aria-label="Subir">↑</button><button className="rounded px-1.5 hover:bg-slate-100" onClick={() => mv(i, 1)} aria-label="Descer">↓</button>
      <button className="rounded px-1.5 hover:bg-slate-100 hover:text-red-600" onClick={() => rm(i)} aria-label="Remover">✕</button></span>)

  if (err && !carregado) return <div><Msg kind="erro">{err}</Msg><button className={btnG} onClick={onVoltar}>← Voltar</button></div>
  if (!carregado) return <p className="py-10 text-center text-slate-500">Carregando…</p>
  const vistos = blocos.filter((x) => x.done).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnG + ' ' + btnSm} onClick={onVoltar}>← Semanais</button>
        <input className={inp + ' !w-auto min-w-[200px] flex-1 !py-1.5 font-semibold'} value={titulo} onChange={(e) => { sujo.current = true; setEstado('salvando'); setTitulo(e.target.value) }} aria-label="Título" maxLength={200} />
        <input type="date" className={inp + ' !w-auto !py-1.5'} value={data} onChange={(e) => { sujo.current = true; setEstado('salvando'); setData(e.target.value) }} aria-label="Data da reunião" />
        <span className={'text-xs ' + (estado === 'erro' ? 'text-red-600' : 'text-slate-500')} aria-live="polite">{estado === 'salvo' ? 'Salvo' : estado === 'salvando' ? 'Salvando…' : 'Erro ao salvar'}</span>
        <button className={btnG + ' ' + btnSm} aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? 'Editando' : 'Modo reunião'}</button>
        <button className={btnG + ' ' + btnSm} onClick={() => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) }}>Tela cheia</button>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Blocos da reunião">
        {blocos.map((x, i) => (
          <button key={i} role="tab" aria-selected={i === cur} onClick={() => go(i)} className={'flex min-w-[130px] flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ' + (i === cur ? 'border-navy bg-navy text-white' : 'border-violet-200 bg-white hover:border-violet-400')}>
            <span className={'grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ' + (x.done ? 'bg-green-600 text-white' : i === cur ? 'bg-violet-500 text-white' : 'bg-violet-100 text-slate-500')}>{x.done ? '✓' : i + 1}</span>
            <span className="text-[13px] font-semibold leading-tight">{x.n}</span>
          </button>))}
        <button role="tab" aria-selected={consol} onClick={() => go(blocos.length)} className={'flex min-w-[130px] flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ' + (consol ? 'border-navy bg-navy text-white' : 'border-amber-300 bg-amber-50 text-slate-700 hover:bg-amber-100')}>
          <span className={'grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ' + (consol ? 'bg-amber-400 text-navy' : 'bg-amber-200 text-amber-900')}>{todosPed.filter((x) => !x.ok).length}</span>
          <span className="text-[13px] font-semibold leading-tight">Consolidado de pedidos</span>
        </button>
      </div>
      <section className="flex min-h-[60vh] flex-col rounded-lg border border-violet-100 bg-white">
        <div className="rounded-t-3xl bg-navy px-5 py-5 text-white sm:px-9">
          <div className="text-xs font-semibold opacity-75">{consol ? 'Fechamento da reunião' : `Tópico ${cur + 1} de ${blocos.length} · ${vistos}/${blocos.length} vistos`}</div>
          <h2 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">{consol ? 'Consolidado de pedidos' : b.n}</h2>
        </div>
        {consol ? (
        <div className="flex-1 space-y-6 p-5 sm:p-9">
          {todosPed.length === 0 ? <Empty>Nenhum pedido registrado. Em cada etapa há o quadro “Pedidos desta etapa”.</Empty> : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span><b>{todosPed.length}</b> pedido(s) · <b className="text-amber-700">{todosPed.filter((x) => !x.ok).length}</b> em aberto · <b className="text-green-700">{todosPed.filter((x) => x.ok).length}</b> atendido(s)</span>
                <button className={btnG + ' ' + btnSm + ' ml-auto'} onClick={async () => { try { await navigator.clipboard.writeText(pedidosTexto(blocos, `${titulo} — ${fmtDate(data)}`)); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { setErr('Não foi possível copiar. Selecione o texto manualmente.') } }}>{copiado ? 'Copiado ✓' : 'Copiar lista'}</button>
              </div>
              {blocos.map((x, bi) => x.pedidos.length > 0 && (
                <div key={bi}>
                  <h3 className="mb-2 text-sm font-bold text-violet-700">{x.n} <span className="font-normal text-slate-400">({x.pedidos.length})</span></h3>
                  <ul className="space-y-2">
                    {x.pedidos.map((p, pi) => (
                      <li key={pi} className="flex items-start gap-3.5 text-lg leading-snug sm:text-xl">
                        <input type="checkbox" checked={p.ok} onChange={(e) => alterarPedidos(bi, (a) => a.map((q, j) => (j === pi ? { ...q, ok: e.target.checked } : q)))} className="mt-1 h-5 w-5 flex-none accent-green-600" aria-label="Pedido atendido" title="Marcar como atendido" />
                        <span className={p.ok ? 'text-slate-400 line-through' : 'text-slate-900'}>{p.v}</span>
                      </li>))}
                  </ul>
                </div>))}
            </>)}
        </div>
        ) : (
        <div className="flex-1 p-5 sm:p-9">
          {txt.length > 0 && (
            <ul className="space-y-3">
              {txt.map(({ it, i }) => it.k === 't' && (
                <li key={i} className="flex items-start gap-3.5 text-xl leading-snug sm:text-2xl">
                  <input type="checkbox" checked={it.d} onChange={(e) => setItem(i, { d: e.target.checked })} className="mt-1.5 h-6 w-6 flex-none accent-green-600" aria-label="Já discutido" title="Marcar como discutido" />
                  <Edita valor={it.v} ativo={edit} onChange={(v) => setItem(i, { v })} className={'min-w-0 flex-1 ' + (it.d ? 'text-slate-400 line-through' : 'text-slate-900')} />
                  {tools(i)}
                </li>))}
            </ul>)}
          {img.length > 0 && (
            <div className="mt-7 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))' }}>
              {img.map(({ it, i }) => it.k === 'i' && (
                <figure key={i} className="overflow-hidden rounded-xl border border-violet-100 bg-white">
                  <img src={it.src} alt={it.cap || 'Imagem da reunião'} className="block h-auto w-full cursor-zoom-in" onClick={() => setZoom(it.src)} />
                  <figcaption className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500"><Edita valor={it.cap} ativo={edit} onChange={(v) => setItem(i, { cap: v })} className="min-w-0 flex-1" />{edit && !it.cap && <span className="text-xs text-slate-300">legenda…</span>}{tools(i)}</figcaption>
                </figure>))}
            </div>)}
          {txt.length === 0 && img.length === 0 && <Empty>Nada neste tópico ainda.{edit ? ' Adicione texto ou imagem abaixo.' : ''}</Empty>}
          {edit && (
            <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-violet-300 p-3 text-sm text-slate-500">
              <input className={inp + ' !w-auto min-w-[180px] flex-1 !py-1.5'} placeholder="Novo texto e Enter" value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} aria-label="Novo texto" maxLength={600} />
              <button className={btnP + ' ' + btnSm} onClick={add}>Adicionar texto</button>
              <button className={btnG + ' ' + btnSm} onClick={() => fileRef.current?.click()}>Adicionar imagem</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
              <span>ou cole um print com Ctrl+V</span>
            </div>)}
          <div className="mt-8 rounded-md border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
            <h3 className="text-sm font-bold text-amber-800">Pedidos desta etapa <span className="font-normal text-amber-700/70">({b.pedidos.length})</span></h3>
            {b.pedidos.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhum pedido nesta etapa.</p>}
            <ul className="mt-2 space-y-2">
              {b.pedidos.map((p, pi) => (
                <li key={pi} className="flex items-start gap-3 text-lg leading-snug">
                  <input type="checkbox" checked={p.ok} onChange={(e) => alterarPedidos(cur, (a) => a.map((q, j) => (j === pi ? { ...q, ok: e.target.checked } : q)))} className="mt-1 h-5 w-5 flex-none accent-green-600" aria-label="Pedido atendido" title="Marcar como atendido" />
                  <Edita valor={p.v} ativo={edit} onChange={(v) => alterarPedidos(cur, (a) => a.map((q, j) => (j === pi ? { ...q, v } : q)))} className={'min-w-0 flex-1 ' + (p.ok ? 'text-slate-400 line-through' : 'text-slate-900')} />
                  {edit && <button className="rounded px-1.5 text-slate-400 hover:bg-white hover:text-red-600" onClick={() => alterarPedidos(cur, (a) => a.filter((_, j) => j !== pi))} aria-label="Remover pedido">✕</button>}
                </li>))}
            </ul>
            {edit && <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className={inp + ' !w-auto min-w-[180px] flex-1 !py-1.5'} placeholder="Novo pedido e Enter" value={novoPed} onChange={(e) => setNovoPed(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPedido() } }} />
              <button className={btnP + ' ' + btnSm} onClick={addPedido}>Adicionar pedido</button>
            </div>}
          </div>
        </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-violet-100 px-5 py-3 sm:px-9">
          <button className={btnG} onClick={() => go(cur - 1)} disabled={cur === 0}>← Anterior</button>
          <button className={(b.done ? btnG : btnG + ' !border-green-600 !text-green-700') + ' !px-4'} onClick={() => doBloco((x) => ({ ...x, done: !x.done }))} aria-pressed={b.done} hidden={consol}>{b.done ? '✓ Bloco visto (reabrir)' : 'Marcar bloco como visto'}</button>
          <button className={btnP} onClick={() => go(cur + 1)} disabled={cur === blocos.length}>Próximo →</button>
        </div>
      </section>
      {zoom && <div className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-6" role="dialog" aria-label="Imagem ampliada" onClick={() => setZoom(null)}><img src={zoom} alt="" className="max-h-full max-w-full rounded bg-white" /></div>}
    </div>
  )
}
