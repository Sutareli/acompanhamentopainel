import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, fmtDateTime } from '../lib/rules'
import { Msg } from '../components/ui'
import type { Modelo, Pasta } from '../csat/motor/pasta'
import type { Esc } from '../csat/motor/valores'
import type { ModeloUI } from '../csat/ui/Folha'
import Folha from '../csat/ui/Folha'
import { carregarDados, Dados, gravarAjuste, gravarRevisao, montarPasta, podeEditar } from '../csat/dados'

/** C-SAT Rocco — a planilha Rocco_CSAT_Dashboard dentro do painel: mesmas abas, mesmo layout e as mesmas fórmulas (executadas aqui).
 *  Os filtros valem só para quem está olhando; a base é atualizada em Importar bases. */
const ABAS = ['Dashboard', 'Análise Detalhada', 'Evolução', 'Comentários', 'Base de Dados', 'Hierarquia', 'Regras', 'Dicionário']
const ROTULO: Record<string, string> = { Dashboard: 'Painel', 'Análise Detalhada': 'Análise detalhada', 'Base de Dados': 'Base de dados' }
const COL_CAT_MANUAL = 45, COL_OBS = 49, LINHA0 = 5

export default function CsatRocco({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const admin = canAdmin(profile?.perfil)
  const [modelo, setModelo] = useState<(Modelo & ModeloUI) | null>(null)
  const [dados, setDados] = useState<Dados | null>(null)
  const pasta = useRef<Pasta | null>(null)
  const [pronto, setPronto] = useState(false)
  const [calc, setCalc] = useState('Carregando a planilha…')
  const [err, setErr] = useState(''); const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState('Dashboard')
  const [zoom, setZoom] = useState<'ajustar' | number>('ajustar')
  const [versao, setVersao] = useState(0)
  const [apres, setApres] = useState(false)
  const [barra, setBarra] = useState(true)
  const palco = useRef<HTMLDivElement>(null)
  const timer = useRef<number>()

  const carregar = useCallback(async () => {
    setPronto(false); setErr(''); setCalc('Carregando a planilha…')
    try {
      const [m, d] = await Promise.all([import('../csat/modelo.json').then((x) => x.default as unknown as Modelo & ModeloUI), carregarDados()])
      setModelo(m); setDados(d); setCalc('Calculando as fórmulas…')
      await new Promise((r) => setTimeout(r, 30))
      pasta.current = montarPasta(m, d)
      setPronto(true); setCalc(''); setVersao((v) => v + 1)
    } catch (e) {
      const msg = (e as Error).message
      setErr(/csat_(base|quadros|ajustes)/.test(msg) ? 'O módulo ainda não foi instalado no banco: execute a migração supabase/041_csat_rocco_planilha.sql no SQL Editor do Supabase.' : msg)
    }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const recalcular = (f: () => void, msg = 'Recalculando…') => { setCalc(msg); setTimeout(() => { f(); setVersao((v) => v + 1); setCalc('') }, 20) }
  const linhaBase = (r: number) => dados?.base[r - LINHA0]

  function onEntrada(sheet: string, r: number, c: number, v: Esc) {
    const P = pasta.current; if (!P) return
    if (sheet === 'Base de Dados' && c === COL_CAT_MANUAL) {
      const b = linhaBase(r); if (!b || !admin) return
      gravarRevisao(b.id, 'cat_manual', v === null ? null : String(v)).catch((e) => setAviso('Não gravou a revisão: ' + e.message))
      b.cat_manual = v === null ? null : String(v)
      return recalcular(() => P.definir(sheet, r, c, v))
    }
    recalcular(() => P.definir(sheet, r, c, v))
  }
  function onEditar(r: number, c: number, texto: string) {
    const P = pasta.current; if (!P || !admin) return
    const t = texto.trim()
    const v: Esc = t === '' ? null : /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : texto
    if (aba === 'Base de Dados' && c === COL_OBS) {
      const b = linhaBase(r); if (!b) return
      gravarRevisao(b.id, 'obs_revisao', texto || null).catch((e) => setAviso('Não gravou: ' + e.message)); b.obs_revisao = texto || null
    } else gravarAjuste(aba, r, c, v, profile?.id).catch((e) => setAviso('Não gravou o ajuste: ' + e.message))
    recalcular(() => P.definir(aba, r, c, v))
  }
  const editavel = (r: number, c: number) => admin && (podeEditar(aba, r, c) || (aba === 'Base de Dados' && c === COL_OBS && r >= LINHA0 && r < LINHA0 + (dados?.base.length ?? 0)))

  // ---------- modo apresentação ----------
  const idx = ABAS.indexOf(aba)
  const irPara = (d: number) => setAba(ABAS[(idx + d + ABAS.length) % ABAS.length])
  async function apresentar() { setApres(true); setTimeout(() => { palco.current?.requestFullscreen?.().catch(() => { /* sem tela cheia: segue em sobreposição */ }) }, 30) }
  function sair() { setApres(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  useEffect(() => {
    if (!apres) return
    const fs = () => { if (!document.fullscreenElement) setApres(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'PageDown') irPara(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') irPara(-1); else if (e.key === 'Escape') sair() }
    const mexeu = () => { setBarra(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setBarra(false), 2500) }
    document.addEventListener('fullscreenchange', fs); window.addEventListener('keydown', tecla); window.addEventListener('mousemove', mexeu); mexeu()
    return () => { document.removeEventListener('fullscreenchange', fs); window.removeEventListener('keydown', tecla); window.removeEventListener('mousemove', mexeu); window.clearTimeout(timer.current) }
  })   // eslint-disable-line react-hooks/exhaustive-deps

  const folha = (emApresentacao: boolean) => modelo && pasta.current && (
    <Folha key={aba + (emApresentacao ? '-a' : '')} modelo={modelo} nome={aba} pasta={pasta.current} versao={versao}
      zoom={emApresentacao ? 'ajustar' : zoom === 'ajustar' ? (aba === 'Dashboard' ? 'ajustar' : 1) : zoom} larguraAjuste={aba === 'Dashboard' ? 2240 : undefined}
      onNav={(a) => setAba(a)} onEntrada={onEntrada} editavel={emApresentacao ? undefined : editavel} onEditar={onEditar}
      imagem={(n) => `/csat/${n}`}
      linhasDados={aba === 'Base de Dados' ? dados?.base.length ?? 0 : undefined} congelar={aba === 'Base de Dados' ? [4, 5] : undefined} />
  )
  const ZOOMS = [0.5, 0.75, 0.85, 1, 1.15, 1.25, 1.5]
  const zAtual = zoom === 'ajustar' ? null : zoom
  const passoZoom = (d: number) => { const base = zAtual ?? 1; const i = ZOOMS.findIndex((z) => z >= base - 1e-9); setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + d))]) }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition'
  const btnClaro = btn + ' border border-violet-200 bg-white text-[#3A1C71] shadow-sm hover:border-violet-300 hover:bg-violet-50'
  const btnForte = btn + ' bg-[#6A2FC9] text-white shadow-sm shadow-violet-300/50 hover:bg-[#5B25B2]'

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">C-SAT Rocco</h1>
          <p className="text-xs text-slate-500">Pesquisa de satisfação da ferramenta Rocco{dados?.carga ? ` · base atualizada em ${fmtDateTime(dados.carga.em)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center overflow-hidden rounded-lg border border-violet-200 bg-white text-xs font-semibold text-[#3A1C71] shadow-sm" role="group" aria-label="Zoom">
            <button className="px-2.5 py-1.5 hover:bg-violet-50" onClick={() => passoZoom(-1)} aria-label="Diminuir zoom">−</button>
            <button className={'border-x border-violet-100 px-2.5 py-1.5 hover:bg-violet-50 ' + (zoom === 'ajustar' ? 'bg-violet-50' : '')} onClick={() => setZoom('ajustar')} title="Tamanho padrão de cada aba">{zAtual ? Math.round(zAtual * 100) + '%' : 'Ajustar'}</button>
            <button className="px-2.5 py-1.5 hover:bg-violet-50" onClick={() => passoZoom(1)} aria-label="Aumentar zoom">+</button>
          </div>
          <button className={btnClaro} onClick={carregar} title="Busca a base de novo">↻ Recarregar</button>
          {admin && <button className={btnClaro} onClick={() => onNavigate('importar')}>⇪ Atualizar base</button>}
          <button className={btnForte} disabled={!pronto} onClick={apresentar}>▶ Apresentar</button>
        </div>
      </div>
      {pronto && (
        <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-violet-50/70 p-1" role="tablist">
          {ABAS.map((a) => (
            <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)} className={'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ' + (aba === a ? 'bg-white text-[#3A1C71] shadow-sm ring-1 ring-violet-200' : 'text-slate-500 hover:bg-white/70 hover:text-[#3A1C71]')}>{ROTULO[a] ?? a}</button>
          ))}
        </div>
      )}
      {err && <Msg kind="erro">{err}</Msg>}
      {aviso && <Msg kind="aviso">{aviso}</Msg>}
      {!err && !pronto && <div className="flex flex-1 items-center justify-center gap-3 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-300 border-t-[#6A2FC9]" />{calc}</div>}
      {!err && pronto && dados && !dados.base.length && <Msg kind="aviso">A base ainda está vazia. {admin ? 'Em Importar bases → C-SAT Rocco, carregue a planilha Rocco_CSAT_Dashboard.xlsx (primeira carga) ou uma exportação do Rocco.' : 'O Analista Sr carrega a base em Importar bases.'}</Msg>}
      {!err && pronto && !apres && (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm">
          {folha(false)}
          {calc && <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow">{calc}</div>}
        </div>
      )}
      {apres && (
        <div ref={palco} className="fixed inset-0 z-[100] bg-[#FBFAFE]" style={{ cursor: barra ? 'default' : 'none' }}>
          {folha(true)}
          {calc && <div className="pointer-events-none absolute right-4 top-4 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow">{calc}</div>}
          <div className={'absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-[#2B1260]/90 p-1.5 text-white shadow-xl backdrop-blur transition-opacity duration-300 ' + (barra ? 'opacity-100' : 'pointer-events-none opacity-0')}>
            <button className="rounded-xl px-3 py-2 text-sm hover:bg-white/15" onClick={() => irPara(-1)} aria-label="Aba anterior">◀</button>
            <span className="min-w-[150px] px-2 text-center text-sm font-semibold">{ROTULO[aba] ?? aba}<span className="ml-2 text-xs font-normal text-white/60">{idx + 1}/{ABAS.length}</span></span>
            <button className="rounded-xl px-3 py-2 text-sm hover:bg-white/15" onClick={() => irPara(1)} aria-label="Próxima aba">▶</button>
            <span className="mx-1 h-6 w-px bg-white/20" />
            <button className="rounded-xl px-3 py-2 text-xs font-semibold hover:bg-white/15" onClick={sair}>Sair (Esc)</button>
          </div>
        </div>
      )}
    </div>
  )
}
