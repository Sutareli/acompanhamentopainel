import { ReactNode } from 'react'
import { LogoIcone } from './Logo'

/** Moldura das telas de entrada: fundo liso, marca pequena e o formulário num cartão simples. */
export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-papel p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3"><LogoIcone size={36} /><span className="text-sm font-medium text-slate-500">Gestão de atividades</span></div>
        <div className="rounded-lg border border-linha bg-white p-6">
          <h1 className="mb-4 text-xl font-semibold text-ink">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}
