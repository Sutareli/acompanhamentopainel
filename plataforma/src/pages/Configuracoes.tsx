import { ChangeEvent, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from '../lib/settings'
import { fmtDate, fmtMin } from '../lib/rules'
import { Legacy, parseLegacy, runImport } from '../lib/legacyImport'
import { btnG, btnP, btnS, Card, Field, inp, Msg } from '../components/ui'

const F: [keyof Settings, string][] = [['atuacao_min', 'Atuação prática (min)'], ['pausa_min', 'Pausa (min)'], ['reunioes_min', 'Reuniões reservadas (min)'], ['margem_min', 'Margem flexível (min)']]

export default function Configuracoes() {
  const { profile } = useAuth()
  const uid = profile!.id
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [legacy, setLegacy] = useState<Legacy | null>(null)
  const [busy, setBusy] = useState(false)
  const total = s.atuacao_min + s.pausa_min + s.reunioes_min + s.margem_min

  useEffect(() => { loadSettings(uid).then(setS).catch((e) => setErr(e.message)) }, [uid])

  async function save(global: boolean) {
    setErr(''); setOk('')
    if (Object.values(s).some((v) => !Number.isInteger(v) || v < 0)) return setErr('Use apenas números inteiros, sem valores negativos.')
    try { await saveSettings(uid, s, global); setOk(global ? 'Padrão global salvo (vale para quem não tem configuração própria).' : 'Configuração salva.') } catch (e: any) { setErr(e.message) }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setErr(''); setOk(''); setLegacy(null)
    const f = e.target.files?.[0]
    if (!f) return
    try { setLegacy(parseLegacy(JSON.parse(await f.text()))) } catch (x: any) { setErr(x instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : x.message) }
    e.target.value = ''
  }

  async function confirmImport() {
    if (!legacy) return
    setBusy(true); setErr('')
    try {
      const r = await runImport(uid, legacy, true)
      setOk(`Importação concluída: ${r.dias} dia(s) importado(s), ${r.ignorados} já existente(s) preservado(s) sem alteração, ${r.ideias} ideia(s) nova(s)${r.ideiasIgnoradas ? ` (${r.ideiasIgnoradas} já existiam)` : ''}${r.configuracao ? ', configuração de jornada aplicada' : ''}.`)
      setLegacy(null)
    } catch (x: any) { setErr('A importação foi interrompida: ' + x.message + '. Dados já gravados foram mantidos; você pode repetir o processo, pois dias existentes nunca são sobrescritos.') }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Configurações</h1>
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}

      <Card>
        <h3 className="mb-1 font-bold text-navy">Controle da jornada</h3>
        <p className="mb-3 text-sm text-slate-500">Total planejado: <b>{fmtMin(total)}</b> (referência: 9h 48min). A margem flexível nunca é preenchida automaticamente. Alterações valem para os próximos dias; dias já registrados mantêm o snapshot do dia.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {F.map(([k, l]) => <Field key={k} label={l}><input type="number" min={0} className={inp} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /></Field>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={btnP} onClick={() => save(false)}>Salvar</button>
          <button className={btnG} onClick={() => setS(DEFAULT_SETTINGS)}>Restaurar valores originais</button>
          {profile!.perfil === 'gestor' && <button className={btnG} onClick={() => save(true)}>Salvar como padrão global da equipe</button>}
        </div>
        <p className="mt-3 text-xs text-slate-500">Nomes, durações e tarefas dos blocos são editados diretamente no Painel e passam a valer nos dias seguintes.</p>
      </Card>

      <Card>
        <h3 className="mb-1 font-bold text-navy">Importar backup do painel antigo (JSON)</h3>
        <p className="mb-3 text-sm text-slate-500">Selecione o arquivo exportado pelo painel antigo. Nada é apagado nem sobrescrito: dias que já existem aqui são preservados e ideias com o mesmo título são ignoradas. Você verá um resumo antes de confirmar.</p>
        <input type="file" accept=".json,application/json" onChange={onFile} className="text-sm" />
        {legacy && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p><b>{legacy.days.length}</b> dia(s) ({legacy.days.length ? `${fmtDate(legacy.days.map((d) => d.date).sort()[0])} a ${fmtDate(legacy.days.map((d) => d.date).sort().slice(-1)[0])}` : '—'}) · <b>{legacy.ideas.length}</b> ideia(s) · jornada de {fmtMin(legacy.settings.atuacao_min + legacy.settings.pausa_min + legacy.settings.reunioes_min + legacy.settings.margem_min)}</p>
            <p className="mt-1 text-xs text-slate-500">O tempo trabalhado dos dias antigos é guardado como total do dia (o painel antigo não registrava o tempo por bloco no histórico).</p>
            <div className="mt-3 flex gap-2"><button className={btnS} disabled={busy} onClick={confirmImport}>{busy ? 'Importando…' : 'Confirmar importação'}</button><button className={btnG} onClick={() => setLegacy(null)}>Cancelar</button></div>
          </div>
        )}
      </Card>
    </div>
  )
}
