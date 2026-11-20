import { useMemo, useState } from 'react'
import { btnG, btnSm, Empty, Modal } from './ui'
import { Chamado, noPrazo, statusNome } from '../lib/chamados'
import { download, fmtDate, toCSV } from '../lib/rules'

/** Lista de chamados que compõem um número do painel (clique num card ou numa barra). Com busca e exportação. */
export default function ListaChamadosModal({ titulo, itens, onClose }: { titulo: string; itens: Chamado[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const vis = useMemo(() => {
    const t = q.trim().toLowerCase()
    const l = !t ? itens : itens.filter((c) => [c.id_chamado, c.item_sintoma, c.cliente, c.tipo, c.subcategoria, c.sistema_ofensor, c.responsavel, c.empresa_responsavel].some((v) => (v || '').toLowerCase().includes(t)))
    return [...l].sort((a, b) => (b.data_ref || '').localeCompare(a.data_ref || ''))
  }, [itens, q])
  const exporta = () => download('chamados-' + titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv', toCSV([
    ['ID', 'Data ref.', 'Item - sintoma', 'Cliente', 'Tipo', 'Categoria', 'Subcategoria', 'Sistema ofensor', 'Status', 'Prazo', 'Reincidente', 'Empresa responsável', 'Responsável'],
    ...vis.map((c) => [c.id_chamado, fmtDate(c.data_ref), c.item_sintoma, c.cliente, c.tipo, c.categoria, c.subcategoria, c.sistema_ofensor, c.status, c.prazo, c.reincidente === true ? 'Sim' : c.reincidente === false ? 'Não' : '', c.empresa_responsavel, c.responsavel]),
  ]))
  return (
    <Modal title={`${titulo} (${itens.length})`} onClose={onClose} xl>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="min-w-[220px] flex-1 rounded-lg border border-violet-300 px-3 py-1.5 text-sm" placeholder="Buscar por ID, item, cliente, tipo…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar nos chamados" />
        <span className="text-xs text-slate-500">{vis.length} exibido(s)</span>
        <button className={btnG + ' ' + btnSm} onClick={exporta} disabled={!vis.length}>Exportar (CSV)</button>
      </div>
      {vis.length === 0 ? <Empty>Nenhum chamado.</Empty> : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[820px] text-left text-sm [&_th]:pr-2">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">ID</th><th>Data</th><th>Item / sintoma</th><th>Cliente</th><th>Tipo</th><th>Status</th><th>Prazo</th></tr></thead>
            <tbody>
              {vis.slice(0, 300).map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-500">{c.id_chamado || '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-2">{fmtDate(c.data_ref)}</td>
                  <td className="max-w-[360px] py-2 pr-2 font-medium text-navy">{c.item_sintoma || '—'}</td>
                  <td className="py-2 pr-2">{c.cliente || '—'}</td>
                  <td className="py-2 pr-2">{c.tipo || '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-2">{statusNome(c)}</td>
                  <td className={'whitespace-nowrap py-2 pr-2 font-semibold ' + (noPrazo(c) ? 'text-green-700' : c.prazo ? 'text-red-600' : 'text-slate-400')}>{c.prazo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {vis.length > 300 && <p className="p-3 text-center text-xs text-slate-500">Mostrando os 300 primeiros. Use “Exportar (CSV)” para ver todos.</p>}
        </div>
      )}
    </Modal>
  )
}
