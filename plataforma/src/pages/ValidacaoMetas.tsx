import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { download, fmtDate, fmtDateTime } from '../lib/rules'
import { fmtPct, lerMetas, LeituraMetas, modeloMetasCsv, pct, Produto, serieEvolucao, Snapshot, validarNumeros } from '../lib/metas'
import { btnG, btnP, btnSm, Card, Empty, Field, inp, Modal, Msg } from '../components/ui'
import { confirmar } from '../components/Confirm'

// Cores do layout de referência
const AZUL = '#0b2461', VERDE = '#1fa65a', CINZA = '#dcdcdc', CINZA_T = '#d3d3d3'
const ALT = 84   // altura de cada linha de produto

async function lerArquivo(f: File): Promise<string> {
  const buf = await f.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}

/** Reduz a imagem escolhida (máx. 320×160) e devolve como data URL. SVG é mantido como veio. */
async function reduzirLogo(f: File): Promise<string> {
  if (!f.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (PNG, JPG ou SVG).')
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Não foi possível ler a imagem.')); r.readAsDataURL(f) })
  if (f.type === 'image/svg+xml') { if (url.length > 250000) throw new Error('SVG muito pesado (máximo ~180 KB). Use PNG.'); return url }
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = url })
  const k = Math.min(1, 320 / img.width, 160 / img.height)
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const out = c.toDataURL('image/png')
  if (out.length > 280000) throw new Error('Imagem muito complexa. Use um logotipo mais simples ou menor.')
  return out
}

export default function ValidacaoMetas({ podeEditar }: { podeEditar: boolean }) {
  const [lista, setLista] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [editando, setEditando] = useState(false)                     // modo "editar números"
  const [rascunho, setRascunho] = useState<Record<string, { h: string; a: string; d: string }>>({})
  const [form, setForm] = useState<{ id?: string; nome: string; logo: string | null } | null>(null)   // cadastro/edição de produto
  const [evol, setEvol] = useState<Produto | null>(null)
  const [imp, setImp] = useState<{ nome: string; r: LeituraMetas } | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.from('metas_produtos').select('*').order('ordem').order('nome')
    if (r.error) { setErr('Não foi possível carregar: ' + r.error.message + ' (a migração 032 foi executada?)'); setLoading(false); return }
    setLista((r.data || []) as Produto[]); setErr(''); setLoading(false)
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
      ? await supabase.from('metas_produtos').update({ nome, logo: form.logo }).eq('id', form.id)
      : await supabase.from('metas_produtos').insert({ nome, logo: form.logo, ordem: (lista.reduce((m, p) => Math.max(m, p.ordem), 0) || 0) + 1 })
    if (r.error) { setErr(r.error.code === '23505' ? 'Já existe um produto com esse nome.' : 'Não foi possível salvar: ' + r.error.message); return }
    setForm(null); setErr(''); setOk(form.id ? 'Produto atualizado.' : 'Produto cadastrado. Preencha os números em “Editar números” ou importe a base.'); load()
  }
  async function excluir(p: Produto) {
    if (!(await confirmar({ titulo: 'Excluir este produto?', mensagem: `“${p.nome}” sai do quadro e o histórico de evolução dele também é apagado. Não dá para desfazer.`, confirmar: 'Excluir', perigo: true }))) return
    const r = await supabase.from('metas_produtos').delete().eq('id', p.id)
    if (r.error) setErr('Não foi possível excluir: ' + r.error.message); else load()
  }
  async function mover(p: Produto, delta: -1 | 1) {
    const i = lista.findIndex((x) => x.id === p.id), o = lista[i + delta]; if (!o) return
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

  const nomeLogo = (p: Produto) => (p.logo ? <img src={p.logo} alt={p.nome} title={p.nome} style={{ maxHeight: 60, maxWidth: 140, objectFit: 'contain' }} /> : <span className="px-2 text-center text-sm font-semibold text-slate-600">{p.nome}</span>)
  const celula = (extra: string, children: ReactNode, key: string) => <div key={key} className={'flex items-center justify-center ' + extra} style={{ height: ALT }}>{children}</div>
  const num = (p: Produto, campo: 'h' | 'a' | 'd', valor: number, cor: string, tam = 22) => editando && rascunho[p.id]
    ? <input type="number" min={0} inputMode="numeric" aria-label={`${p.nome}: ${campo === 'h' ? 'habilitados' : campo === 'a' ? 'com meta antes' : 'com meta depois'}`} className="w-20 rounded-md border border-slate-400 bg-white px-1 py-1 text-center text-lg font-bold text-slate-900"
        value={rascunho[p.id][campo]} onChange={(e) => setRascunho((r) => ({ ...r, [p.id]: { ...r[p.id], [campo]: e.target.value } }))} />
    : <span className="font-bold" style={{ color: cor, fontSize: tam }}>{valor}</span>
  const pctVivo = (p: Produto, quem: 'a' | 'd') => { const x = editando && rascunho[p.id] ? rascunho[p.id] : null; const h = x ? Number(x.h) : p.habilitados; const n = x ? Number(quem === 'a' ? x.a : x.d) : (quem === 'a' ? p.antes : p.depois); return Number.isFinite(h) && Number.isFinite(n) ? fmtPct(n, h) : '—' }

  const colunas = useMemo(() => '150px 112px 28px 140px 140px 28px 140px 140px 120px', [])
  const cab = (t: string, extra = '', pos: Record<string, string | number> = {}) => <div className={'flex items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-bold leading-tight ' + extra} style={{ background: CINZA, color: AZUL, ...pos }}>{t}</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-xl font-semibold text-ink">Validação de metas</h1>
          <p className="text-sm text-slate-500">Por produto: quantos indicadores estão habilitados e quantos têm meta, antes e depois da validação. {podeEditar ? 'Atualize importando uma base ou editando os números; cada mudança fica no histórico.' : 'Somente consulta.'}</p>
        </div>
        {podeEditar && !editando && (<>
          <button className={btnP} onClick={() => setForm({ nome: '', logo: null })}>+ Novo produto</button>
          <button className={btnG} onClick={iniciarEdicao} disabled={!lista.length}>Editar números</button>
        </>)}
        {podeEditar && editando && (<>
          <button className={btnP} onClick={salvarNumeros}>Salvar alterações</button>
          <button className={btnG} onClick={() => { setEditando(false); setErr('') }}>Cancelar</button>
        </>)}
      </div>
      {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}

      {podeEditar && !editando && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <b className="text-ink">Atualizar por base</b>
            <input type="file" accept=".csv,text/csv" aria-label="CSV de metas" key={imp ? imp.nome : 'x'} onChange={(e) => escolherCsv(e.target.files?.[0])} />
            <button className={btnG + ' ' + btnSm} onClick={() => download('modelo-validacao-metas.csv', modeloMetasCsv())}>Baixar modelo CSV</button>
            <span className="text-xs text-slate-500">Colunas: Produto, Habilitados, Antes (opcional), Depois. Produto que já existe é atualizado pelo nome; o que não existe é criado.</span>
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
        <div className="overflow-x-auto rounded-lg border border-linha bg-[#f1f1f1] p-4">
          <div className="grid min-w-[1060px]" style={{ gridTemplateColumns: colunas, gap: '8px 0' }}>
            {/* cabeçalhos e corpo posicionados na grade: 1 logo · 2 habilitados · 3 vão · 4–5 antes · 6 vão · 7–8 depois · 9 ações */}
            <div className="flex items-center justify-center rounded-xl px-2 py-3 text-center text-xs font-bold leading-tight text-white" style={{ background: AZUL, gridColumn: 2, gridRow: '1 / span 2' }}>Indicadores<br />Habilitados</div>
            {cab('Antes', '!rounded-md !py-1.5', { gridColumn: '4 / span 2', gridRow: 1 })}
            {cab('Depois', '!rounded-md !py-1.5', { gridColumn: '7 / span 2', gridRow: 1 })}
            {cab('Indicadores com metas', '', { gridColumn: 4, gridRow: 2 })}{cab('% com meta', '', { gridColumn: 5, gridRow: 2 })}
            {cab('Indicadores com metas', '', { gridColumn: 7, gridRow: 2 })}{cab('% com meta', '', { gridColumn: 8, gridRow: 2 })}
            {/* corpo: cada coluna é uma peça contínua com cantos arredondados, como no layout de referência */}
            <div className="mt-2 flex flex-col" style={{ gridColumn: 1, gridRow: 3 }}>{lista.map((p) => celula('', nomeLogo(p), p.id))}</div>
            <div className="mt-2 flex flex-col rounded-3xl text-white" style={{ background: AZUL, gridColumn: 2, gridRow: 3 }}>{lista.map((p) => celula('', num(p, 'h', p.habilitados, '#fff', 22), p.id))}</div>
            <div className="mt-2 flex flex-col rounded-3xl" style={{ background: CINZA_T, gridColumn: 4, gridRow: 3 }}>{lista.map((p) => celula('', num(p, 'a', p.antes, VERDE, 22), p.id))}</div>
            <div className="mt-2 flex flex-col rounded-3xl" style={{ background: CINZA_T, gridColumn: 5, gridRow: 3 }}>{lista.map((p) => celula('', <span className="text-xl font-bold" style={{ color: AZUL }}>{pctVivo(p, 'a')}</span>, p.id))}</div>
            <div className="mt-2 flex flex-col rounded-3xl" style={{ background: CINZA_T, gridColumn: 7, gridRow: 3 }}>{lista.map((p) => celula('', num(p, 'd', p.depois, VERDE, 22), p.id))}</div>
            <div className="mt-2 flex flex-col rounded-3xl" style={{ background: CINZA_T, gridColumn: 8, gridRow: 3 }}>{lista.map((p) => celula('', <span className="text-xl font-bold" style={{ color: AZUL }}>{pctVivo(p, 'd')}</span>, p.id))}</div>
            <div className="mt-2 flex flex-col pl-3" style={{ gridColumn: 9, gridRow: 3 }}>{lista.map((p, i) => celula('flex-col gap-1', (
              <>
                <button className={btnG + ' ' + btnSm} onClick={() => setEvol(p)}>Evolução</button>
                {podeEditar && !editando && <span className="flex gap-1">
                  <button className={btnG + ' ' + btnSm} onClick={() => setForm({ id: p.id, nome: p.nome, logo: p.logo })}>Editar</button>
                  <button className={btnG + ' ' + btnSm} onClick={() => mover(p, -1)} disabled={i === 0} aria-label={`Subir ${p.nome}`}>↑</button>
                  <button className={btnG + ' ' + btnSm} onClick={() => mover(p, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${p.nome}`}>↓</button>
                  <button className={btnG + ' ' + btnSm + ' !text-red-600'} onClick={() => excluir(p)} aria-label={`Excluir ${p.nome}`}>✕</button>
                </span>}
              </>), p.id))}</div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Última atualização: {fmtDateTime(lista.reduce((m, p) => (p.atualizado_em > m ? p.atualizado_em : m), ''))}. Percentual = indicadores com meta ÷ indicadores habilitados.</p>
        </div>
      )}

      {form && (
        <Modal title={form.id ? 'Editar produto' : 'Novo produto'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="Nome do produto / cliente"><input className={inp} maxLength={80} autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvarProduto() } }} /></Field>
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
