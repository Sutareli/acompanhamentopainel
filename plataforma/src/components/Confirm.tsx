import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { btnG, btnP } from './ui'

/** Confirmação própria da plataforma (substitui o window.confirm do navegador).
 *  Uso:  if (await confirmar({ titulo: 'Excluir ideia?', mensagem: '…', confirmar: 'Excluir', perigo: true })) { … }
 *  O <ConfirmHost /> fica montado uma vez no App. */
export interface ConfirmOpts { titulo?: string; mensagem: ReactNode; confirmar?: string; cancelar?: string; perigo?: boolean }
type Abrir = (o: ConfirmOpts, r: (v: boolean) => void) => void
let abrir: Abrir | null = null

export function confirmar(o: string | ConfirmOpts): Promise<boolean> {
  const op: ConfirmOpts = typeof o === 'string' ? { mensagem: o } : o
  return new Promise((res) => {
    if (abrir) abrir(op, res)
    else res(window.confirm(typeof op.mensagem === 'string' ? op.mensagem : op.titulo || 'Confirmar?'))   // só se o host não estiver montado
  })
}

export function ConfirmHost() {
  const [cur, setCur] = useState<{ o: ConfirmOpts; r: (v: boolean) => void } | null>(null)
  const fila = useRef<{ o: ConfirmOpts; r: (v: boolean) => void }[]>([])
  const antes = useRef<HTMLElement | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    abrir = (o, r) => { if (cur) fila.current.push({ o, r }); else { antes.current = document.activeElement as HTMLElement | null; setCur({ o, r }) } }
    return () => { abrir = null }
  })
  const fechar = useCallback((v: boolean) => {
    setCur((c) => { c?.r(v); return null })
    setTimeout(() => {
      const n = fila.current.shift()
      if (n) { setCur(n) } else antes.current?.focus?.()
    }, 0)
  }, [])

  useEffect(() => {
    if (!cur) return
    btnRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false) }
      if (e.key === 'Tab') {   // mantém o foco dentro da janela
        const els = Array.from(document.querySelectorAll<HTMLElement>('[data-confirm] button'))
        if (!els.length) return
        const i = els.indexOf(document.activeElement as HTMLElement)
        e.preventDefault(); els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [cur, fechar])

  if (!cur) return null
  const { o } = cur
  const perigo = !!o.perigo
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && fechar(false)}>
      <div data-confirm role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-m" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-violet-100">
        <div className="flex items-start gap-4">
          <div className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ' + (perigo ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-violet-700')} aria-hidden="true">{perigo ? '🗑️' : '❔'}</div>
          <div className="min-w-0">
            <h3 id="cf-t" className="text-lg font-bold text-navy">{o.titulo || 'Confirmar ação'}</h3>
            <div id="cf-m" className="mt-1 text-sm leading-relaxed text-slate-600">{o.mensagem}</div>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={perigo ? btnRef : undefined} className={btnG} onClick={() => fechar(false)}>{o.cancelar || 'Cancelar'}</button>
          <button ref={perigo ? undefined : btnRef} className={btnP + (perigo ? ' !bg-red-600 hover:!bg-red-700' : '')} onClick={() => fechar(true)}>{o.confirmar || 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
