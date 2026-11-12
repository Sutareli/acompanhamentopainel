import { ReactNode } from 'react'
import { LogoIcone } from './Logo'

/** Ondas decorativas (linhas finas em degradê lilás → azul-claro), desenhadas em SVG próprio. */
function Waves({ flip = false }: { flip?: boolean }) {
  const lines = Array.from({ length: 16 }, (_, i) => {
    const o = i * 7
    return `M ${-20} ${230 - o} C 120 ${150 - o * 0.4}, 220 ${260 - o * 0.9}, 420 ${120 - o * 0.5}`
  })
  return (
    <svg aria-hidden="true" viewBox="0 0 420 260" style={{ WebkitMaskImage: 'linear-gradient(to right, #000 45%, transparent 100%)', maskImage: 'linear-gradient(to right, #000 45%, transparent 100%)' }} className={'pointer-events-none absolute bottom-0 h-56 w-[26rem] max-w-[60vw] ' + (flip ? 'right-0 -scale-x-100' : 'left-0')}>
      <defs>
        <linearGradient id={'wg' + (flip ? 'b' : 'a')} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#c4b0ff" /><stop offset="1" stopColor="#a5e3fb" />
        </linearGradient>
      </defs>
      {lines.map((d, i) => <path key={i} d={d} fill="none" stroke={`url(#wg${flip ? 'b' : 'a'})`} strokeWidth="1" opacity={0.85 - i * 0.03} />)}
    </svg>
  )
}

function Emblem() {
  return <LogoIcone size={96} className="mx-auto mb-4 drop-shadow-md" />
}

export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-4">
      <Waves /><Waves flip />
      <div className="relative z-10 w-full max-w-sm">
        <Emblem />
        <h1 className="mb-1 text-center text-2xl font-semibold text-navy">{title}</h1>
        <p className="mb-5 text-center text-sm text-violet-400">Gestão de atividades</p>
        {children}
      </div>
    </div>
  )
}
