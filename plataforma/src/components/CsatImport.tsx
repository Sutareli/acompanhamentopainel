import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Msg } from './ui'
import { confirmar } from './Confirm'
import { acrescentarBase, gravarPlanilhaCompleta, gravarQuadros, lerExportacao, lerPlanilhaCompleta, lerQuadro, LeituraBase, LeituraPlanilha, LeituraQuadro } from '../csat/importar'
import type { Modelo } from '../csat/motor/pasta'

/** Importar bases → C-SAT Rocco: as mesmas atualizações que a planilha Rocco_CSAT_Dashboard pede (exportação do Rocco e QUADRO). */
const MAX = 40 * 1024 * 1024
export function CsatCard({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { profile } = useAuth()
  const [st, setSt] = useState<{ base: number; quadro: number; ult: { em: string; arquivo: string | null; tipo: string; novas: number } | null } | null>(null)
  const [exp, setExp] = useState<{ nome: string; l: LeituraBase } | null>(null)
  const [qd, setQd] = useState<{ nome: string; l: LeituraQuadro } | null>(null)
  const [pl, setPl] = useState<{ nome: string; l: LeituraPlanilha } | null>(null)
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(''); const [key, setKey] = useState(0)

  const estado = async () => {
    const [b, q, c] = await Promise.all([
      supabase.from('csat_base').select('id', { count: 'exact', head: true }),
      supabase.from('csat_quadros').select('fonte,parte'),
      supabase.from('csat_cargas').select('em,arquivo,tipo,novas').in('tipo', ['base', 'quadro', 'planilha']).order('em', { ascending: false }).limit(1),
    ])
    if (b.error) { setErr('As tabelas do C-SAT Rocco ainda não existem no banco: execute a migração supabase/041_csat_rocco_planilha.sql no SQL Editor.'); return }
    setSt({ base: b.count ?? 0, quadro: (q.data || []).length, ult: c.data?.[0] ?? null })
  }
  useEffect(() => { estado() }, [])
  const limpa = () => { setErr(''); setOk(''); setProg('') }
  const fim = async (msg: string) => { setOk(msg); setExp(null); setQd(null); setPl(null); setKey((k) => k + 1); setBusy(false); setProg(''); await estado() }
  const falha = (e: unknown) => { setErr((e as Error).message); setBusy(false); setProg('') }

  async function escolherExp(f?: File) { limpa(); setExp(null); if (!f) return; if (f.size > MAX) return setErr('Arquivo muito grande.'); try { setExp({ nome: f.name, l: await lerExportacao(f) }) } catch (e) { falha(e) } }
  async function escolherQd(f?: File) { limpa(); setQd(null); if (!f) return; if (f.size > MAX) return setErr('Arquivo muito grande.'); try { setQd({ nome: f.name, l: await lerQuadro(f) }) } catch (e) { falha(e) } }
  async function escolherPl(f?: File) {
    limpa(); setPl(null); if (!f) return; if (f.size > MAX) return setErr('Arquivo muito grande.')
    try { setProg('Lendo a planilha…'); const modelo = (await import('../csat/modelo.json')).default as unknown as Modelo; setPl({ nome: f.name, l: await lerPlanilhaCompleta(f, modelo) }); setProg('') } catch (e) { falha(e) }
  }
  async function enviarExp() { if (!exp) return; setBusy(true); limpa(); try { const r = await acrescentarBase(exp.l, exp.nome, profile?.id, setProg); await fim(`${r.novas} resposta(s) nova(s) acrescentada(s) à base · ${r.repetidas} já existiam (mesmo Código) e foram puladas.`) } catch (e) { falha(e) } }
  async function enviarQd() { if (!qd) return; setBusy(true); limpa(); try { await gravarQuadros(qd.l, qd.nome, profile?.id); await fim('QUADRO atualizado.') } catch (e) { falha(e) } }
  async function enviarPl() {
    if (!pl) return
    if (st && st.base > 0 && !(await confirmar({ titulo: 'Substituir tudo pela planilha?', mensagem: `A base atual (${st.base} respostas), os quadros as Regras, os Cadastros e a Hierarquia serão trocados pelo conteúdo de ${pl.nome}.`, confirmar: 'Substituir', perigo: true }))) return
    setBusy(true); limpa(); try { await gravarPlanilhaCompleta(pl.l, pl.nome, profile?.id, setProg); await fim(`Planilha carregada: ${pl.l.base.linhas.length} respostas, quadros Regras, Cadastros e Hierarquia.`) } catch (e) { falha(e) }
  }
  const lq = (q: LeituraQuadro) => `${q.colab ? q.colab.length - 1 : 0} em Colaboradores · ${q.staff ? q.staff.length - 1 : 0} em STAFF`

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-navy">4 · C-SAT Rocco</h2>
          <p className="text-sm text-slate-600">Alimenta o módulo <b>C-SAT Rocco</b> (a réplica da planilha Rocco_CSAT_Dashboard). Aceita os arquivos <b>.xlsx</b> direto.</p>
        </div>
        <button className={btnG + ' ' + btnSm} onClick={() => onNavigate('csat')}>Abrir C-SAT Rocco →</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{st ? `Base atual: ${st.base.toLocaleString('pt-BR')} resposta(s) · QUADRO ${st.quadro ? 'carregado' : 'não carregado'}.` : ''} {st?.ult ? `Última carga em ${fmtDateTime(st.ult.em)}${st.ult.arquivo ? ` (${st.ult.arquivo})` : ''}.` : ''}</p>
      {err && <div className="mt-2"><Msg kind="erro">{err}</Msg></div>}{ok && <div className="mt-2"><Msg kind="ok">{ok}</Msg></div>}
      {prog && <p className="mt-2 text-xs text-slate-500">{prog}</p>}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-violet-100 p-3 text-sm">
          <h3 className="font-semibold text-ink">Exportação de C-SAT do Rocco</h3>
          <p className="mt-1 text-xs text-slate-600">O mesmo que colar a exportação (colunas Código … Neutro) no fim da aba Base de Dados: as respostas com <b>Código</b> novo entram; as que já existem são puladas. Pode enviar a exportação do mês inteiro.</p>
          <input key={'e' + key} className="mt-2 w-full text-xs" type="file" accept=".xlsx,.xlsm,.csv" aria-label="Exportação do Rocco" onChange={(e) => escolherExp(e.target.files?.[0])} />
          {exp && <div className="mt-2 rounded bg-violet-50 p-2 text-xs"><b>{exp.nome}</b>: {exp.l.linhas.length} resposta(s) lida(s).{exp.l.avisos.map((a) => <div key={a} className="text-amber-700">{a}</div>)}</div>}
          <button className={btnP + ' mt-2'} disabled={!exp || busy} onClick={enviarExp}>{busy && exp ? 'Gravando…' : 'Acrescentar à base'}</button>
        </div>
        <div className="rounded-md border border-violet-100 p-3 text-sm">
          <h3 className="font-semibold text-ink">QUADRO (hierarquia)</h3>
          <p className="mt-1 text-xs text-slate-600">O arquivo QUADRO com as abas <b>Colaboradores</b> e <b>STAFF</b>. Substitui as abas "Quadro Colaboradores" e "Quadro STAFF" (as colunas são localizadas pelo nome, como na aba Hierarquia).</p>
          <input key={'q' + key} className="mt-2 w-full text-xs" type="file" accept=".xlsx,.xlsm" aria-label="QUADRO" onChange={(e) => escolherQd(e.target.files?.[0])} />
          {qd && <div className="mt-2 rounded bg-violet-50 p-2 text-xs"><b>{qd.nome}</b>: {lq(qd.l)}.</div>}
          <button className={btnP + ' mt-2'} disabled={!qd || busy} onClick={enviarQd}>{busy && qd ? 'Gravando…' : 'Substituir QUADRO'}</button>
        </div>
        <div className="rounded-md border border-violet-100 p-3 text-sm">
          <h3 className="font-semibold text-ink">Planilha completa (primeira carga)</h3>
          <p className="mt-1 text-xs text-slate-600">O arquivo <b>Rocco_CSAT_Dashboard.xlsx</b>: traz a Base de Dados (com as revisões manuais), os dois quadros, as Regras, os Cadastros e o mapeamento da Hierarquia. <b>Substitui tudo.</b></p>
          <input key={'p' + key} className="mt-2 w-full text-xs" type="file" accept=".xlsx,.xlsm" aria-label="Planilha completa" onChange={(e) => escolherPl(e.target.files?.[0])} />
          {pl && <div className="mt-2 rounded bg-violet-50 p-2 text-xs"><b>{pl.nome}</b>: {pl.l.base.linhas.length} resposta(s) · {lq(pl.l.quadros)} · {pl.l.ajustes.length} célula(s) de Regras/Cadastros/Hierarquia.</div>}
          <button className={btnP + ' mt-2'} disabled={!pl || busy} onClick={enviarPl}>{busy && pl ? 'Gravando…' : 'Carregar planilha'}</button>
        </div>
      </div>
    </Card>
  )
}
