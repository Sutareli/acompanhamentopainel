import { ReactNode } from 'react'

export const inp = 'w-full rounded-2xl border border-violet-400 bg-[#e8effd] px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-turq'
const btn = 'rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-50 '
export const btnP = btn + 'bg-turq text-white hover:opacity-90'
export const btnS = btn + 'bg-navy text-white hover:opacity-90'
export const btnG = btn + 'border border-violet-300 bg-white text-navy hover:bg-violet-50'
export const btnD = btn + 'bg-red-600 text-white hover:opacity-90'
export const btnSm = '!px-3 !py-1.5 !text-xs'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'rounded-3xl border border-violet-100 bg-white p-5 shadow-sm ' + className}>{children}</div>
}
export function Chip({ children, color }: { children: ReactNode; color: string }) {
  return <span style={{ background: color }} className="inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold text-white">{children}</span>
}
export function Bar({ pct, color = '#8b3fff' }: { pct: number; color?: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full transition-all" style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: color }} />
    </div>
  )
}
export function StackBar({ parts }: { parts: { v: number; c: string }[] }) {
  const t = parts.reduce((a, p) => a + p.v, 0) || 1
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      {parts.map((p, i) => <div key={i} style={{ width: (p.v / t) * 100 + '%', background: p.c }} />)}
    </div>
  )
}
export function Msg({ kind, children }: { kind: 'erro' | 'ok' | 'aviso'; children: ReactNode }) {
  const c = kind === 'erro' ? 'bg-red-50 text-red-800 border-red-200' : kind === 'ok' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-900 border-amber-200'
  return <div role={kind === 'erro' ? 'alert' : 'status'} className={'mb-3 rounded-xl border px-4 py-2.5 text-sm ' + c}>{children}</div>
}
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={'block text-sm ' + className}><span className="mb-1 block font-medium text-slate-600">{label}</span>{children}</label>
}
export function Kpi({ label, value, sub, icon, color = '#2e1a6e', pct }: { label: string; value: ReactNode; sub?: string; icon: string; color?: string; pct?: number }) {
  return (
    <Card className="relative !p-4">
      <span className="absolute right-4 top-3 text-2xl">{icon}</span>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold" style={{ color }}>{value}</div>
      {pct !== undefined && <div className="mt-2"><Bar pct={pct} color={color} /></div>}
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{children}</p>
}
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ' + (wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-navy">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Fechar">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
export function HBars({ rows, empty = 'Sem registros.' }: { rows: { label: string; value: number; color?: string }[]; empty?: string }) {
  if (!rows.length || rows.every((r) => r.value === 0)) return <Empty>{empty}</Empty>
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-slate-600 sm:w-36" title={r.label}>{r.label}</span>
          <div className="h-4 flex-1 rounded-full bg-slate-100"><div className="h-4 rounded-full" style={{ width: (r.value / max) * 100 + '%', background: r.color || '#8b3fff' }} /></div>
          <b className="w-9 text-right">{r.value}</b>
        </div>
      ))}
    </div>
  )
}
export function VBars({ rows, unit = '' }: { rows: { label: string; value: number | null; color?: string; title?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0))
  return (
    <div className="flex h-44 items-end gap-1 overflow-x-auto pt-4">
      {rows.map((r, i) => (
        <div key={i} title={r.title || r.label} className="flex h-full min-w-[22px] flex-1 flex-col items-center justify-end text-[10px] text-slate-500">
          <span>{r.value === null ? '—' : r.value + unit}</span>
          <div className="w-full rounded-t" style={{ height: r.value === null ? '2px' : Math.max(3, (r.value / max) * 100) + '%', background: r.value === null ? '#e2e8f0' : r.color || '#8b3fff' }} />
          <span className="mt-1 whitespace-nowrap">{r.label}</span>
        </div>
      ))}
    </div>
  )
}
