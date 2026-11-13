import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { canAdmin, fmtDateTime } from '../lib/rules'
import { btnG, btnP, btnSm, Card, Chip, Empty, Msg } from '../components/ui'
import { confirmar } from '../components/Confirm'

/** Lixeira de 48 horas: desfaz exclusões de projetos, atividades/etapas do Backlog, ideias, atas, reuniões antigas e imprevistos (e usuários, para o Analista Sr). */
const TIPO: Record<string, { nome: string; cor: string }> = {
  microdeliveries: { nome: 'Projeto', cor: '#7c3aed' }, backlog_melhorias: { nome: 'Atividade do Backlog', cor: '#2563eb' },
  backlog_etapas: { nome: 'Etapa do Backlog', cor: '#0891b2' }, ideas: { nome: 'Ideia', cor: '#d97706' },
  agenda: { nome: 'Reunião', cor: '#059669' }, imprevistos: { nome: 'Imprevisto', cor: '#dc2626' }, atas: { nome: 'Ata', cor: '#0d9488' },
}
interface Item { id: string; tabela: string; rotulo: string | null; excluido_por: string | null; excluido_em: string; expira_em: string }
interface UserDel { id: string; nome: string; email: string; excluido_em: string }

export function restante(expira: string, agora = Date.now()) {
  const ms = new Date(expira).getTime() - agora
  if (ms <= 0) return 'expirando'
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export default function Lixeira() {
  const { profile } = useAuth()
  const manager = canAdmin(profile!.perfil)
  const [itens, setItens] = useState<Item[]>([])
  const [users, setUsers] = useState<UserDel[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    await supabase.rpc('lixeira_purgar')   // limpa o que passou de 48 h
    const [l, p] = await Promise.all([
      supabase.from('lixeira').select('id,tabela,rotulo,excluido_por,excluido_em,expira_em').order('excluido_em', { ascending: false }),
      supabase.from('profiles').select('id,nome,email,excluido_em'),
    ])
    if (l.error) setErr('Não foi possível carregar a lixeira: ' + l.error.message)
    else setErr('')
    setItens((l.data || []) as Item[])
    const ps = (p.data || []) as (UserDel & { excluido_em: string | null })[]
    setNomes(Object.fromEntries(ps.map((x) => [x.id, x.nome])))
    setUsers(ps.filter((x) => x.excluido_em && Date.now() - new Date(x.excluido_em).getTime() < 48 * 3600000) as UserDel[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function restaurar(i: Item) {
    setErr(''); setOk(''); setBusy(i.id)
    const r = await supabase.rpc('lixeira_restaurar', { p_id: i.id })
    setBusy('')
    if (r.error) return setErr(r.error.message)
    setOk(`“${i.rotulo || TIPO[i.tabela]?.nome}” foi restaurado.`); load()
  }
  async function restaurarUser(u: UserDel) {
    setErr(''); setOk(''); setBusy(u.id)
    const r = await supabase.rpc('usuario_restaurar', { p_id: u.id })
    setBusy('')
    if (r.error) return setErr(r.error.message)
    setOk(`Usuário ${u.nome} restaurado e com acesso liberado.`); load()
  }
  async function esvaziar(i: Item) {
    if (!(await confirmar({ titulo: 'Remover definitivamente?', mensagem: <>Remover <b>“{i.rotulo || TIPO[i.tabela]?.nome}”</b> da lixeira agora? Depois disso não dá mais para restaurar.</>, confirmar: 'Remover definitivamente', perigo: true }))) return
    const r = await supabase.from('lixeira').delete().eq('id', i.id)
    if (r.error) setErr(r.error.message); else load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">🗑️ Lixeira</h1>
        <p className="text-sm text-slate-500">O que você exclui fica aqui por <b>48 horas</b> e pode ser restaurado. Depois disso é removido definitivamente. {manager ? 'Como Analista Sr, você vê as exclusões de todos.' : 'Você vê apenas o que você excluiu.'}</p>
      </div>
      {err && <Msg kind="erro">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      {loading ? <p className="py-10 text-center text-slate-500">Carregando…</p> : (<>
        <Card>
          <h3 className="mb-2 font-bold text-navy">Itens excluídos <span className="text-sm font-normal text-slate-500">({itens.length})</span></h3>
          {itens.length === 0 ? <Empty>A lixeira está vazia.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {itens.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <Chip color={TIPO[i.tabela]?.cor || '#64748b'}>{TIPO[i.tabela]?.nome || i.tabela}</Chip>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-navy">{i.rotulo || '(sem título)'}</div>
                    <div className="text-xs text-slate-500">Excluído em {fmtDateTime(i.excluido_em)}{i.excluido_por && nomes[i.excluido_por] ? ` por ${nomes[i.excluido_por]}` : ''} · <b className="text-amber-700">restam {restante(i.expira_em)}</b></div>
                  </div>
                  <div className="flex gap-2">
                    <button className={btnP + ' ' + btnSm} disabled={busy === i.id} onClick={() => restaurar(i)}>{busy === i.id ? 'Restaurando…' : '↩ Restaurar'}</button>
                    {manager && <button className={btnG + ' ' + btnSm + ' !border-red-200 !text-red-600 hover:!bg-red-50'} onClick={() => esvaziar(i)}>Remover</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manager && (
          <Card>
            <h3 className="mb-2 font-bold text-navy">Usuários excluídos <span className="text-sm font-normal text-slate-500">({users.length})</span></h3>
            <p className="mb-2 text-xs text-slate-500">O acesso fica bloqueado durante as 48 h. Se não for restaurado, o usuário e os dados pessoais dele são apagados definitivamente.</p>
            {users.length === 0 ? <Empty>Nenhum usuário na lixeira.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <Chip color="#475569">Usuário</Chip>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-navy">{u.nome}</div>
                      <div className="text-xs text-slate-500">{u.email} · excluído em {fmtDateTime(u.excluido_em)} · <b className="text-amber-700">restam {restante(new Date(new Date(u.excluido_em).getTime() + 48 * 3600000).toISOString())}</b></div>
                    </div>
                    <button className={btnP + ' ' + btnSm} disabled={busy === u.id} onClick={() => restaurarUser(u)}>{busy === u.id ? 'Restaurando…' : '↩ Restaurar'}</button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </>)}
    </div>
  )
}
