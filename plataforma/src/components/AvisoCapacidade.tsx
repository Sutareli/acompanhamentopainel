import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { capacidadeStatus, CapStatus, fmtMB } from '../lib/capacidade'
import { btnG, btnP, btnSm, Bar, Card, Field, inp, Msg } from './ui'
import ArquivarAtas from './ArquivarAtas'

const EVT = 'capacidade-atualizada'
const avisar = () => window.dispatchEvent(new Event(EVT))

function Medidor({ rotulo, usado, limite, pct, alerta }: { rotulo: string; usado: number; limite: number; pct: number; alerta: number }) {
  const cor = pct >= alerta ? '#dc2626' : pct >= alerta - 15 ? '#d97706' : '#16a34a'
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-navy">{rotulo}</span><span className="font-bold" style={{ color: cor }}>{pct.toLocaleString('pt-BR')}%</span></div>
      <Bar pct={Math.min(100, pct)} color={cor} />
      <div className="mt-0.5 text-xs text-slate-500">{fmtMB(usado)} de {fmtMB(limite)}</div>
    </div>
  )
}

/** Faixa de aviso no topo — SOMENTE para o Analista Sr (o App só a renderiza para ele; as funções do banco também recusam os demais). */
export function AvisoCapacidade() {
  const [st, setSt] = useState<CapStatus | null>(null)
  const [aberto, setAberto] = useState(false)
  const [oculto, setOculto] = useState(false)
  const carregar = useCallback(async () => { const r = await capacidadeStatus(); if (r.data) setSt(r.data) }, [])
  useEffect(() => { carregar(); const t = setInterval(carregar, 30 * 60 * 1000); window.addEventListener(EVT, carregar); return () => { clearInterval(t); window.removeEventListener(EVT, carregar) } }, [carregar])
  if (!st || !st.alerta || oculto) return null
  const pior = st.storage_pct >= st.banco_pct ? { n: 'arquivos (Storage)', p: st.storage_pct } : { n: 'banco de dados', p: st.banco_pct }
  return (
    <>
      <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
        <span className="text-xl" aria-hidden>⚠️</span>
        <div className="min-w-[220px] flex-1">
          <b>O espaço do plano chegou a {pior.p.toLocaleString('pt-BR')}% ({pior.n}).</b> O limiar de aviso é {st.alerta_pct}%. Gere o backup único de todas as atas (guarde o arquivo), e depois libere o espaço excluindo apenas as atas.
        </div>
        <button className={btnP + ' ' + btnSm} onClick={() => setAberto(true)}>Gerar backup e arquivar atas</button>
        <button className={btnG + ' ' + btnSm} onClick={() => setOculto(true)}>Lembrar depois</button>
      </div>
      {aberto && <ArquivarAtas onClose={() => setAberto(false)} onDone={carregar} />}
    </>
  )
}

/** Cartão da página Segurança: uso atual, limites do plano (editáveis) e acesso ao arquivamento mesmo antes de o aviso disparar (o banco só libera ao atingir o limiar). */
export function CapacidadeCard() {
  const [st, setSt] = useState<CapStatus | null>(null)
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ banco: '', storage: '', pct: '' })
  const [aberto, setAberto] = useState(false)
  const carregar = useCallback(async () => {
    const r = await capacidadeStatus()
    if (r.error) setErr('Não foi possível ler a capacidade: ' + r.error + ' (a migração 018 foi executada?)'); else { setErr(''); setSt(r.data!) }
  }, [])
  useEffect(() => { carregar() }, [carregar])
  function editar() {
    if (!st) return
    setF({ banco: String(Math.round(st.banco_limite_bytes / 1048576)), storage: String(Math.round(st.storage_limite_bytes / 1048576)), pct: String(st.alerta_pct) }); setEdit(true); setOk('')
  }
  async function salvar() {
    const b = parseInt(f.banco, 10), s = parseInt(f.storage, 10), p = parseInt(f.pct, 10)
    if (!(b > 0) || !(s > 0) || !(p >= 50 && p <= 100)) return setErr('Informe limites positivos (MB) e um percentual entre 50 e 100.')
    const r = await supabase.from('capacidade_config').update({ banco_limite_mb: b, storage_limite_mb: s, alerta_pct: p, atualizado_em: new Date().toISOString() }).eq('id', 1)
    if (r.error) return setErr(r.error.message)
    setEdit(false); setErr(''); setOk('Limites atualizados.'); carregar(); avisar()
  }
  if (err && !st) return <Msg kind="erro">{err}</Msg>
  if (!st) return null
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy">📦 Espaço do plano <span className="text-sm font-normal text-slate-500">· aviso aos {st.alerta_pct}%</span></h3>
        <div className="flex gap-2"><button className={btnG + ' ' + btnSm} onClick={editar}>Ajustar limites</button><button className={btnG + ' ' + btnSm} onClick={carregar}>Atualizar</button></div>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
      <div className="grid gap-4 md:grid-cols-2">
        <Medidor rotulo="Banco de dados" usado={st.banco_bytes} limite={st.banco_limite_bytes} pct={st.banco_pct} alerta={st.alerta_pct} />
        <Medidor rotulo="Arquivos (Storage)" usado={st.storage_bytes} limite={st.storage_limite_bytes} pct={st.storage_pct} alerta={st.alerta_pct} />
      </div>
      <p className="mt-3 text-sm text-slate-600">Atas guardadas: <b>{st.atas_qtd}</b> · texto {fmtMB(st.atas_texto_bytes)} · arquivos anexados {fmtMB(st.atas_arquivo_bytes)}.</p>
      {edit && (
        <div className="mt-3 grid gap-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-3 sm:grid-cols-3">
          <Field label="Limite do banco (MB)"><input className={inp} inputMode="numeric" value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} /></Field>
          <Field label="Limite de arquivos (MB)"><input className={inp} inputMode="numeric" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} /></Field>
          <Field label="Avisar a partir de (%)"><input className={inp} inputMode="numeric" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-3">Plano Free: banco 500 MB · arquivos 1024 MB. Plano Pro: banco 8192 MB · arquivos 102400 MB.</p>
          <div className="flex gap-2 sm:col-span-3"><button className={btnP + ' ' + btnSm} onClick={salvar}>Salvar</button><button className={btnG + ' ' + btnSm} onClick={() => setEdit(false)}>Cancelar</button></div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className={st.alerta ? btnP : btnG} disabled={!st.alerta} onClick={() => setAberto(true)}>Gerar backup e arquivar atas</button>
        {!st.alerta && <span className="text-xs text-slate-500">Liberado automaticamente quando o uso chegar a {st.alerta_pct}%.</span>}
      </div>
      {aberto && <ArquivarAtas onClose={() => setAberto(false)} onDone={() => { carregar(); avisar() }} />}
    </Card>
  )
}
