import { useMemo, useState } from 'react'
import { btnD, btnG, btnP, btnSm, inp, Modal, Msg } from './ui'
import { Melhoria } from '../lib/backlog'

/** Janela para organizar a fila de ideias: arrastar, digitar a posição, ou mandar para o topo/fim. */
export default function OrganizarFila({ ideias, nomeResp, onClose, onSave, onExcluir }: {
  ideias: Melhoria[]; nomeResp: (m: Melhoria) => string | null; onClose: () => void; onSave: (ids: string[]) => Promise<string>; onExcluir: (m: Melhoria) => Promise<boolean>
}) {
  const original = useMemo(() => ideias.map((m) => m.id), [ideias])
  const [idsBrutos, setIds] = useState<string[]>(original)
  const [q, setQ] = useState('')
  const [arrasta, setArrasta] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const porId = useMemo(() => new Map(ideias.map((m) => [m.id, m])), [ideias])
  const ids = idsBrutos.filter((id) => porId.has(id))   // ideias excluídas saem da lista
  const mudou = ids.length === original.length && ids.some((id, i) => id !== original[i])

  const mover = (id: string, para: number) => setIds((bruto) => {
    const cur = bruto.filter((x) => porId.has(x)); const i = cur.indexOf(id); const j = Math.min(Math.max(para, 0), cur.length - 1)
    if (i < 0 || i === j) return cur
    const n = cur.slice(); n.splice(i, 1); n.splice(j, 0, id); return n
  })
  const t = q.trim().toLowerCase()
  const visivel = (id: string) => { const m = porId.get(id)!; return !t || [m.melhoria, m.modulo, nomeResp(m)].join(' ').toLowerCase().includes(t) }

  async function excluir(m: Melhoria) { await onExcluir(m) }
  async function salvar() {
    setBusy(true); setErr('')
    const r = await onSave(ids)
    if (r) { setErr(r); setBusy(false) }
  }
  return (
    <Modal title="Organizar fila de ideias" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-600">
        A ideia <b>#1</b> é a próxima a ser priorizada. <b>Arraste</b> pela alça ⠿, <b>digite o número</b> da posição e tecle Enter, ou use <b>Topo</b> / <b>Fim</b>. Nada é gravado até você clicar em <b>Salvar fila</b>.
      </p>
      {err && <Msg kind="erro">{err}</Msg>}
      <input className={inp + ' mb-2'} placeholder="Buscar ideia, módulo ou responsável…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na fila" />
      <ol className="max-h-[55vh] space-y-1 overflow-y-auto rounded-md bg-slate-50 p-2" aria-label="Fila de ideias">
        {ids.map((id, i) => { if (!visivel(id)) return null; const m = porId.get(id)!; const mudouPos = original.indexOf(id) !== i
          return (
            <li key={id} draggable onDragStart={(e) => { setArrasta(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
              onDragOver={(e) => { if (arrasta) { e.preventDefault(); setSobre(id) } }}
              onDrop={(e) => { e.preventDefault(); if (arrasta && arrasta !== id) mover(arrasta, i); setArrasta(null); setSobre(null) }}
              onDragEnd={() => { setArrasta(null); setSobre(null) }}
              className={'flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 ' + (sobre === id && arrasta && arrasta !== id ? 'border-t-4 border-t-indigo-500 ' : 'border-slate-200 ') + (arrasta === id ? 'opacity-40 ' : '') + (mudouPos ? 'bg-amber-50' : '')}>
              <span className="cursor-grab select-none px-1 text-lg leading-none text-slate-400" aria-hidden title="Arraste para mudar a posição">⠿</span>
              <input key={i} type="number" min={1} max={ids.length} defaultValue={i + 1} aria-label={`Posição de ${m.melhoria}`}
                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-center text-sm font-bold text-navy"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); mover(id, (Number((e.target as HTMLInputElement).value) || i + 1) - 1) } }}
                onBlur={(e) => { const v = Number(e.target.value); if (v && v !== i + 1) mover(id, v - 1) }} />
              <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-700">{m.modulo}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy" title={m.melhoria}>{m.melhoria}</span>
              <span className="hidden text-xs text-slate-500 sm:inline">{nomeResp(m) || 'sem responsável'}</span>
              <button type="button" className={btnG + ' ' + btnSm} onClick={() => mover(id, 0)} disabled={i === 0}>Topo</button>
              <button type="button" className={btnG + ' ' + btnSm} onClick={() => mover(id, ids.length - 1)} disabled={i === ids.length - 1}>Fim</button>
              <button type="button" className={btnD + ' ' + btnSm} onClick={() => excluir(m)} aria-label={`Excluir ${m.melhoria}`} title="Excluir esta melhoria (vai para a Lixeira por 48 horas)">Excluir</button>
            </li>
          ) })}
      </ol>
      <div className="mt-4 flex items-center justify-end gap-2">
        {mudou && <button type="button" className={btnG} onClick={() => setIds(original)}>Desfazer mudanças</button>}
        <button type="button" className={btnG} onClick={onClose}>Cancelar</button>
        <button type="button" className={btnP} disabled={!mudou || busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar fila'}</button>
      </div>
    </Modal>
  )
}
