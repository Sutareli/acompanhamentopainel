import { useId } from 'react'

/** Ícone da marca: anel de progresso com “check” (gestão e conclusão de atividades). */
export function LogoIcone({ size = 40, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg role="img" aria-label="Gestão de atividades" viewBox="0 0 64 64" width={size} height={size} className={className}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2e1a6e" /><stop offset="1" stopColor="#8b3fff" /></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#c9a7ff" strokeOpacity=".35" strokeWidth="5" />
      <path d="M32 13 A19 19 0 1 1 13 32" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M23.5 32.5 L30 39 L41.5 25.5" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Logo horizontal para fundo escuro (menu lateral). */
export function LogoHorizontal({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoIcone size={size} />
      <div className="font-bold leading-tight">Gestão<br /><span className="font-semibold text-violet-300">de atividades</span></div>
    </div>
  )
}
