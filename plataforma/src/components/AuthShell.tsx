import { ReactNode, useState } from 'react'

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

/** Emblema próprio (lista de tarefas). Se existir /logo.png no site, ele é usado no lugar. */
function Emblem() {
  const [custom, setCustom] = useState(true)
  if (custom) return <img src="/logo.png" alt="" className="mx-auto mb-4 h-36 w-auto object-contain" onError={() => setCustom(false)} />
  return (
    <svg aria-hidden="true" viewBox="0 0 120 120" className="mx-auto mb-4 h-28 w-28">
      <defs><linearGradient id="em" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#8b3fff" /><stop offset="1" stopColor="#2e1a6e" /></linearGradient></defs>
      <rect x="14" y="14" width="92" height="92" rx="28" fill="url(#em)" />
      <rect x="34" y="34" width="14" height="14" rx="4" fill="#fff" /><rect x="56" y="38" width="30" height="6" rx="3" fill="#fff" opacity=".9" />
      <rect x="34" y="53" width="14" height="14" rx="4" fill="#a5e3fb" /><rect x="56" y="57" width="30" height="6" rx="3" fill="#fff" opacity=".9" />
      <rect x="34" y="72" width="14" height="14" rx="4" fill="#fff" opacity=".6" /><rect x="56" y="76" width="22" height="6" rx="3" fill="#fff" opacity=".6" />
    </svg>
  )
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
