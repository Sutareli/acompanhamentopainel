import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { download, fmtDate, fmtDateTime } from '../lib/rules'
import { fmtPct, lerMetas, LeituraMetas, modeloMetasCsv, pct, Produto, serieEvolucao, Site, SITES, Snapshot, validarNumeros } from '../lib/metas'
import { btnG, btnP, btnSm, Card, Empty, Field, inp, Modal, Msg } from '../components/ui'
import { confirmar } from '../components/Confirm'

// Cores do layout de referência
const AZUL = '#0b2461', VERDE = '#1fa65a', CINZA = '#dcdcdc', CINZA_T = '#d3d3d3'
const ALT = 76   // altura de cada linha de produto

async function lerArquivo(f: File): Promise<string> {
  const buf = await f.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}

/** Cor do FUNDO do logotipo (ex.: Keeta amarelo, Banco PAN preto).
 *  1) Olha a borda da imagem: se a maior parte dela tem uma mesma cor sólida, essa é a cor do fundo (funciona mesmo com muito texto por cima).
 *  2) Senão, usa a cor que mais aparece, mas só se ocupar boa parte da imagem.
 *  Logotipo de letras/ícone sobre transparente ou branco devolve null (cartão branco, para o desenho não sumir). */
async function corDoFundo(url: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('x')); i.src = url })
    const nw = img.naturalWidth || 140, nh = img.naturalHeight || 60, k = Math.min(1, 96 / nw, 96 / nh)
    const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const branco = (i: number) => d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] < 40 || branco(i)) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 < 0) return null
    // 1) anel de 3 px junto à borda do desenho
    const anel: number[][] = []; let totalAnel = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x - x0 >= 3 && x1 - x >= 3 && y - y0 >= 3 && y1 - y >= 3) continue
      totalAnel++; const i = (y * w + x) * 4
      if (d[i + 3] >= 40 && !branco(i)) anel.push([d[i], d[i + 1], d[i + 2]])
    }
    if (anel.length / totalAnel >= 0.55) {
      const med = [0, 1, 2].map((ch) => { const v = anel.map((p) => p[ch]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] })
      const perto = anel.filter((p) => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]) < 70).length
      if (perto / totalAnel >= 0.5) return `rgb(${med[0]}, ${med[1]}, ${med[2]})`
    }
    // 2) cor que mais aparece (agrupada em baldes), exigindo que ocupe boa parte da área do desenho
    const baldes = new Map<number, { n: number; r: number; g: number; b: number }>()
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4; if (d[i + 3] < 40 || branco(i)) continue
      const kk = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4), o = baldes.get(kk) || { n: 0, r: 0, g: 0, b: 0 }
      o.n++; o.r += d[i]; o.g += d[i + 1]; o.b += d[i + 2]; baldes.set(kk, o)
    }
    let melhor: { n: number; r: number; g: number; b: number } | null = null
    baldes.forEach((o) => { if (!melhor || o.n > melhor.n) melhor = o })
    const m = melhor as { n: number; r: number; g: number; b: number } | null
    if (!m || m.n / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.45) return null
    return `rgb(${Math.round(m.r / m.n)}, ${Math.round(m.g / m.n)}, ${Math.round(m.b / m.n)})`
  } catch { return null }
}

/** Tira as margens transparentes ou brancas em volta do logotipo, para ele preencher o quadro e ficar centralizado. */
function recortarMargens(c: HTMLCanvasElement): HTMLCanvasElement {
  try {
    const ctx = c.getContext('2d')!, { width: w, height: h } = c, d = ctx.getImageData(0, 0, w, h).data
    const vazio = (i: number) => d[i + 3] < 12 || (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244)
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!vazio((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 < 0) return c
    const m = 2; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m)
    const nw = x1 - x0 + 1, nh = y1 - y0 + 1
    if (nw >= w - 2 && nh >= h - 2) return c
    const o = document.createElement('canvas'); o.width = nw; o.height = nh
    o.getContext('2d')!.drawImage(c, x0, y0, nw, nh, 0, 0, nw, nh)
    return o
  } catch { return c }
}

/** Reduz a imagem escolhida (máx. 320×160) e devolve como data URL. SVG é mantido como veio. */
async function reduzirLogo(f: File): Promise<string> {
  if (!f.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (PNG, JPG ou SVG).')
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Não foi possível ler a imagem.')); r.readAsDataURL(f) })
  if (f.type === 'image/svg+xml') { if (url.length > 250000) throw new Error('SVG muito pesado (máximo ~180 KB). Use PNG.'); return url }
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = url })
  const k = Math.min(1, 320 / img.width, 160 / img.height)
  let c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  c = recortarMargens(c)
  const out = c.toDataURL('image/png')
  if (out.length > 280000) throw new Error('Imagem muito complexa. Use um logotipo mais simples ou menor.')
  return out
}

export default function ValidacaoMetas({ podeEditar }: { podeEditar: boolean }) {
  const [lista, setLista] = useState<Produto[]>([])
  const [filtroSite, setFiltroSite] = useState<'' | Site | 'SEM'>('')   // '' = todos os sites
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [editando, setEditando] = useState(false)                     // modo "editar números"
  const [rascunho, setRascunho] = useState<Record<string, { h: string; a: string; d: string }>>({})
  const [form, setForm] = useState<{ id?: string; nome: string; logo: string | null; sites: Site[] } | null>(null)   // cadastro/edição de produto
  const [evol, setEvol] = useState<Produto | null>(null)
  const [apres, setApres] = useState(false)   // modo apresentação (tela cheia, sem menus nem botões de edição)
  const [escala, setEscala] = useState(1)
  const [duas, setDuas] = useState(false)   // apresentação com a lista dividida em 2 colunas
  const [fundos, setFundos] = useState<Record<string, string | null>>({})   // cor de fundo do cartão de cada logotipo (chave = o próprio data URL)
  const [hist, setHist] = useState<Record<string, Snapshot[]>>({})   // instantâneos por produto (mini evolução ao lado de cada linha)
  const [imp, setImp] = useState<{ nome: string; r: LeituraMetas } | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.from('metas_produtos').select('*').order('ordem').order('nome')
    if (r.error) { setErr('Não foi possível carregar: ' + r.error.message + ' (a migração 032 foi executada?)'); setLoading(false); return }
    setLista((r.data || []) as Produto[]); setErr(''); setLoading(false)
    const h = await supabase.from('metas_historico').select('*').order('registrado_em').limit(5000)
    const m: Record<string, Snapshot[]> = {}; ((h.data || []) as Snapshot[]).forEach((s) => { (m[s.produto_id] ||= []).push(s) }); setHist(m)
  }, [])
  useEffect(() => { load() }, [load])

  const iniciarEdicao = () => { setRascunho(Object.fromEntries(lista.map((p) => [p.id, { h: String(p.habilitados), a: String(p.antes), d: String(p.depois) }]))); setEditando(true); setOk('') }
  async function salvarNumeros() {
    const mud: { p: Produto; h: number; a: number; d: number }[] = []
    for (const p of lista) {
      const x = rascunho[p.id]; if (!x) continue
      const h = Number(x.h), a = Number(x.a), d = Number(x.d)
      const e = validarNumeros(h, a, d); if (e) { setErr(`${p.nome}: ${e}`); return }
      if (h !== p.habilitados || a !== p.antes || d !== p.depois) mud.push({ p, h, a, d })
    }
    if (!mud.length) { setEditando(false); setErr(''); return }
    for (const m of mud) {
      const r = await supabase.from('metas_produtos').update({ habilitados: m.h, antes: m.a, depois: m.d }).eq('id', m.p.id)
      if (r.error) { setErr(`Não foi possível salvar ${m.p.nome}: ${r.error.message}`); await load(); return }
    }
    setEditando(false); setErr(''); setOk(`${mud.length} produto(s) atualizado(s). A evolução ficou registrada no histórico.`); load()
  }
  async function salvarProduto() {
    if (!form) return
    const nome = form.nome.trim(); if (!nome) { setErr('Informe o nome do produto.'); return }
    const r = form.id
      ? await supabase.from('metas_produtos').update({ nome, logo: form.logo, sites: form.sites }).eq('id', form.id)
      : await supabase.from('metas_produtos').insert({ nome, logo: form.logo, sites: form.sites, ordem: (lista.reduce((m, p) => Math.max(m, p.ordem), 0) || 0) + 1 })
    if (r.error) { setErr(r.error.code === '23505' ? 'Já existe um produto com esse nome.' : 'Não foi possível salvar: ' + r.error.message); return }
    setForm(null); setErr(''); setOk(form.id ? 'Produto atualizado.' : 'Produto cadastrado. Preencha os números em “Editar números” ou importe a base.'); load()
  }
  async function excluir(p: Produto) {
    if (!(await confirmar({ titulo: 'Excluir este produto?', mensagem: `“${p.nome}” sai do quadro e o histórico de evolução dele também é apagado. Não dá para desfazer.`, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('metas_produtos').delete().eq('id', p.id)
    if (r.error) setErr('Não foi possível excluir: ' + r.error.message); else load()
  }
  // com filtro de site ativo, subir/descer troca de lugar com o vizinho que está à vista
  async function mover(p: Produto, delta: -1 | 1) {
    const i = visiveis.findIndex((x) => x.id === p.id), o = visiveis[i + delta]; if (!o) return
    const a = await supabase.from('metas_produtos').update({ ordem: o.ordem }).eq('id', p.id)
    const b = await supabase.from('metas_produtos').update({ ordem: p.ordem }).eq('id', o.id)
    if (a.error || b.error) setErr('Não foi possível reordenar.'); else load()
  }
  async function escolherCsv(f: File | undefined) {
    setImp(null); setOk(''); if (!f) return
    if (f.size > 2 * 1024 * 1024) { setErr('Arquivo muito grande para este módulo (máximo de 2 MB).'); return }
    setImp({ nome: f.name, r: lerMetas(await lerArquivo(f)) }); setErr('')
  }
  async function importar() {
    if (!imp || !imp.r.itens.length) return
    const r = await supabase.rpc('metas_importar', { p_rows: imp.r.itens })
    if (r.error) { setErr('Não foi possível importar: ' + r.error.message); return }
    const d = r.data as { criados: number; atualizados: number }
    setImp(null); setErr(''); setOk(`Base importada: ${d.atualizados} produto(s) atualizado(s) e ${d.criados} novo(s). Os novos ficaram sem logotipo: use “Editar” na linha para enviar a imagem.`); load()
  }

  useEffect(() => {
    let vivo = true
    lista.forEach((p) => { if (p.logo && !(p.logo in fundos)) corDoFundo(p.logo).then((c) => { if (vivo) setFundos((f) => (p.logo! in f ? f : { ...f, [p.logo!]: c })) }) })
    return () => { vivo = false }
  }, [lista, fundos])
  // tela cheia: o menu some (classe no <html>, tratada no index.css, igual ao Status Rocco); ao sair ou fechar a tela ele volta
  useEffect(() => {
    const h = () => { const on = !!document.fullscreenElement; document.documentElement.classList.toggle('tela-cheia', on); setApres(on) }
    document.addEventListener('fullscreenchange', h); h()
    return () => { document.removeEventListener('fullscreenchange', h); document.documentElement.classList.remove('tela-cheia'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, [])
  const alternarApresentacao = () => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) }
  const visiveis = filtroSite ? lista.filter((p) => (filtroSite === 'SEM' ? !(p.sites || []).length : (p.sites || []).includes(filtroSite))) : lista
  const contar = (f: '' | Site | 'SEM') => (f ? lista.filter((p) => (f === 'SEM' ? !(p.sites || []).length : (p.sites || []).includes(f))).length : lista.length)
  // na apresentação o quadro é ampliado para ocupar a tela (largura e altura) e ← → passam de um site para o outro
  useEffect(() => {
    if (!apres) { setEscala(1); setDuas(false); return }
    const ajustar = () => {
      const n = visiveis.length, L = window.innerWidth - 64, A = window.innerHeight - 120
      const s1 = Math.min(L / 1090, A / (250 + n * ALT))                                  // tudo numa coluna
      const s2 = Math.min(L / (2 * 1090 + 16), A / (250 + Math.ceil(n / 2) * ALT))        // duas colunas lado a lado
      const dividir = n >= 6 && s1 < 1 && s2 > s1
      setDuas(dividir); setEscala(Math.max(0.5, Math.min(2.2, dividir ? s2 : s1)))
    }
    ajustar(); window.addEventListener('resize', ajustar); return () => window.removeEventListener('resize', ajustar)
  }, [apres, visiveis.length])
  useEffect(() => {
    if (!apres) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const op = (['', ...SITES, 'SEM'] as ('' | Site | 'SEM')[]).filter((f) => f === '' || contar(f) > 0)
      const i = Math.max(0, op.indexOf(filtroSite)); setFiltroSite(op[(i + (e.key === 'ArrowRight' ? 1 : op.length - 1)) % op.length])
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })
  const nomeLogo = (p: Produto) => (
    <div className="relative grid h-[60px] w-[116px] place-items-stretch rounded-xl p-2 shadow-[0_1px_2px_rgba(15,23,42,.08)] ring-1 ring-slate-200/80" style={{ background: (p.logo && fundos[p.logo]) || '#fff' }}>
      {p.logo
        ? <span className="relative block h-full w-full"><img src={p.logo} alt={p.nome} title={p.nome} className="absolute inset-0 h-full w-full rounded-md object-contain object-center" /></span>
        : <span className="grid place-items-center text-center text-[12px] font-semibold leading-tight text-slate-600">{p.nome}</span>}
      {(p.sites || []).length > 0 && (
        <span className="absolute -top-2 right-1 flex gap-0.5" title={`Site${(p.sites || []).length > 1 ? 's' : ''}: ${(p.sites || []).join(', ')}`}>
          {SITES.filter((s) => (p.sites || []).includes(s)).map((s) => <span key={s} className="rounded-full bg-[#0b2461] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-2 ring-[#f3f4f6]">{s}</span>)}
        </span>)}
    </div>)
  // cada linha tem um filete branco por cima (menos a primeira) para separar os produtos dentro da coluna contínua
  const celula = (extra: string, children: ReactNode, key: string, i = 1, fio = 'border-white/70') => <div key={key} className={'flex items-center justify-center ' + (i > 0 ? 'border-t ' + fio + ' ' : '') + extra} style={{ height: ALT }}>{children}</div>
  const num = (p: Produto, campo: 'h' | 'a' | 'd', valor: number, cor: string, tam = 22) => editando && rascunho[p.id]
    ? <input type="number" min={0} inputMode="numeric" aria-label={`${p.nome}: ${campo === 'h' ? 'habilitados' : campo === 'a' ? 'com meta antes' : 'com meta depois'}`} className="w-20 rounded-md border border-slate-400 bg-white px-1 py-1 text-center text-lg font-bold text-slate-900"
        value={rascunho[p.id][campo]} onChange={(e) => setRascunho((r) => ({ ...r, [p.id]: { ...r[p.id], [campo]: e.target.value } }))} />
    : <span className="font-bold" style={{ color: cor, fontSize: tam }}>{valor}</span>
  const pctVivo = (p: Produto, quem: 'a' | 'd') => { const x = editando && rascunho[p.id] ? rascunho[p.id] : null; const h = x ? Number(x.h) : p.habilitados; const n = x ? Number(quem === 'a' ? x.a : x.d) : (quem === 'a' ? p.antes : p.depois); return Number.isFinite(h) && Number.isFinite(n) ? fmtPct(n, h) : '—' }

  const colunas = useMemo(() => '132px 104px 14px 112px 112px 14px 112px 112px 18px 236px 44px', [])
  const cab = (t: string, extra = '', pos: Record<string, string | number> = {}) => <div className={'flex items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-bold leading-tight ' + extra} style={{ background: CINZA, color: AZUL, ...pos }}>{t}</div>

  /** Quadro de produtos. Na apresentação, quando a lista não cabe na altura da tela, ela é dividida em duas colunas lado a lado. */
  const tabela = (ps: Produto[], nota: boolean, chave = 't') => (
    <div key={chave} className="overflow-x-auto rounded-2xl border border-linha bg-[#f3f4f6] p-5">
      <div className="grid min-w-[1030px]" style={{ gridTemplateColumns: colunas, gap: '8px 0', justifyContent: apres ? 'center' : undefined }}>
        {/* cabeçalhos e corpo posicionados na grade: 1 logo · 2 habilitados · 3 vão · 4–5 antes · 6 vão · 7–8 depois · 9 vão · 10 evolução · 11 ações */}
        <div className="flex items-center justify-center rounded-2xl px-2 py-3 text-center text-xs font-bold leading-tight text-white shadow-sm" style={{ background: AZUL, gridColumn: 2, gridRow: '1 / span 2' }}>Indicadores<br />Habilitados</div>
        {cab('Antes', '!rounded-lg !py-1.5', { gridColumn: '4 / span 2', gridRow: 1 })}
        {cab('Depois', '!rounded-lg !py-1.5', { gridColumn: '7 / span 2', gridRow: 1 })}
        {cab('Indicadores com metas', '', { gridColumn: 4, gridRow: 2 })}{cab('% com meta', '', { gridColumn: 5, gridRow: 2 })}
        {cab('Indicadores com metas', '', { gridColumn: 7, gridRow: 2 })}{cab('% com meta', '', { gridColumn: 8, gridRow: 2 })}
        {cab('Evolução (% com meta depois)', '!rounded-lg !py-1.5', { gridColumn: 10, gridRow: '1 / span 2' })}
        {/* corpo: cada coluna é uma peça contínua com cantos arredondados, como no layout de referência */}
        <div className="mt-2 flex flex-col" style={{ gridColumn: 1, gridRow: 3 }}>{ps.map((p, i) => celula('', nomeLogo(p), p.id, 0))}</div>
        <div className="mt-2 flex flex-col overflow-hidden rounded-3xl text-white shadow-sm" style={{ background: AZUL, gridColumn: 2, gridRow: 3 }}>{ps.map((p, i) => celula('', num(p, 'h', p.habilitados, '#fff', 24), p.id, i, 'border-white/15'))}</div>
        <div className="mt-2 flex flex-col overflow-hidden rounded-3xl" style={{ background: CINZA_T, gridColumn: 4, gridRow: 3 }}>{ps.map((p, i) => celula('', num(p, 'a', p.antes, VERDE, 24), p.id, i))}</div>
        <div className="mt-2 flex flex-col overflow-hidden rounded-3xl" style={{ background: CINZA_T, gridColumn: 5, gridRow: 3 }}>{ps.map((p, i) => celula('', <span className="text-xl font-bold" style={{ color: AZUL }}>{pctVivo(p, 'a')}</span>, p.id, i))}</div>
        <div className="mt-2 flex flex-col overflow-hidden rounded-3xl" style={{ background: CINZA_T, gridColumn: 7, gridRow: 3 }}>{ps.map((p, i) => celula('', num(p, 'd', p.depois, VERDE, 24), p.id, i))}</div>
        <div className="mt-2 flex flex-col overflow-hidden rounded-3xl" style={{ background: CINZA_T, gridColumn: 8, gridRow: 3 }}>{ps.map((p, i) => celula('', <span className="text-xl font-bold" style={{ color: AZUL }}>{pctVivo(p, 'd')}</span>, p.id, i))}</div>
        <div className="mt-2 flex flex-col" style={{ gridColumn: 10, gridRow: 3 }}>{ps.map((p, i) => celula('', <MiniEvolucao p={p} h={hist[p.id] || []} onAbrir={() => setEvol(p)} />, p.id, i, 'border-slate-200'))}</div>
        <div className="mt-2 flex flex-col" style={{ gridColumn: 11, gridRow: 3 }}>{ps.map((p, i) => celula('', podeEditar && !editando && !apres ? (
          <details className="relative">
            <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50" aria-label={`Ações de ${p.nome}`}>⋯</summary>
            <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
              <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100" onClick={() => setForm({ id: p.id, nome: p.nome, logo: p.logo, sites: p.sites || [] })}>Editar produto</button>
              <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40" disabled={i === 0} onClick={() => mover(p, -1)}>Subir</button>
              <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40" disabled={i === ps.length - 1} onClick={() => mover(p, 1)}>Descer</button>
              <button className="block w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50" onClick={() => excluir(p)}>Excluir</button>
            </div>
          </details>) : null, p.id, i, 'border-slate-200'))}</div>
      </div>
      {nota && <p className="mt-3 text-xs text-slate-500">Última atualização: {fmtDateTime(lista.reduce((m, p) => (p.atualizado_em > m ? p.atualizado_em : m), ''))}. Percentual = indicadores com meta ÷ indicadores habilitados.</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-xl font-semibold text-ink">Validação de metas</h1>
          <p className={'text-sm text-slate-500' + (apres ? ' hidden' : '')}>Por produto: quantos indicadores estão habilitados e quantos têm meta, antes e depois da validação. {podeEditar ? 'Atualize importando uma base ou editando os números; cada mudança fica no histórico.' : 'Somente consulta.'}</p>
        </div>
        <button className={apres ? btnP : btnG} onClick={alternarApresentacao}>{apres ? 'Sair da apresentação' : 'Apresentar em tela cheia'}</button>
        {podeEditar && !editando && !apres && (<>
          <button className={btnP} onClick={() => setForm({ nome: '', logo: null, sites: [] })}>+ Novo produto</button>
          <button className={btnG} onClick={iniciarEdicao} disabled={!lista.length}>Editar números</button>
        </>)}
        {podeEditar && editando && (<>
          <button className={btnP} onClick={salvarNumeros}>Salvar alterações</button>
          <button className={btnG} onClick={() => { setEditando(false); setErr('') }}>Cancelar</button>
        </>)}
      </div>
      {!apres && err && <Msg kind="erro">{err}</Msg>}{!apres && ok && <Msg kind="ok">{ok}</Msg>}

      {podeEditar && !editando && !apres && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <b className="text-ink">Atualizar por base</b>
            <label className={btnG + ' cursor-pointer'}>Escolher arquivo CSV<input type="file" hidden accept=".csv,text/csv" aria-label="CSV de metas" key={imp ? imp.nome : 'x'} onChange={(e) => escolherCsv(e.target.files?.[0])} /></label>
            <button className={btnG + ' ' + btnSm} onClick={() => download('modelo-validacao-metas.csv', modeloMetasCsv())}>Baixar modelo CSV</button>
            <span className="basis-full text-xs text-slate-500">Colunas: Produto, Habilitados, Antes (opcional) e Depois. Produto que já existe é atualizado pelo nome; o que não existe é criado.</span>
          </div>
          {imp && (
            <div className="mt-3 space-y-2 text-sm">
              {imp.r.erroGeral && <Msg kind="erro">{imp.r.erroGeral}</Msg>}
              {imp.r.erros.length > 0 && <Msg kind="aviso"><b>{imp.r.erros.length} linha(s) ignorada(s):</b> {imp.r.erros.slice(0, 5).map((e) => `linha ${e.linha} — ${e.msg}`).join(' · ')}{imp.r.erros.length > 5 ? ' …' : ''}</Msg>}
              {imp.r.itens.length > 0 && (
                <div className="rounded-md bg-violet-50 p-3">
                  <b>{imp.nome}</b>: {imp.r.itens.length} produto(s) prontos — {imp.r.itens.filter((i) => lista.some((p) => p.nome.trim().toLowerCase() === i.nome.toLowerCase())).length} já existem (serão atualizados) e {imp.r.itens.filter((i) => !lista.some((p) => p.nome.trim().toLowerCase() === i.nome.toLowerCase())).length} serão criados.
                  <div className="mt-2"><button className={btnP} onClick={importar}>Importar {imp.r.itens.length} produto(s)</button></div>
                </div>)}
            </div>)}
        </Card>)}

      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : lista.length === 0 ? (
        <Card><Empty>{podeEditar ? 'Nenhum produto cadastrado. Use “Novo produto” (com o logotipo) ou importe uma base.' : 'Nenhum produto cadastrado ainda.'}</Empty></Card>
      ) : (
        <div style={apres ? ({ zoom: escala } as CSSProperties) : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por site">
          <span className="mr-1 text-sm font-semibold text-ink">Site</span>
          {(['', ...SITES, ...(lista.some((p) => !(p.sites || []).length) && lista.some((p) => (p.sites || []).length) ? ['SEM'] : [])] as ('' | Site | 'SEM')[]).map((f) => (
            <button key={f || 'todos'} type="button" aria-pressed={filtroSite === f} onClick={() => setFiltroSite(f)}
              className={'rounded-full border px-3 py-1 text-sm ' + (filtroSite === f ? 'border-[#0b2461] bg-[#0b2461] font-semibold text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {f === '' ? 'Todos' : f === 'SEM' ? 'Sem site' : f} <span className={filtroSite === f ? 'text-white/70' : 'text-slate-400'}>{contar(f)}</span>
            </button>))}
        </div>
        {visiveis.length === 0 ? <Card><Empty>Nenhum produto neste site. {podeEditar ? 'Defina o site em “Editar produto” (menu ⋯ da linha).' : ''}</Empty></Card> : (
        apres && duas ? (
          <div className="flex items-start justify-center gap-4">
            {tabela(visiveis.slice(0, Math.ceil(visiveis.length / 2)), false, 'e')}
            {tabela(visiveis.slice(Math.ceil(visiveis.length / 2)), true, 'd')}
          </div>
        ) : tabela(visiveis, true)
        )}
        </div>
      )}

      {form && (
        <Modal title={form.id ? 'Editar produto' : 'Novo produto'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="Nome do produto / cliente"><input className={inp} maxLength={80} autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvarProduto() } }} /></Field>
            <Field label="Sites (marque todos em que o produto existe)">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Sites do produto">
                {SITES.map((s) => { const on = form.sites.includes(s); return (
                  <label key={s} className={'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ' + (on ? 'border-[#0b2461] bg-[#0b2461] font-semibold text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setForm({ ...form, sites: on ? form.sites.filter((x) => x !== s) : SITES.filter((x) => x === s || form.sites.includes(x)) })} />{s}
                  </label>) })}
              </div>
            </Field>
            <Field label="Logotipo (PNG, JPG ou SVG)">
              <div className="flex items-center gap-3">
                <div className="grid h-20 w-40 place-items-center rounded-md border border-slate-300 bg-white">{form.logo ? <img src={form.logo} alt="Prévia do logotipo" style={{ maxHeight: 72, maxWidth: 150, objectFit: 'contain' }} /> : <span className="text-xs text-slate-400">sem logotipo</span>}</div>
                <div className="space-y-1">
                  <input type="file" accept="image/*" aria-label="Arquivo do logotipo" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setForm((x) => (x ? { ...x, logo: null } : x)); const l = await reduzirLogo(f); setForm((x) => (x ? { ...x, logo: l } : x)); setErr('') } catch (x: any) { setErr(x.message || 'Não foi possível usar a imagem.') } }} />
                  {form.logo && <button className={btnG + ' ' + btnSm} onClick={() => setForm({ ...form, logo: null })}>Remover logotipo</button>}
                </div>
              </div>
            </Field>
            {err && <Msg kind="erro">{err}</Msg>}
            <div className="flex justify-end gap-2"><button className={btnG} onClick={() => setForm(null)}>Cancelar</button><button className={btnP} onClick={salvarProduto}>Salvar</button></div>
          </div>
        </Modal>)}
      {evol && <Evolucao produto={evol} onClose={() => setEvol(null)} />}
    </div>
  )
}

/** Evolução ao lado da linha: mini gráfico do % com meta (depois), "de X% para Y%" e a variação em pontos percentuais. */
function MiniEvolucao({ p, h, onAbrir }: { p: Produto; h: Snapshot[]; onAbrir: () => void }) {
  const s = serieEvolucao(h)
  const ini = s.length ? s[0].depois : pct(p.depois, p.habilitados), fim = pct(p.depois, p.habilitados)
  const delta = Math.round((fim - ini) * 10) / 10
  const W = 96, H = 34, pad = 4
  const xs = (i: number) => (s.length <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (s.length - 1)), ys = (v: number) => pad + (1 - v / 100) * (H - 2 * pad)
  const cor = delta > 0 ? VERDE : delta < 0 ? '#c0392b' : '#64748b'
  const fmt = (n: number) => String(n).replace('.', ',')
  return (
    <button type="button" onClick={onAbrir} title="Ver o histórico completo" aria-label={`Evolução de ${p.nome}: de ${fmt(ini)}% para ${fmt(fim)}%`}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-white/70">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="flex-none">
        <line x1={pad} x2={W - pad} y1={ys(100)} y2={ys(100)} stroke="#cbd5e1" strokeDasharray="2 3" />
        {s.length > 1 && <path d={s.map((q, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(q.depois).toFixed(1)}`).join(' ')} fill="none" stroke={AZUL} strokeWidth="2" strokeLinejoin="round" />}
        {s.map((q, i) => <circle key={i} cx={xs(i)} cy={ys(q.depois)} r={i === s.length - 1 ? 3.5 : 2} fill={i === s.length - 1 ? cor : AZUL} />)}
      </svg>
      <span className="min-w-0 whitespace-nowrap leading-tight">
        <span className="block text-sm font-bold" style={{ color: cor }}>{delta > 0 ? '+' : ''}{fmt(delta)} p.p.</span>
        <span className="block text-[11px] text-slate-500">de {fmt(ini)}% para {fmt(fim)}%</span>
        <span className="block text-[11px] text-slate-400">{s.length} registro(s)</span>
      </span>
    </button>
  )
}

/** Histórico do produto: gráfico de % com meta (antes tracejado, depois cheio) e a lista de instantâneos. */
function Evolucao({ produto, onClose }: { produto: Produto; onClose: () => void }) {
  const [hist, setHist] = useState<Snapshot[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { (async () => {
    const r = await supabase.from('metas_historico').select('*').eq('produto_id', produto.id).order('registrado_em')
    if (r.error) setErr(r.error.message); else setHist((r.data || []) as Snapshot[])
  })() }, [produto.id])
  const s = hist ? serieEvolucao(hist) : []
  const W = 560, H = 200, L = 40, R = 34, T = 28, B = 26
  const x = (i: number) => (s.length <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (s.length - 1))
  const y = (v: number) => T + (1 - v / 100) * (H - T - B)
  const linha = (k: 'antes' | 'depois') => s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
  const origem = { cadastro: 'Cadastro', manual: 'Edição manual', importacao: 'Importação' } as const
  return (
    <Modal title={`Evolução · ${produto.nome}`} onClose={onClose} wide>
      {err && <Msg kind="erro">{err}</Msg>}
      {!hist ? <p className="py-6 text-center text-slate-500">Carregando…</p> : hist.length === 0 ? <Empty>Sem histórico.</Empty> : (
        <div className="space-y-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Evolução do percentual com meta de ${produto.nome}`}>
            {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2e4ea" /><text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{v}%</text></g>)}
            <path d={linha('antes')} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
            <path d={linha('depois')} fill="none" stroke={AZUL} strokeWidth="2.5" />
            {s.map((p, i) => <g key={i}><circle cx={x(i)} cy={y(p.depois)} r="4" fill={AZUL} /><text x={x(i)} y={y(p.depois) - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill={AZUL}>{String(p.depois).replace('.', ',')}%</text><text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">{fmtDate(p.em).slice(0, 5)}</text></g>)}
          </svg>
          <p className="flex gap-4 text-xs text-slate-500"><span><b style={{ color: AZUL }}>━</b> % com meta depois</span><span><b className="text-slate-400">┅</b> % com meta antes</span></p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">Quando</th><th className="font-medium">Habilitados</th><th className="font-medium">Antes</th><th className="font-medium">Depois</th><th className="font-medium">% depois</th><th className="font-medium">Origem</th></tr></thead>
            <tbody>{[...hist].reverse().map((h) => (
              <tr key={h.id} className="border-t border-linha"><td className="py-1">{fmtDateTime(h.registrado_em)}</td><td>{h.habilitados}</td><td>{h.antes}</td><td>{h.depois}</td><td>{fmtPct(h.depois, h.habilitados)}</td><td>{origem[h.origem]}</td></tr>))}</tbody>
          </table>
        </div>)}
    </Modal>
  )
}
