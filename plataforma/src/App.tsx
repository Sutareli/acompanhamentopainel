import { useState } from 'react'
import { ConfirmHost } from './components/Confirm'
import { LogoHorizontal, LogoIcone } from './components/Logo'
import { useAuth } from './auth/AuthContext'
import { Login, SetPassword } from './auth/Login'
import { configured } from './lib/supabase'
import { btnG, Card, Msg } from './components/ui'
import Painel from './pages/Painel'
import Atas from './pages/Atas'
import Imprevistos from './pages/Imprevistos'
import Ideias from './pages/Ideias'
import Microentregas from './pages/Microentregas'
import Historico from './pages/Historico'
import Configuracoes from './pages/Configuracoes'
import Equipe from './pages/Equipe'
import Jornadas from './pages/Jornadas'
import Backlog from './pages/Backlog'
import ParetoBacklog from './pages/ParetoBacklog'
import ImportarBases from './pages/ImportarBases'
import Lixeira from './pages/Lixeira'
import Seguranca from './pages/Seguranca'
import { AvisoCapacidade } from './components/AvisoCapacidade'
import { canAdmin, canViewAll, PERFIL_LABEL } from './lib/rules'

const ITEMS: [string, string, string][] = [
  ['painel', '🏠', 'Painel'], ['micro', '📦', 'Projetos'], ['ideias', '💡', 'Ideias'], ['historico', '🕘', 'Histórico'],
  ['atas', '📝', 'Atas importantes'], ['lixeira', '🗑️', 'Lixeira'], ['config', '⚙️', 'Configurações'],
]
/** Ordem do menu: itens pessoais → equipe → backlog → Importar bases (só Analista Sr). O botão Segurança fica sozinho no rodapé. Imprevistos abre por um botão no Painel. */
const IMPORT_ITEM: [string, string, string][] = [['importar', '⬆️', 'Importar bases']]   // só Analista Sr
const BACKLOG_ITEMS: [string, string, string][] = [['backlog', '🧭', 'Backlog de Melhorias'], ['pareto', '📊', 'Pareto backlog']]

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
    ? [...ITEMS, ['equipe', '👥', canAdmin(profile.perfil) ? 'Gestão da equipe' : 'Visão consolidada'], ['jornadas', '👀', 'Jornadas da equipe'], ...BACKLOG_ITEMS, ...(canAdmin(profile.perfil) ? IMPORT_ITEM : [])]
    : [...ITEMS, ...BACKLOG_ITEMS]
  const view = ((page === 'equipe' || page === 'jornadas') && !viewer) || ((page === 'importar' || page === 'seguranca') && !canAdmin(profile.perfil)) ? 'painel' : page

  return (
    <div className="min-h-screen">
      <ConfirmHost />
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-navy p-3 text-white md:flex">
        <div className="px-2 py-4"><LogoHorizontal /></div>
        <nav className="flex-1 space-y-1">
          {items.map(([k, i, l]) => (
            <button key={k} onClick={() => setPage(k)} className={'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ' + (view === k ? 'bg-violet-700' : 'text-violet-100 hover:bg-violet-900')}>
              <span>{i}</span>{l}
            </button>
          ))}
        </nav>
        {canAdmin(profile.perfil) && (
          <button onClick={() => setPage('seguranca')} className={'mb-3 mt-6 flex w-full items-center gap-2 rounded-lg border border-violet-800 px-3 py-2 text-left text-xs ' + (view === 'seguranca' ? 'bg-violet-700' : 'text-violet-200 hover:bg-violet-900')}><span>🛡️</span>Segurança</button>
        )}
        <div className="border-t border-violet-900 px-2 pt-3 text-xs text-violet-200">
          <div className="truncate font-semibold text-white">{profile.nome}</div>
          <div className="mb-2">{PERFIL_LABEL[profile.perfil]}</div>
          <button onClick={signOut} className="underline">Sair</button>
        </div>
      </aside>

      <header className="flex items-center justify-between bg-navy px-4 py-2 text-white md:hidden">
        <span className="flex items-center gap-2 text-sm font-bold"><LogoIcone size={26} />Gestão de atividades</span>
        <span className="flex items-center gap-3">{canAdmin(profile.perfil) && <button onClick={() => setPage('seguranca')} aria-label="Segurança" className="text-lg">🛡️</button>}<button onClick={signOut} className="text-xs underline">Sair ({profile.nome.split(' ')[0]})</button></span>
      </header>

      <main className="px-3 pb-24 pt-4 md:ml-56 md:px-8 md:pb-10 md:pt-6">
        {canAdmin(profile.perfil) && <AvisoCapacidade />}
        {view === 'painel' && <Painel onNavigate={setPage} />}
        {view === 'atas' && <Atas />}
        {view === 'imprevistos' && <Imprevistos />}
        {view === 'ideias' && <Ideias />}
        {view === 'micro' && <Microentregas />}
        {view === 'backlog' && <Backlog onNavigate={setPage} />}
        {view === 'pareto' && <ParetoBacklog onNavigate={setPage} />}
        {view === 'importar' && canAdmin(profile.perfil) && <ImportarBases onNavigate={setPage} />}
        {view === 'historico' && <Historico />}
        {view === 'lixeira' && <Lixeira />}
        {view === 'seguranca' && canAdmin(profile.perfil) && <Seguranca />}
        {view === 'config' && <Configuracoes />}
        {view === 'jornadas' && viewer && <Jornadas />}
        {view === 'equipe' && viewer && <Equipe />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map(([k, i, l]) => (
          <button key={k} onClick={() => setPage(k)} className={'flex min-w-[76px] flex-1 flex-col items-center py-2 text-[11px] ' + (view === k ? 'font-bold text-navy' : 'text-slate-500')}>
            <span className="text-lg">{i}</span>{l.replace('Gestão da equipe', 'Equipe').replace('Visão consolidada', 'Equipe').replace('Jornadas da equipe', 'Jornadas').replace('Backlog de Melhorias', 'Backlog').replace('Pareto backlog', 'Pareto').replace('Importar bases', 'Importar')}
          </button>
        ))}
      </nav>
    </div>
  )
}
