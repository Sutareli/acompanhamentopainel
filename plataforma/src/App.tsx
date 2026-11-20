import { useState } from 'react'
import { useFeriados } from './lib/feriados'
import { ConfirmHost } from './components/Confirm'
import { LogoHorizontal, LogoIcone } from './components/Logo'
import { useAuth } from './auth/AuthContext'
import { Login, SetPassword } from './auth/Login'
import { configured } from './lib/supabase'
import { btnG, Card, Msg } from './components/ui'
import Painel from './pages/Painel'
import Melhorias from './pages/Melhorias'
import Atas from './pages/Atas'
import Imprevistos from './pages/Imprevistos'
import Ideias from './pages/Ideias'
import Microentregas from './pages/Microentregas'
import Historico from './pages/Historico'
import Configuracoes from './pages/Configuracoes'
import Equipe from './pages/Equipe'
import Backlog from './pages/Backlog'
import ParetoBacklog from './pages/ParetoBacklog'
import ImportarBases from './pages/ImportarBases'
import Lixeira from './pages/Lixeira'
import Seguranca from './pages/Seguranca'
import Atencao from './pages/Atencao'
import Semanal from './pages/Semanal'
import { AvisoCapacidade } from './components/AvisoCapacidade'
import { canAdmin, canViewAll, PERFIL_LABEL } from './lib/rules'

const ITEMS: [string, string, string][] = [
  ['painel', '', 'To do diário'], ['micro', '', 'Projetos e atividades'], ['ideias', '', 'Ideias'], ['historico', '', 'Histórico'],
  ['atas', '', 'Atas importantes'], ['lixeira', '', 'Lixeira'], ['config', '', 'Configurações'],
]
/** Ordem do menu: itens pessoais → equipe → backlog → Importar bases (só Analista Sr). O botão Segurança fica sozinho no rodapé. Imprevistos abre por um botão no Painel. */
const IMPORT_ITEM: [string, string, string][] = [['importar', '', 'Importar bases']]   // só Analista Sr
const BACKLOG_ITEMS: [string, string, string][] = [['melhorias', '', 'Melhorias'], ['backlog', '', 'Correção/manutenção'], ['pareto', '', 'Análise de chamados']]

/** Agrupa o menu: uma folga entre grupos (rotina pessoal · equipe · chamados e melhorias · administração). */
const grupoMenu = (k: string) => (['atencao'].includes(k) ? 0 : ['equipe', 'semanal'].includes(k) ? 2 : ['melhorias', 'backlog', 'pareto'].includes(k) ? 3 : k === 'importar' ? 4 : 1)

export default function App() {
  const { session, profile, loading, authError, needsPassword, signOut } = useAuth()
  const [pg, setPage] = useState<string | null>(null)   // null = tela inicial do perfil (viewers: Atenção · demais: To do diário)
  useFeriados(!!profile)   // carrega os feriados do SLA e re-renderiza quando chegam

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
  const page = pg ?? (viewer ? 'atencao' : 'painel')
  const items: [string, string, string][] = viewer
    ? [['atencao', '', 'Atenção'], ...ITEMS, ['equipe', '', canAdmin(profile.perfil) ? 'Gestão da equipe' : 'Visão consolidada'], ...(canAdmin(profile.perfil) ? [['semanal', '', 'Semanal Italo'] as [string, string, string]] : []), ...BACKLOG_ITEMS, ...(canAdmin(profile.perfil) ? IMPORT_ITEM : [])]
    : [...ITEMS, ...BACKLOG_ITEMS]
  const pag = page === 'jornadas' ? 'equipe' : page   // 'Jornadas da equipe' agora é um gatilho de análise dentro de Equipe
  const view = (pag === 'equipe' && !viewer) || ((pag === 'importar' || pag === 'seguranca' || pag === 'semanal') && !canAdmin(profile.perfil)) ? 'painel' : pag

  return (
    <div className="min-h-screen">
      <ConfirmHost />
      <aside className="app-menu fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-linha bg-white p-3 md:flex">
        <div className="px-2 py-4"><LogoHorizontal /></div>
        <nav className="flex-1 overflow-y-auto" aria-label="Menu principal">
          {items.map(([k, , l], n) => (
            <button key={k} onClick={() => setPage(k)} aria-current={view === k ? 'page' : undefined}
              className={'flex w-full items-center rounded-md border-l-[3px] px-3 py-2 text-left text-sm ' + (n > 0 && grupoMenu(items[n - 1][0]) !== grupoMenu(k) ? 'mt-3 ' : 'mt-0.5 ') + (view === k ? 'border-turq bg-slate-100 font-semibold text-ink' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-ink')}>
              {l}
            </button>
          ))}
        </nav>
        {canAdmin(profile.perfil) && (
          <button onClick={() => setPage('seguranca')} className={'mb-3 mt-4 w-full rounded-md border px-3 py-2 text-left text-sm ' + (view === 'seguranca' ? 'border-turq bg-slate-100 font-semibold text-ink' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>Segurança</button>
        )}
        <div className="border-t border-linha px-2 pt-3 text-xs text-slate-500">
          <div className="truncate font-semibold text-ink">{profile.nome}</div>
          <div className="mb-2">{PERFIL_LABEL[profile.perfil]}</div>
          <button onClick={signOut} className="underline hover:text-ink">Sair</button>
          <div className="mt-2 text-[10px] opacity-70" title="Identificador da versão publicada (confira se é o último commit do GitHub)">versão {typeof __APP_VERSAO__ === 'string' ? __APP_VERSAO__ : 'dev'}</div>
        </div>
      </aside>

      <header className="app-menu flex items-center justify-between border-b border-linha bg-white px-4 py-2 md:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink"><LogoIcone size={26} />Gestão de atividades</span>
        <span className="flex items-center gap-3 text-xs">{canAdmin(profile.perfil) && <button onClick={() => setPage('seguranca')} className="underline">Segurança</button>}<button onClick={signOut} className="underline">Sair ({profile.nome.split(' ')[0]})</button></span>
      </header>

      <main className="app-main px-3 pb-24 pt-4 md:ml-56 md:px-8 md:pb-10 md:pt-6">
        {canAdmin(profile.perfil) && <AvisoCapacidade />}
        {view === 'atencao' && viewer && <Atencao onNavigate={setPage} />}
        {view === 'painel' && <Painel onNavigate={setPage} />}
        {view === 'atas' && <Atas />}
        {view === 'imprevistos' && <Imprevistos />}
        {view === 'ideias' && <Ideias />}
        {view === 'micro' && <Microentregas />}
        {view === 'melhorias' && <Melhorias />}
        {view === 'backlog' && <Backlog onNavigate={setPage} />}
        {view === 'pareto' && <ParetoBacklog onNavigate={setPage} />}
        {view === 'importar' && canAdmin(profile.perfil) && <ImportarBases onNavigate={setPage} />}
        {view === 'historico' && <Historico />}
        {view === 'lixeira' && <Lixeira />}
        {view === 'seguranca' && canAdmin(profile.perfil) && <Seguranca />}
        {view === 'config' && <Configuracoes />}
        {view === 'equipe' && viewer && <Equipe />}
        {view === 'semanal' && canAdmin(profile.perfil) && <Semanal />}
      </main>

      <nav className="app-menu fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map(([k, , l]) => (
          <button key={k} onClick={() => setPage(k)} className={'flex min-w-[76px] flex-1 flex-col items-center justify-center border-t-2 py-3 text-[11px] ' + (view === k ? 'border-turq font-semibold text-ink' : 'border-transparent text-slate-500')}>
            {l.replace('Gestão da equipe', 'Equipe').replace('Visão consolidada', 'Equipe').replace('Correção/manutenção', 'Correção').replace('Análise de chamados', 'Análise').replace('Importar bases', 'Importar').replace('Semanal Italo', 'Semanal')}
          </button>
        ))}
      </nav>
    </div>
  )
}
