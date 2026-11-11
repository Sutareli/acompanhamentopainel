import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, download, fmtDate, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Msg } from '../components/ui'
import { ChamadoImport, lerBase } from '../lib/chamados'
import { LeituraMicro, lerMicro, modeloMicroCsv, PessoaRef } from '../lib/microImport'

/** Janela exclusiva do Analista Sr: importação das bases (chamados do backlog/Pareto e projetos). A trava real está no banco (RLS e função chamados_substituir). */
async function lerArquivo(f: File): Promise<string> {
  const buf = await f.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }   // CSV "ANSI" do Excel
}

export default function ImportarBases({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  if (!canAdmin(profile?.perfil)) return <Msg kind="aviso">Esta janela é exclusiva do Analista Sr.</Msg>
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Importar bases</h1>
        <p className="text-sm text-slate-500">Exclusivo do Analista Sr. Envie arquivos CSV (no Excel: Salvar como → CSV UTF-8, separador ; ou ,).</p>
      </div>
      <ChamadosCard onNavigate={onNavigate} />
      <MicroCard onNavigate={onNavigate} />
    </div>
  )
}

function ChamadosCard({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [atual, setAtual] = useState<{ em: string; qtd: number } | null>(null)
  const [rows, setRows] = useState<ChamadoImport[] | null>(null)
  const [nome, setNome] = useState(''); const [avisos, setAvisos] = useState<string[]>([])
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState(0)

  const carga = async () => { const c = await supabase.from('backlog_chamados_carga').select('em,qtd').order('em', { ascending: false }).limit(1); setAtual(c.data?.[0] || null) }
  useEffect(() => { carga() }, [])

  async function escolher(f: File | undefined) {
    setRows(null); setErr(''); setOk(''); setAvisos([]); if (!f) return
    setNome(f.name)
    const r = lerBase(await lerArquivo(f))
    setAvisos(r.avisos); if (r.erro) setErr(r.erro); else setRows(r.rows)
  }
  async function enviar() {
    if (!rows) return
    setBusy(true); setErr('')
    const r = await supabase.rpc('chamados_substituir', { p_rows: rows })
    setBusy(false)
    if (r.error) return setErr('Falha na importação (a base atual foi mantida): ' + r.error.message)
    setOk(`Base substituída: ${rows.length} chamados importados.`); setRows(null); setKey((k) => k + 1); await carga()
  }
  const datas = rows ? rows.map((x) => x.data_ref).sort() : []
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-navy">1 · Base de chamados do backlog</h2>
          <p className="text-sm text-slate-600">Alimenta o <b>Pareto backlog</b> e o resumo de chamados dentro do <b>Backlog de Melhorias</b> (as duas telas leem esta mesma base). Use a aba <b>base</b> da planilha de análise.</p>
        </div>
        <button className={btnG + ' ' + btnSm} onClick={() => onNavigate('pareto')}>Abrir Pareto backlog →</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{atual ? `Base atual: ${atual.qtd} chamados, carregada em ${fmtDateTime(atual.em)}.` : 'Nenhuma carga registrada ainda.'} A importação <b>substitui toda a base</b>.</p>
      <div className="mt-3 space-y-3 text-sm">
        <input key={key} type="file" accept=".csv,text/csv" aria-label="CSV da base de chamados" onChange={(e) => escolher(e.target.files?.[0])} />
        {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
        {avisos.map((a) => <Msg key={a} kind="aviso">{a}</Msg>)}
        {rows && <div className="rounded-xl bg-violet-50 p-3"><b>{nome}</b>: {rows.length} chamados · período {fmtDate(datas[0])} a {fmtDate(datas[datas.length - 1])} · {new Set(rows.map((x) => x.tipo?.toLowerCase()).filter(Boolean)).size} tipos · {new Set(rows.map((x) => x.subcategoria?.toLowerCase()).filter(Boolean)).size} subcategorias.</div>}
        <button className={btnP} disabled={!rows || busy} onClick={enviar}>{busy ? 'Importando…' : rows ? `Substituir base (${rows.length})` : 'Substituir base'}</button>
      </div>
    </Card>
  )
}

function MicroCard({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [pessoas, setPessoas] = useState<PessoaRef[]>([])
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  const [lei, setLei] = useState<LeituraMicro | null>(null)
  const [nome, setNome] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [key, setKey] = useState(0)

  async function carregaRef() {
    const [p, m] = await Promise.all([supabase.from('profiles').select('id,nome,email,ativo'), supabase.from('microdeliveries').select('demanda,responsavel_id,data_target')])
    setPessoas((p.data || []) as PessoaRef[])
    setExistentes(new Set(((m.data || []) as { demanda: string; responsavel_id: string; data_target: string }[]).map((x) => `${x.demanda.trim().toLowerCase()}|${x.responsavel_id}|${x.data_target}`)))
  }
  useEffect(() => { carregaRef() }, [])

  async function escolher(f: File | undefined) {
    setLei(null); setErr(''); setOk(''); if (!f) return
    setNome(f.name); await carregaRef()
    setLei(lerMicro(await lerArquivo(f), pessoas, existentes))
  }
  async function enviar() {
    if (!lei?.rows.length) return
    setBusy(true); setErr('')
    const r = await supabase.from('microdeliveries').insert(lei.rows).select('id')   // uma única requisição: ou entra tudo ou nada
    setBusy(false)
    if (r.error) return setErr('Falha na importação (nada foi gravado): ' + r.error.message)
    setOk(`${lei.rows.length} projeto(s) importado(s).`); setLei(null); setKey((k) => k + 1); await carregaRef()
  }
  const podeImportar = !!lei && !lei.erroGeral && lei.erros.length === 0 && lei.rows.length > 0
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-navy">2 · Projetos (macro e micro)</h2>
          <p className="text-sm text-slate-600">Adiciona projetos em lote (não apaga as existentes; linhas iguais — mesma demanda, responsável e data target — são puladas). O histórico de criação é gravado como no cadastro manual.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnG + ' ' + btnSm} onClick={() => download('modelo-projetos.csv', modeloMicroCsv())}>⬇ Baixar modelo CSV</button>
          <button className={btnG + ' ' + btnSm} onClick={() => onNavigate('micro')}>Abrir Projetos →</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Colunas: DEMANDA, RESPONSÁVEL (e-mail ou nome exato de um usuário ativo), CRITICIDADE (alta/média/baixa), DATA TARGET (dd/mm/aaaa), QUANTIDADE, A INICIAR, EM ANDAMENTO, CONCLUÍDO, CANCELADO, RESUMO, OBSERVAÇÕES, TIPO (macro ou micro; vazio = micro) e COM QUEM ESTÁ (só para macro; opcional). Sem distribuição informada, tudo entra como “a iniciar”. A soma dos status deve igualar a quantidade.</p>
      <div className="mt-3 space-y-3 text-sm">
        <input key={key} type="file" accept=".csv,text/csv" aria-label="CSV de projetos" onChange={(e) => escolher(e.target.files?.[0])} />
        {err && <Msg kind="erro">{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
        {lei?.erroGeral && <Msg kind="erro">{lei.erroGeral}</Msg>}
        {lei && !lei.erroGeral && (
          <div className="rounded-xl bg-violet-50 p-3">
            <b>{nome}</b>: {lei.rows.length} para importar · {lei.duplicadas} já existente(s)/repetida(s) puladas · {lei.erros.length} com erro{lei.nomes.length ? ` · responsáveis: ${lei.nomes.join(', ')}` : ''}.
          </div>
        )}
        {lei && lei.erros.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
            <b>Corrija o arquivo e envie de novo — nada foi importado:</b>
            <ul className="mt-1 list-disc pl-5">{lei.erros.slice(0, 15).map((e) => <li key={e.linha}>Linha {e.linha}: {e.msg}</li>)}</ul>
            {lei.erros.length > 15 && <p>…e mais {lei.erros.length - 15} erro(s).</p>}
          </div>
        )}
        <button className={btnP} disabled={!podeImportar || busy} onClick={enviar}>{busy ? 'Importando…' : podeImportar ? `Importar ${lei!.rows.length} projeto(s)` : 'Importar'}</button>
      </div>
    </Card>
  )
}
