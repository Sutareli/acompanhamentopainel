import { useState } from 'react'
import { Bar, btnG, Card, Empty, inp } from './ui'
import { pctDaFase, Fase, FASE_INFO, FASES, dataDaFase, diasEntre, emDev, faseDe, faseInfo, Melhoria, vencida, STATUS_COLOR } from '../lib/backlog'
import { fmtDate } from '../lib/rules'
import { slaAtual, slaCumprido } from '../lib/sla'

/** Visão GERENCIAL das melhorias: números-chave, funil, ritmo mensal, tempo por etapa, módulos e destaques — para apresentar rápido. */
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesDe = (d?: string | null) => (d ? d.slice(0, 7) : '')
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null)
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000

export default function MelhoriasGerencial({ rows, hoje, nomeResp, onAbrir, onIrParaEtapa }: {
  rows: Melhoria[]; hoje: string; nomeResp: (r: Melhoria) => string | null; onAbrir: (id: string) => void; onIrParaEtapa: (k: Fase) => void
}) {
  const [meses, setMeses] = useState(6)
  const [copiado, setCopiado] = useState('')
  const [painel, setPainel] = useState<'' | 'prazo' | 'sla'>('')
  const fase = (r: Melhoria) => faseDe(r)
  const por = (k: Fase) => rows.filter((r) => fase(r) === k)
  const total = rows.length
  const producao = por('producao'), dev = rows.filter((r) => emDev(fase(r))), cham = por('chamado_aberto'), ideias = por('ideia')
  const fila = rows.filter((r) => ['priorizada', 'especificacao', 'chamado_aberto'].includes(fase(r)))
  const abertas = rows.filter((r) => fase(r) !== 'producao')
  const atrasadas = abertas.filter((r) => vencida(r, hoje))
  const semResp = abertas.filter((r) => !r.responsavel_id)
  const emDia = dev.filter((r) => !vencida(r, hoje))
  const proximas = dev.filter((r) => r.data_termino && r.data_termino >= hoje && dayNum(r.data_termino) - dayNum(hoje) <= 14)
  const espera = (campo: 'data_priorizacao' | 'data_especificacao' | 'data_abertura') => (a: Melhoria, b: Melhoria) => ((a[campo] as string) || '9999').localeCompare((b[campo] as string) || '9999')
  const aguardandoChamado = rows.filter((r) => fase(r) === 'priorizada' || fase(r) === 'especificacao').sort((a, b) => ((a.data_especificacao || a.data_priorizacao) || '9999').localeCompare((b.data_especificacao || b.data_priorizacao) || '9999'))
  const aguardandoDev = cham.slice().sort(espera('data_abertura'))

  // SLA: vencidos agora + cumprimento das transições já realizadas
  const slaLista = abertas.map((r) => ({ r, s: slaAtual(r, hoje) })).filter((x): x is { r: Melhoria; s: NonNullable<ReturnType<typeof slaAtual>> } => !!x.s)
  const slaVenc = slaLista.filter((x) => x.s.estado === 'atrasado').sort((a, b) => b.s.n - a.s.n)
  const slaHoje = slaLista.filter((x) => x.s.estado === 'vence_hoje').length
  const cumpr = (e: 'chamado_aberto' | 'em_desenvolvimento') => { const v = rows.map((r) => slaCumprido(r, e)).filter((x): x is boolean => x !== null); return { n: v.length, ok: v.filter(Boolean).length } }
  const cumprCham = cumpr('chamado_aberto'), cumprDev = cumpr('em_desenvolvimento')

  // ritmo mensal
  const hojeY = +hoje.slice(0, 4), hojeM = +hoje.slice(5, 7)
  const lista = Array.from({ length: meses }, (_, i) => { const t = hojeM - 1 - (meses - 1 - i); const y = hojeY + Math.floor(t / 12); const m = ((t % 12) + 12) % 12; return { k: `${y}-${String(m + 1).padStart(2, '0')}`, l: `${MESES[m]}/${String(y).slice(2)}` } })
  const conta = (campo: (r: Melhoria) => string | null | undefined, k: string) => rows.filter((r) => mesDe(campo(r)) === k).length
  const serie = lista.map((m) => ({ ...m, ideias: conta((r) => r.data_ideia, m.k), pri: conta((r) => r.data_priorizacao, m.k), cham: conta((r) => r.data_abertura, m.k), apl: conta((r) => dataDaFase(r, 'producao'), m.k) }))
  const maxS = Math.max(1, ...serie.flatMap((s) => [s.ideias, s.cham, s.apl]))
  const aplicNoPeriodo = serie.reduce((s, x) => s + x.apl, 0)

  // tempo médio entre etapas (dias), só onde as duas datas existem
  const gap = (a: (r: Melhoria) => string | null | undefined, b: (r: Melhoria) => string | null | undefined) => {
    const xs = rows.map((r) => { const x = a(r), y = b(r); return x && y ? diasEntre(x, y) : null }).filter((v): v is number => v !== null && v >= 0)
    return { m: media(xs), n: xs.length }
  }
  const tempos = FASE_INFO.slice(0, -1).map((f, i) => { const g = FASE_INFO[i + 1]; return { l: `${f.label} → ${g.label}`, ...gap((r) => dataDaFase(r, f.k), (r) => dataDaFase(r, g.k)) } })
  const ciclo = gap((r) => dataDaFase(r, 'ideia'), (r) => dataDaFase(r, 'producao'))

  // responsáveis
  const resps = [...new Set(rows.map((r) => r.responsavel_id || ''))].map((id) => {
    const rs = rows.filter((r) => (r.responsavel_id || '') === id)
    return { id, nome: id ? nomeResp(rs[0]) || '(usuário)' : 'Sem responsável', n: rs.length, ab: rs.filter((r) => fase(r) !== 'producao').length, prod: rs.filter((r) => fase(r) === 'producao').length, dev: rs.filter((r) => emDev(fase(r))).length, atr: rs.filter((r) => vencida(r, hoje)).length }
  }).sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.ab - a.ab || a.nome.localeCompare(b.nome, 'pt-BR')))

  // módulos
  const mods = [...new Set(rows.map((r) => r.modulo))].map((m) => {
    const rs = rows.filter((r) => r.modulo === m)
    return { m, n: rs.length, f: FASES.map((k) => rs.filter((r) => fase(r) === k).length), apl: rs.filter((r) => fase(r) === 'producao').length, atr: rs.filter((r) => fase(r) !== 'producao' && vencida(r, hoje)).length }
  }).sort((a, b) => b.n - a.n || a.m.localeCompare(b.m, 'pt-BR'))

  const ultimasAplicadas = producao.slice().sort((a, b) => (b.data_conclusao || '').localeCompare(a.data_conclusao || '')).slice(0, 5)
  const devOrd = dev.slice().sort((a, b) => (a.data_termino || '9999').localeCompare(b.data_termino || '9999') || a.prioridade - b.prioridade)

  function resumoTexto() {
    const L = [`RESUMO DAS MELHORIAS — ${fmtDate(hoje)}`, '',
      `Total: ${total} · Em produção: ${producao.length} (${pct(producao.length, total)}%) · Desenvolvimento/homologação: ${dev.length} · Fila (priorização, especificação, chamado aberto): ${fila.length} · Ideias: ${ideias.length}`,
      `SLA vencido: ${slaVenc.length} · Prazo vencido: ${atrasadas.length} · Entregas nos próximos 14 dias: ${proximas.length} · Sem responsável: ${semResp.length}`, '']
    if (slaVenc.length) { L.push('SLA VENCIDO:'); slaVenc.slice(0, 8).forEach(({ r, s }) => L.push(`- ${r.melhoria} (${r.modulo}) — ${faseInfo(fase(r)).label} — ${s.txt.toLowerCase()} (venceu em ${fmtDate(s.venc)})`)); L.push('') }
    L.push('POR ETAPA: ' + FASE_INFO.map((f) => `${f.label} ${por(f.k).length}`).join(' · '), '')
    if (dev.length) { L.push('EM DESENVOLVIMENTO / HOMOLOGAÇÃO:'); devOrd.forEach((r) => L.push(`- ${r.melhoria} (${r.modulo}) — ${faseInfo(fase(r)).label} — ${pctDaFase(fase(r))}% — prazo ${fmtDate(r.data_termino)}${vencida(r, hoje) ? ' (VENCIDO)' : ''} — resp.: ${nomeResp(r) || 'sem responsável'}`)); L.push('') }
    if (aguardandoChamado.length) { L.push(`AGUARDANDO ABERTURA DE CHAMADO (${aguardandoChamado.length}):`); aguardandoChamado.slice(0, 5).forEach((r) => L.push(`- ${r.melhoria} (${r.modulo}) — ${faseInfo(fase(r)).label} — resp.: ${nomeResp(r) || 'sem responsável'}`)); L.push('') }
    if (ultimasAplicadas.length) { L.push('ÚLTIMAS EM PRODUÇÃO:'); ultimasAplicadas.forEach((r) => L.push(`- ${r.melhoria} (${r.modulo}) — ${fmtDate(r.data_conclusao)}`)) }
    return L.join('\n')
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(resumoTexto()); setCopiado('Resumo copiado.') } catch { setCopiado('Não foi possível copiar neste navegador.') }
    setTimeout(() => setCopiado(''), 3000)
  }

  if (!total) return <Empty>Nenhuma melhoria cadastrada ainda.</Empty>
  const Num = ({ v, l, cor, sub, onClick, ativo }: { v: number | string; l: string; cor: string; sub?: string; onClick?: () => void; ativo?: boolean }) => (
    <button disabled={!onClick} onClick={onClick} aria-pressed={ativo} className={(ativo ? 'ring-2 ring-red-300 ' : '') + "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm enabled:hover:border-violet-300"}>
      <div className="text-xs text-slate-500">{l}</div><div className="text-3xl font-extrabold" style={{ color: cor }}>{v}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </button>
  )
  const nomeDias = (d: string | null | undefined) => (d ? `${Math.max(0, diasEntre(d, hoje))} d` : '—')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Posição em {fmtDate(hoje)} · {total} melhorias no painel.</p>
        <div className="flex items-center gap-2">{copiado && <span className="text-xs text-emerald-700">{copiado}</span>}<button className={btnG} onClick={copiar}>📋 Copiar resumo (texto)</button></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Num v={total} l="Melhorias no painel" cor="#2e1a6e" />
        <Num v={producao.length} l="Em produção" cor="#16a34a" sub={`${pct(producao.length, total)}% do total`} onClick={() => onIrParaEtapa('producao')} />
        <Num v={dev.length} l="Desenvolvimento / homologação" cor="#2563eb" sub={dev.length ? `${emDia.length} no prazo · ${dev.length - emDia.length} vencida(s)` : undefined} onClick={() => onIrParaEtapa('em_desenvolvimento')} />
        <Num v={fila.length} l="Na fila" cor="#7c3aed" sub="priorização, especificação e chamado aberto" onClick={() => onIrParaEtapa('priorizada')} />
        <Num v={ideias.length} l="Ideias a debater" cor="#64748b" onClick={() => onIrParaEtapa('ideia')} />
        <Num v={atrasadas.length} l="Prazo vencido" cor={atrasadas.length ? '#dc2626' : '#16a34a'} sub={`${proximas.length} entrega(s) em até 14 dias · clique para ver`} onClick={() => setPainel(painel === 'prazo' ? '' : 'prazo')} ativo={painel === 'prazo'} />
        <Num v={slaVenc.length} l="SLA vencido" cor={slaVenc.length ? '#dc2626' : '#16a34a'} sub={`${slaHoje} vence(m) hoje · clique para ver`} onClick={() => setPainel(painel === 'sla' ? '' : 'sla')} ativo={painel === 'sla'} />
        <Num v={semResp.length} l="Sem responsável" cor={semResp.length ? '#d97706' : '#16a34a'} sub="melhorias abertas" />
      </div>

      {painel && (
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-bold text-navy">{painel === 'prazo' ? '⚠ Melhorias com prazo de entrega vencido' : '⏱ Melhorias com SLA vencido'} ({painel === 'prazo' ? atrasadas.length : slaVenc.length})</h3><button className={btnG + ' !px-3 !py-1 !text-xs'} onClick={() => setPainel('')}>Fechar</button></div>
          {(painel === 'prazo' ? atrasadas.length : slaVenc.length) === 0 ? <p className="text-sm text-emerald-700">Nenhuma melhoria nesta situação.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2">Melhoria</th><th className="pr-2">Módulo</th><th className="pr-2">Etapa</th><th className="pr-2">Responsável</th><th className="pr-2">Nº chamado</th><th>{painel === 'prazo' ? 'Prazo / atraso' : 'SLA'}</th></tr></thead>
              <tbody>{(painel === 'prazo' ? atrasadas.slice().sort((a, b) => (a.data_termino || '').localeCompare(b.data_termino || '')).map((r) => ({ r, txt: `venceu em ${fmtDate(r.data_termino)} (${diasEntre(r.data_termino as string, hoje)} dias de atraso)` })) : slaVenc.map(({ r, s }) => ({ r, txt: `${s.txt} (venceu em ${fmtDate(s.venc)})` }))).map(({ r, txt }) => (
                <tr key={r.id} className="border-t border-slate-100"><td className="py-1.5 pr-2"><button className="text-left font-semibold text-navy hover:underline" onClick={() => onAbrir(r.id)}>{r.melhoria}</button></td><td className="pr-2 text-xs text-slate-600">{r.modulo}</td><td className="pr-2 text-xs font-semibold" style={{ color: faseInfo(fase(r)).cor }}>{faseInfo(fase(r)).label}</td><td className={'pr-2 text-xs ' + (r.responsavel_id ? 'text-slate-600' : 'font-semibold text-amber-600')}>{nomeResp(r) || 'sem responsável'}</td><td className="pr-2 text-xs text-slate-600">{r.numero_chamado || '—'}</td><td className="text-xs font-semibold text-red-600">{txt}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-navy">Funil do processo</h3>
          <div className="space-y-2">
            {FASE_INFO.map((f, i) => { const n = por(f.k).length; const acum = FASES.slice(i).reduce((s, k) => s + por(k).length, 0); return (
              <div key={f.k}>
                <div className="flex items-center justify-between text-sm"><span className="font-semibold" style={{ color: f.cor }}>{f.icon} {f.label}</span><span className="text-slate-600"><b>{n}</b> <span className="text-xs text-slate-400">· {pct(acum, total)}% chegaram até aqui</span></span></div>
                <div className="mt-0.5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct(n, total)}%`, background: f.cor, minWidth: n ? 6 : 0 }} /></div>
              </div>
            ) })}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-bold text-navy">Ritmo mensal</h3>
            <select aria-label="Período do ritmo mensal" className={inp + ' !w-auto !py-1 text-xs'} value={meses} onChange={(e) => setMeses(+e.target.value)}><option value={3}>3 meses</option><option value={6}>6 meses</option><option value={12}>12 meses</option></select>
          </div>
          <div className="flex h-64 items-end gap-3" role="img" aria-label="Ideias, chamados abertos e melhorias em produção por mês">
            {serie.map((s) => (
              <div key={s.k} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-52 w-full items-end justify-center gap-1">
                  {[[s.ideias, FASE_INFO[0].cor, 'ideias registradas'], [s.cham, FASE_INFO[3].cor, 'chamados abertos'], [s.apl, FASE_INFO[6].cor, 'em produção']].map(([v, c, t]) => (
                    <div key={t as string} title={`${v} ${t}`} className="flex h-full w-1/3 max-w-[34px] flex-col items-center justify-end"><span className="text-xs font-semibold text-slate-600">{(v as number) || ''}</span><div className="w-full rounded-t" style={{ height: `${((v as number) / maxS) * 100}%`, minHeight: (v as number) ? 3 : 0, background: c as string }} /></div>
                  ))}
                </div>
                <span className="text-xs font-medium text-slate-600">{s.l}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: FASE_INFO[0].cor }} />Ideias registradas</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: FASE_INFO[3].cor }} />Chamados abertos</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: FASE_INFO[6].cor }} />Em produção</span><span className="ml-auto font-semibold text-slate-600">{aplicNoPeriodo} em produção no período</span></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-1 font-bold text-navy">Tempo médio em cada etapa</h3>
          <p className="mb-2 text-xs text-slate-500">Dias entre as datas registradas (só entram melhorias com as duas datas preenchidas).</p>
          <table className="w-full text-sm"><tbody>
            {tempos.map((t) => <tr key={t.l} className="border-t border-slate-100"><td className="py-1.5 pr-2 text-slate-600">{t.l}</td><td className="py-1.5 text-right font-bold text-navy">{t.m === null ? '—' : `${t.m} dias`}</td><td className="w-14 py-1.5 text-right text-[11px] text-slate-400">{t.n ? `n=${t.n}` : ''}</td></tr>)}
            <tr className="border-t-2 border-slate-200"><td className="py-1.5 pr-2 font-semibold text-navy">Ciclo completo (ideia → produção)</td><td className="py-1.5 text-right font-bold text-emerald-700">{ciclo.m === null ? '—' : `${ciclo.m} dias`}</td><td className="w-14 py-1.5 text-right text-[11px] text-slate-400">{ciclo.n ? `n=${ciclo.n}` : ''}</td></tr>
          </tbody></table>
        </Card>

        <Card>
          <h3 className="mb-2 font-bold text-navy">Por módulo</h3>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {mods.map((m) => (
              <div key={m.m}>
                <div className="flex items-center justify-between text-xs"><span className="truncate font-semibold text-slate-700">{m.m}</span><span className="whitespace-nowrap text-slate-500">{m.n} · {m.apl} em produção{m.atr ? <b className="ml-1 text-red-600">· {m.atr} vencida(s)</b> : null}</span></div>
                <div className="mt-0.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100" title={FASE_INFO.map((f, i) => `${f.label}: ${m.f[i]}`).join(' · ')}>
                  {m.f.map((n, i) => n ? <div key={i} style={{ width: `${pct(n, m.n)}%`, background: FASE_INFO[i].cor }} /> : null)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">{FASE_INFO.map((f) => <span key={f.k}><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: f.cor }} />{f.curto}</span>)}</div>
        </Card>
      </div>

      <Card>
        <h3 className="mb-2 font-bold text-navy">🛠️ Em desenvolvimento / homologação agora ({dev.length})</h3>
        {dev.length === 0 ? <p className="text-sm text-slate-500">Nenhuma melhoria em desenvolvimento.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2">Melhoria</th><th className="pr-2">Módulo</th><th className="pr-2">Etapa</th><th className="pr-2">Responsável</th><th className="w-36 pr-2">Andamento</th><th className="pr-2">Chamado</th><th>Prazo</th></tr></thead>
            <tbody>{devOrd.map((r) => { const v = vencida(r, hoje); return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-2"><button className="text-left font-semibold text-navy hover:underline" onClick={() => onAbrir(r.id)}>{r.melhoria}</button></td>
                <td className="pr-2 text-xs text-slate-600">{r.modulo}</td><td className="pr-2 text-xs font-semibold" style={{ color: faseInfo(fase(r)).cor }}>{faseInfo(fase(r)).label}</td><td className={'pr-2 text-xs ' + (r.responsavel_id ? 'text-slate-600' : 'font-semibold text-amber-600')}>{nomeResp(r) || 'sem responsável'}</td>
                <td className="pr-2"><div className="flex items-center gap-2"><div className="flex-1"><Bar pct={pctDaFase(fase(r))} color={faseInfo(fase(r)).cor} /></div><span className="text-xs font-semibold">{pctDaFase(fase(r))}%</span></div></td>
                <td className="pr-2 text-xs text-slate-600">{r.numero_chamado || '—'}</td>
                <td className={'whitespace-nowrap text-xs font-semibold ' + (v ? 'text-red-600' : !r.data_termino ? 'text-amber-600' : 'text-slate-700')}>{v ? '⚠ ' : ''}{r.data_termino ? fmtDate(r.data_termino) : 'sem prazo'}</td>
              </tr>) })}</tbody>
          </table></div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 font-bold text-navy">⏱ SLA das etapas</h3>
        <p className="mb-2 text-xs text-slate-500">Cada melhoria tem o seu SLA (padrão: chamado aberto → desenvolvimento em 3 dias úteis; desenvolvimento → homologação em 15 dias corridos; feriados cadastrados são descontados).</p>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {([['🎫 Chamado → Desenvolvimento', cumprCham], ['🛠️ Desenvolvimento → Homologação', cumprDev]] as [string, { n: number; ok: number }][]).map(([l, c]) => (
            <div key={l} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="text-xs text-slate-500">{l} — cumprimento nas etapas já concluídas</div><div className="text-xl font-extrabold text-navy">{c.n ? `${pct(c.ok, c.n)}%` : '—'} <span className="text-xs font-normal text-slate-500">{c.n ? `(${c.ok} de ${c.n} dentro do SLA)` : '(sem dados)'}</span></div></div>
          ))}
        </div>
        {slaVenc.length === 0 ? <p className="text-sm text-emerald-700">Nenhuma melhoria com SLA vencido agora.</p> : (
          <ul className="space-y-1.5">{slaVenc.map(({ r, s }) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><button className="font-semibold text-navy hover:underline" onClick={() => onAbrir(r.id)}>{r.melhoria}</button> <span className="text-xs text-slate-500">· {r.modulo} · {faseInfo(fase(r)).label} · {nomeResp(r) || 'sem responsável'}</span></span><span className="text-xs font-semibold text-red-600">{s.txt} (venceu em {fmtDate(s.venc)})</span></li>
          ))}</ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-bold text-navy">👤 Por responsável</h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2">Responsável</th><th className="pr-2 text-right">Total</th><th className="pr-2 text-right">Abertas</th><th className="pr-2 text-right">Em desenv./homolog.</th><th className="pr-2 text-right">Em produção</th><th className="text-right">Prazo vencido</th></tr></thead>
          <tbody>{resps.map((r) => (
            <tr key={r.id || 'sem'} className="border-t border-slate-100"><td className={'py-1.5 pr-2 font-semibold ' + (r.id ? 'text-navy' : 'text-amber-600')}>{r.nome}</td><td className="pr-2 text-right">{r.n}</td><td className="pr-2 text-right">{r.ab}</td><td className="pr-2 text-right">{r.dev}</td><td className="pr-2 text-right text-emerald-700">{r.prod}</td><td className={'text-right ' + (r.atr ? 'font-bold text-red-600' : 'text-slate-400')}>{r.atr}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {([
          ['🗳️ Aguardando abertura de chamado', aguardandoChamado, (r: Melhoria) => `${faseInfo(fase(r)).label} desde ${fmtDate(dataDaFase(r, fase(r)))} · espera ${nomeDias(dataDaFase(r, fase(r)))}`],
          ['🎫 Chamado aberto aguardando desenvolvimento', aguardandoDev, (r: Melhoria) => `chamado ${r.numero_chamado || ''} em ${fmtDate(r.data_abertura)} · espera ${nomeDias(r.data_abertura)}`],
          ['✅ Últimas em produção', ultimasAplicadas, (r: Melhoria) => `em produção desde ${fmtDate(r.data_conclusao)}`],
        ] as [string, Melhoria[], (r: Melhoria) => string][]).map(([t, l, f]) => (
          <Card key={t}>
            <h3 className="mb-2 font-bold text-navy">{t} <span className="text-sm font-normal text-slate-500">({l.length})</span></h3>
            {l.length === 0 ? <p className="text-sm text-slate-500">Nada por aqui.</p> : <ul className="space-y-2">{l.slice(0, 5).map((r) => (
              <li key={r.id} className="text-sm"><button className="text-left font-semibold text-navy hover:underline" onClick={() => onAbrir(r.id)}>{r.melhoria}</button><div className="text-[11px] text-slate-500">{r.modulo} · prioridade {r.prioridade} · {nomeResp(r) || 'sem responsável'} · {f(r)}</div></li>
            ))}</ul>}
            {l.length > 5 && <p className="mt-2 text-[11px] text-slate-400">+ {l.length - 5} na etapa (veja no quadro)</p>}
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Etapa de cada melhoria: {FASE_INFO.map((f) => `${f.icon} ${faseInfo(f.k).label}`).join(' → ')}. Datas e tempos dependem do preenchimento das etapas.</p>
    </div>
  )
}
