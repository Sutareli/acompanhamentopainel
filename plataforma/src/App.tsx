import { useState } from 'react'
import { useAuth } from './auth/AuthContext'
import { Login, SetPassword } from './auth/Login'
import { configured } from './lib/supabase'
import { btnG, Card, Msg } from './components/ui'
import Painel from './pages/Painel'
import Agenda from './pages/Agenda'
import Ideias from './pages/Ideias'
import Microentregas from './pages/Microentregas'
import Historico from './pages/Historico'
import Configuracoes from './pages/Configuracoes'
import Equipe from './pages/Equipe'
import Jornadas from './pages/Jornadas'
import { canAdmin, canViewAll, PERFIL_LABEL } from './lib/rules'

const ITEMS: [string, string, string][] = [
  ['painel', '🏠', 'Painel'], ['agenda', '📅', 'Agenda'], ['ideias', '💡', 'Ideias'],
  ['micro', '📦', 'Microentregas'], ['historico', '🕘', 'Histórico'], ['config', '⚙️', 'Configurações'],
]

export default function App() {
  const { session, profile, loading, authError, needsPassword, signOut } = useAuth()
  const [page, setPage] = useState('painel')

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <Msg kind="aviso">Configuração pendente</Msg>
          <p className="text-sm">Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (arquivo <code>.env.local</code> ou variáveis de ambiente do Cloudflare Pages) e publique novamente.</p>
        </Card>
      </div>
    )
  }
  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-500">Carregando…</div>
  if (!session) return <Login />
  if (needsPassword) return <SetPassword />
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          {authError ? <Msg kind="erro">{authError}</Msg> : <p className="text-slate-500">Carregando perfil…</p>}
          <button className={btnG} onClick={signOut}>Sair</button>
        </Card>
      </div>
    )
  }

  // Perfis com visão de equipe (somente consulta das jornadas + consolidado). A trava real está nas políticas RLS do banco.
  const viewer = canViewAll(profile.perfil)
  const items: [string, string, string][] = viewer
    ? [...ITEMS, ['jornadas', '👀', 'Jornadas da equipe'], ['equipe', '👥', canAdmin(profile.perfil) ? 'Gestão da equipe' : 'Visão consolidada']]
    : ITEMS
  const view = (page === 'equipe' || page === 'jornadas') && !viewer ? 'painel' : page

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-navy p-3 text-white md:flex">
        <div className="px-2 py-4 font-bold leading-tight">Gestão de<br /><span className="text-violet-300">atividades</span></div>
        <nav className="flex-1 space-y-1">
          {items.map(([k, i, l]) => (
            <button key={k} onClick={() => setPage(k)} className={'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' + (view === k ? 'bg-violet-700' : 'text-violet-100 hover:bg-violet-900')}>
              <span>{i}</span>{l}
            </button>
          ))}
        </nav>
        <div className="border-t border-violet-900 px-2 pt-3 text-xs text-violet-200">
          <div className="truncate font-semibold text-white">{profile.nome}</div>
          <div className="mb-2">{PERFIL_LABEL[profile.perfil]}</div>
          <button onClick={signOut} className="underline">Sair</button>
        </div>
      </aside>

      <header className="flex items-center justify-between bg-navy px-4 py-2 text-white md:hidden">
        <span className="text-sm font-bold">Gestão de atividades</span>
        <button onClick={signOut} className="text-xs underline">Sair ({profile.nome.split(' ')[0]})</button>
      </header>

      <main className="px-3 pb-24 pt-4 md:ml-56 md:px-8 md:pb-10 md:pt-6">
        {view === 'painel' && <Painel />}
        {view === 'agenda' && <Agenda />}
        {view === 'ideias' && <Ideias />}
        {view === 'micro' && <Microentregas />}
        {view === 'historico' && <Historico />}
        {view === 'config' && <Configuracoes />}
        {view === 'jornadas' && viewer && <Jornadas />}
        {view === 'equipe' && viewer && <Equipe />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map(([k, i, l]) => (
          <button key={k} onClick={() => setPage(k)} className={'flex min-w-[76px] flex-1 flex-col items-center py-2 text-[11px] ' + (view === k ? 'font-bold text-navy' : 'text-slate-500')}>
            <span className="text-lg">{i}</span>{l.replace('Gestão da equipe', 'Equipe').replace('Visão consolidada', 'Equipe').replace('Jornadas da equipe', 'Jornadas')}
          </button>
        ))}
      </nav>
    </div>
  )
}
