import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Msg } from '../components/ui'
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

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-ink">C-SAT Rocco</h1>
          {dados?.carga && <span className="text-xs text-slate-500">base atualizada em {fmtDateTime(dados.carga.em)}{dados.carga.arquivo ? ` (${dados.carga.arquivo})` : ''}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-slate-600">Zoom
            <select className="rounded border border-slate-300 px-1 py-1" value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'ajustar' ? 'ajustar' : +e.target.value)}>
              <option value="ajustar">Padrão</option>{[0.5, 0.75, 0.85, 1, 1.15, 1.25, 1.5].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </label>
          <button className={btnG + ' ' + btnSm} onClick={carregar}>Recarregar</button>
          {admin && <button className={btnP + ' ' + btnSm} onClick={() => onNavigate('importar')}>Atualizar base →</button>}
        </div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {aviso && <Msg kind="aviso">{aviso}</Msg>}
      {!err && !pronto && <div className="flex flex-1 items-center justify-center text-slate-500">{calc}</div>}
      {!err && pronto && dados && !dados.base.length && <Msg kind="aviso">A base ainda está vazia. {admin ? 'Em Importar bases → C-SAT Rocco, carregue a planilha Rocco_CSAT_Dashboard.xlsx (primeira carga) ou uma exportação do Rocco.' : 'O Analista Sr carrega a base em Importar bases.'}</Msg>}
      {!err && pronto && modelo && pasta.current && (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-t-md border border-slate-200 bg-white">
          <Folha key={aba} modelo={modelo} nome={aba} pasta={pasta.current} versao={versao}
            zoom={zoom === 'ajustar' ? (aba === 'Dashboard' ? 'ajustar' : 1) : zoom} larguraAjuste={aba === 'Dashboard' ? 2240 : undefined}
            onNav={(a) => setAba(a)} onEntrada={onEntrada} editavel={editavel} onEditar={onEditar}
            imagem={(n) => `/csat/${n}`}
            linhasDados={aba === 'Base de Dados' ? dados?.base.length ?? 0 : undefined} congelar={aba === 'Base de Dados' ? [4, 5] : undefined} />
          {calc && <div className="pointer-events-none absolute right-3 top-3 rounded bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">{calc}</div>}
        </div>
      )}
      {/* abas da pasta de trabalho, como no rodapé do Excel */}
      {pronto && (
        <div className="flex gap-0.5 overflow-x-auto rounded-b-md border border-t-0 border-slate-200 bg-slate-50 text-xs">
          {ABAS.map((a) => (
            <button key={a} onClick={() => setAba(a)} className={'whitespace-nowrap px-3 py-1.5 ' + (aba === a ? 'border-b-2 border-[#217346] bg-white font-semibold text-[#217346]' : 'text-slate-600 hover:bg-white')}>{ROTULO[a] ?? a}</button>
          ))}
        </div>
      )}
    </div>
  )
}
