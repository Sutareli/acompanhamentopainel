import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Msg, inp } from './ui'
import { confirmar } from './Confirm'
import { lerXlsx } from '../lib/xlsx'
import { CAMPO_LABEL, CAMPOS, Campo, CsatResp, fmtPct, kpis, lerQuadro, linhaCabecalho, Mapa, montarRespostas, sugerirColunas, tabelaCsv, Visao, visaoDe } from '../lib/csat'

/** Cards de Importar bases do C-SAT Rocco: (a) exportação de C-SAT do Rocco — acumula o histórico; (b) QUADRO — hierarquia por ALMOPE. Aceita .xlsx ou .csv. */
const MAX = 25 * 1024 * 1024
type Tabela = { nome: string; linhas: string[][] }

async function lerTabelas(f: File): Promise<Tabela[]> {
  const buf = await f.arrayBuffer()
  if (/\.xls[xm]$/i.test(f.name)) return (await lerXlsx(buf)).filter((a) => a.linhas.length > 0)
  if (/\.xls$/i.test(f.name)) throw new Error('Formato .xls antigo não é lido: no Excel, salve como .xlsx ou CSV.')
  let txt: string
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { txt = new TextDecoder('windows-1252').decode(buf) }
  return [{ nome: f.name, linhas: tabelaCsv(txt) }]
}
const assinatura = (head: string[]) => 'csat-mapa:' + head.map((h) => h.trim().toLowerCase()).join('|')

export function CsatRespostasCard({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const [ult, setUlt] = useState<{ id: number; em: string; arquivo: string | null; novas: number; lidas: number } | null>(null)
  const [base, setBase] = useState<{ total: number } | null>(null)
  const [nome, setNome] = useState(''); const [abas, setAbas] = useState<Tabela[]>([]); const [aba, setAba] = useState(0)
  const [cols, setCols] = useState<Record<Campo, number> | null>(null)
  const [modoVisao, setModoVisao] = useState<'coluna' | Visao | ''>('')
  const [extras, setExtras] = useState<number[]>([])
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState(0); const [prog, setProg] = useState('')

  const carga = async () => {
    const [c, n] = await Promise.all([
      supabase.from('csat_cargas').select('id,em,arquivo,novas,lidas').eq('tipo', 'respostas').order('em', { ascending: false }).limit(1),
      supabase.from('csat_respostas').select('id', { count: 'exact', head: true }),
    ])
    if (c.error) { setErr('As tabelas do C-SAT ainda não existem no banco: execute a migração supabase/040_csat_rocco.sql no SQL Editor.'); return }
    setUlt(c.data?.[0] || null); setBase({ total: n.count ?? 0 })
  }
  useEffect(() => { carga() }, [])

  const tab = abas[aba]
  const hi = tab ? linhaCabecalho(tab.linhas) : 0
  const head = tab ? tab.linhas[hi] || [] : []
  const dados = useMemo(() => (tab ? tab.linhas.slice(hi + 1) : []), [tab, hi])

  function prepararAba(t: Tabela, arq: string) {
    const h = linhaCabecalho(t.linhas); const hd = t.linhas[h] || []; const ds = t.linhas.slice(h + 1)
    let salvo: { cols: Record<Campo, number>; modo: 'coluna' | Visao | ''; extras: number[] } | null = null
    try { salvo = JSON.parse(localStorage.getItem(assinatura(hd)) || 'null') } catch { /* sem mapa salvo */ }
    const sug = salvo?.cols ?? sugerirColunas(hd, ds)
    setCols(sug); setExtras(salvo?.extras ?? [])
    let modo: 'coluna' | Visao | '' = salvo?.modo ?? ''
    if (!salvo) {
      const reconhece = sug.visao >= 0 && ds.slice(0, 200).some((r) => visaoDe(r[sug.visao]))
      modo = reconhece ? 'coluna' : /exec|gest/i.test(arq) ? 'executiva' : /perf|oper/i.test(arq) ? 'performance' : ''
    }
    setModoVisao(modo)
  }
  async function escolher(f: File | undefined) {
    setAbas([]); setCols(null); setErr(''); setOk(''); if (!f) return
    if (f.size > MAX) return setErr('Arquivo muito grande (máximo de 25 MB).')
    setNome(f.name)
    try {
      const ts = await lerTabelas(f); if (!ts.length) return setErr('O arquivo está vazio.')
      // aba inicial: a primeira em que a nota é reconhecida
      let i = ts.findIndex((t) => { const h = linhaCabecalho(t.linhas); return sugerirColunas(t.linhas[h] || [], t.linhas.slice(h + 1)).nota >= 0 }); if (i < 0) i = 0
      setAbas(ts); setAba(i); prepararAba(ts[i], f.name)
    } catch (e) { setErr('Não consegui ler o arquivo: ' + (e as Error).message) }
  }

  const mapa: Mapa | null = cols ? { cols, visaoFixa: modoVisao === 'performance' || modoVisao === 'executiva' ? modoVisao : null, notasExtras: extras } : null
  const lei = useMemo(() => (mapa && (modoVisao !== '') ? montarRespostas(head, dados, { ...mapa, cols: { ...mapa.cols, visao: modoVisao === 'coluna' ? mapa.cols.visao : -1 } }) : null), [head, dados, cols, modoVisao, extras])   // eslint-disable-line react-hooks/exhaustive-deps
  const outrasNotas = useMemo(() => (cols ? head.map((_, i) => i).filter((i) => i !== cols.nota && Object.values(cols).indexOf(i) < 0 && (() => { const v = dados.slice(0, 300).map((l) => (l[i] ?? '').trim()).filter(Boolean); return v.length > 0 && v.filter((x) => /^[1-5]([.,]0+)?$/.test(x)).length / v.length >= 0.8 })()) : []), [head, dados, cols])

  async function enviar() {
    if (!lei?.rows.length || !cols) return
    setBusy(true); setErr(''); setOk(''); setProg('')
    try { localStorage.setItem(assinatura(head), JSON.stringify({ cols, modo: modoVisao, extras })) } catch { /* ignora */ }
    const c = await supabase.from('csat_cargas').insert({ tipo: 'respostas', arquivo: nome, lidas: lei.rows.length, por: profile?.id }).select('id').single()
    if (c.error) { setBusy(false); return setErr('Falha ao registrar a carga: ' + c.error.message + ' (a migração 040 foi executada?)') }
    const cid = c.data.id as number; let novas = 0
    const lote = 500
    for (let i = 0; i < lei.rows.length; i += lote) {
      setProg(`Gravando ${Math.min(i + lote, lei.rows.length)} de ${lei.rows.length}…`)
      const parte: CsatResp[] = lei.rows.slice(i, i + lote).map((r) => ({ ...r, carga_id: cid }))
      const r = await supabase.from('csat_respostas').upsert(parte, { onConflict: 'chave', ignoreDuplicates: true }).select('id')
      if (r.error) { setBusy(false); setProg(''); await supabase.from('csat_cargas').update({ novas }).eq('id', cid); return setErr(`Falha na gravação (${novas} resposta(s) novas já entraram; reenviar o arquivo não duplica): ` + r.error.message) }
      novas += r.data?.length ?? 0
    }
    await supabase.from('csat_cargas').update({ novas }).eq('id', cid)
    setBusy(false); setProg('')
    setOk(`${novas} resposta(s) nova(s) acrescentada(s) ao histórico · ${lei.rows.length - novas} já existiam e foram puladas.`)
    setAbas([]); setCols(null); setKey((k) => k + 1); await carga()
  }
  async function desfazer() {
    if (!ult) return
    if (!(await confirmar({ titulo: 'Desfazer a última carga do C-SAT?', mensagem: `Remove as ${ult.novas} resposta(s) que entraram na carga de ${fmtDateTime(ult.em)}${ult.arquivo ? ` (${ult.arquivo})` : ''}. O restante do histórico não muda.`, confirmar: 'Desfazer carga', perigo: true }))) return
    setBusy(true); setErr(''); setOk('')
    const d = await supabase.from('csat_respostas').delete().eq('carga_id', ult.id)
    if (!d.error) await supabase.from('csat_cargas').delete().eq('id', ult.id)
    setBusy(false)
    if (d.error) return setErr(d.error.message)
    setOk('Carga desfeita.'); await carga()
  }

  const datas = lei?.rows.map((r) => r.data).sort() ?? []
  const kp = lei ? kpis(lei.rows) : null
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-navy">4 · C-SAT Rocco — respostas da pesquisa</h2>
          <p className="text-sm text-slate-600">Alimenta o módulo <b>C-SAT Rocco</b>. Envie a exportação de C-SAT do Rocco (ex.: <i>CSat_1_a_18</i>) em <b>.xlsx</b> ou CSV. A base é <b>acumulativa</b>: as respostas novas entram e as que já existem são puladas (pode reenviar arquivos que se sobrepõem).</p>
        </div>
        <button className={btnG + ' ' + btnSm} onClick={() => onNavigate('csat')}>Abrir C-SAT Rocco →</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{base ? `Histórico atual: ${base.total.toLocaleString('pt-BR')} resposta(s).` : ''} {ult ? `Última carga em ${fmtDateTime(ult.em)}${ult.arquivo ? ` (${ult.arquivo})` : ''}: ${ult.novas} nova(s).` : 'Nenhuma carga registrada ainda.'}</p>
      <div className="mt-3 space-y-3 text-sm">
        <input key={key} type="file" accept=".xlsx,.xlsm,.csv,text/csv" aria-label="Base de C-SAT" onChange={(e) => escolher(e.target.files?.[0])} />
        {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
        {tab && cols && (
          <div className="space-y-3 rounded-xl border border-violet-100 p-3">
            {abas.length > 1 && (
              <label className="block max-w-xs text-xs font-semibold text-slate-600">Aba da planilha
                <select className={inp + ' mt-1'} value={aba} onChange={(e) => { const i = +e.target.value; setAba(i); prepararAba(abas[i], nome) }}>{abas.map((a, i) => <option key={i} value={i}>{a.nome}</option>)}</select>
              </label>
            )}
            <div>
              <div className="text-xs font-semibold text-slate-600">Visão desta base</div>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={modoVisao === 'performance'} onChange={() => setModoVisao('performance')} /> Performance (operadores)</label>
                <label className="flex items-center gap-1"><input type="radio" checked={modoVisao === 'executiva'} onChange={() => setModoVisao('executiva')} /> Executiva (gestores)</label>
                <label className="flex items-center gap-1"><input type="radio" checked={modoVisao === 'coluna'} onChange={() => setModoVisao('coluna')} /> As duas — uma coluna indica a visão</label>
              </div>
            </div>
            <details open={!lei || !!lei.erro}>
              <summary className="cursor-pointer text-xs font-semibold text-violet-700">Colunas reconhecidas (confira e ajuste se precisar — fica salvo para as próximas cargas)</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CAMPOS.filter((c) => c !== 'visao' || modoVisao === 'coluna').map((c) => (
                  <label key={c} className="block text-xs text-slate-600">{CAMPO_LABEL[c]}
                    <select className={inp + ' mt-1'} value={cols[c]} onChange={(e) => setCols({ ...cols, [c]: +e.target.value })}>
                      <option value={-1}>— nenhuma —</option>
                      {head.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {outrasNotas.length > 0 && (
                <div className="mt-2 text-xs text-slate-600">
                  <b>Outras colunas com notas de 1 a 5</b> (se a base tem uma coluna por pergunta, marque-as — o cabeçalho vira o nome da pergunta):
                  <div className="mt-1 flex flex-wrap gap-3">{outrasNotas.map((i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" checked={extras.includes(i)} onChange={(e) => setExtras(e.target.checked ? [...extras, i] : extras.filter((x) => x !== i))} />{head[i]}</label>)}</div>
                </div>
              )}
            </details>
            {modoVisao === '' && <Msg kind="aviso">Diga se esta base é da visão Performance ou Executiva.</Msg>}
            {lei?.erro && <Msg kind="erro">{lei.erro}</Msg>}
            {lei?.avisos.map((a) => <Msg key={a} kind="aviso">{a}</Msg>)}
            {lei && !lei.erro && kp && (
              <div className="rounded-xl bg-violet-50 p-3"><b>{nome}</b>: {lei.rows.length.toLocaleString('pt-BR')} resposta(s) · {fmtDate(datas[0])} a {fmtDate(datas[datas.length - 1])} · {lei.rows.filter((r) => r.visao === 'performance').length} Performance · {lei.rows.filter((r) => r.visao === 'executiva').length} Executiva · C-SAT do arquivo <b>{fmtPct(kp.csat)}</b>.</div>
            )}
          </div>
        )}
        {prog && <p className="text-xs text-slate-500">{prog}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={btnP} disabled={!lei?.rows.length || !!lei?.erro || busy} onClick={enviar}>{busy ? 'Gravando…' : lei?.rows.length ? `Acrescentar ao histórico (${lei.rows.length.toLocaleString('pt-BR')})` : 'Acrescentar ao histórico'}</button>
          <button className={btnG} disabled={busy || !ult} onClick={desfazer} title="Remove as respostas que entraram na última carga">↩ Desfazer última carga</button>
        </div>
      </div>
    </Card>
  )
}

export function CsatQuadroCard() {
  const { profile } = useAuth()
  const [atual, setAtual] = useState<{ qtd: number; em: string | null } | null>(null)
  const [lei, setLei] = useState<ReturnType<typeof lerQuadro> | null>(null)
  const [nome, setNome] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState(0)
  const carga = async () => {
    const [q, c] = await Promise.all([supabase.from('csat_quadro').select('almope', { count: 'exact', head: true }), supabase.from('csat_cargas').select('em').eq('tipo', 'quadro').order('em', { ascending: false }).limit(1)])
    if (!q.error) setAtual({ qtd: q.count ?? 0, em: c.data?.[0]?.em ?? null })
  }
  useEffect(() => { carga() }, [])
  async function escolher(f: File | undefined) {
    setLei(null); setErr(''); setOk(''); if (!f) return
    if (f.size > MAX) return setErr('Arquivo muito grande (máximo de 25 MB).')
    setNome(f.name)
    try {
      const ts = await lerTabelas(f)
      // aba com a coluna ALMOPE
      const boa = ts.map((t) => lerQuadro(t.linhas)).find((r) => !r.erro) ?? lerQuadro(ts[0]?.linhas ?? [])
      setLei(boa)
    } catch (e) { setErr('Não consegui ler o arquivo: ' + (e as Error).message) }
  }
  async function enviar() {
    if (!lei?.rows.length) return
    setBusy(true); setErr('')
    const agora = new Date().toISOString()
    for (let i = 0; i < lei.rows.length; i += 500) {
      const r = await supabase.from('csat_quadro').upsert(lei.rows.slice(i, i + 500).map((x) => ({ ...x, atualizado_em: agora })), { onConflict: 'almope' })
      if (r.error) { setBusy(false); return setErr('Falha na gravação: ' + r.error.message + ' (a migração 040 foi executada?)') }
    }
    await supabase.from('csat_cargas').insert({ tipo: 'quadro', arquivo: nome, lidas: lei.rows.length, novas: lei.rows.length, por: profile?.id })
    setBusy(false); setOk(`QUADRO atualizado: ${lei.rows.length} pessoa(s).`); setLei(null); setKey((k) => k + 1); await carga()
  }
  return (
    <Card>
      <h2 className="text-lg font-bold text-navy">5 · C-SAT Rocco — QUADRO (hierarquia)</h2>
      <p className="text-sm text-slate-600">Dá nome, supervisor, coordenador e site a cada resposta, ligando a coluna <b>ALMOPE</b> do QUADRO ao <b>usuário</b> da base de C-SAT. Reenviar atualiza quem já existe e acrescenta os novos (ninguém é apagado). Colunas lidas: ALMOPE (obrigatória), NOME, SUPERVISOR, COORDENADOR, GERENTE, SITE, CARGO/FUNÇÃO, OPERAÇÃO/CLIENTE.</p>
      <p className="mt-2 text-xs text-slate-500">{atual ? `QUADRO atual: ${atual.qtd} pessoa(s)${atual.em ? `, atualizado em ${fmtDateTime(atual.em)}` : ''}.` : ''}</p>
      <div className="mt-3 space-y-3 text-sm">
        <input key={key} type="file" accept=".xlsx,.xlsm,.csv,text/csv" aria-label="QUADRO" onChange={(e) => escolher(e.target.files?.[0])} />
        {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
        {lei?.erro && <Msg kind="erro">{lei.erro}</Msg>}
        {lei && !lei.erro && <div className="rounded-xl bg-violet-50 p-3"><b>{nome}</b>: {lei.rows.length} pessoa(s) · {new Set(lei.rows.map((r) => r.site).filter(Boolean)).size} site(s) · {new Set(lei.rows.map((r) => r.supervisor).filter(Boolean)).size} supervisor(es).</div>}
        <button className={btnP} disabled={!lei?.rows.length || busy} onClick={enviar}>{busy ? 'Gravando…' : 'Atualizar QUADRO'}</button>
      </div>
    </Card>
  )
}
