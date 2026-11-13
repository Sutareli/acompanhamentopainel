import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ZipBuilder } from '../lib/zip'
import { fmtBytes, nomeSeguro } from '../pages/Atas'

/** Nome de pasta/arquivo dentro do ZIP: mantém acentos e espaços, tira só o que o sistema de arquivos não aceita. */
const pastaSegura = (n: string) => (n || 'sem nome').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80) || 'sem nome'
import { btnD, btnG, btnP, Modal, Msg, inp } from './ui'

interface AtaFull { id: string; user_id: string; nome: string; data_reuniao: string; resumo: string | null; texto: string | null; arquivo_path: string | null; arquivo_nome: string | null; arquivo_tamanho: number | null; criado_em: string; atualizado_em: string }
type Etapa = 'inicio' | 'gerando' | 'backup' | 'excluindo' | 'fim'

const csv = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Arquivamento das atas (somente Analista Sr, só com o uso no limiar de aviso):
 * 1) abre a janela de manutenção no banco (3 h, auditada) → 2) baixa TODAS as atas e seus arquivos e monta UM .zip →
 * 3) entrega o .zip para download e registra no banco exatamente quais atas entraram → 4) após confirmação digitada, exclui SOMENTE essas atas
 * (e seus arquivos no Storage). Nenhuma outra tabela é tocada.
 */
export default function ArquivarAtas({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('inicio')
  const [prog, setProg] = useState('')
  const [err, setErr] = useState('')
  const [zip, setZip] = useState<{ blob: Blob; nome: string; atas: number; arquivos: number; falhas: string[] } | null>(null)
  const [guardei, setGuardei] = useState(false)
  const [txt, setTxt] = useState('')
  const [res, setRes] = useState<{ excluidas: number; removidos: number; falhaStorage: number } | null>(null)

  function baixar(b: Blob, nome: string) {
    const url = URL.createObjectURL(b); const a = document.createElement('a')
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  async function gerar() {
    setErr(''); setEtapa('gerando'); setProg('Abrindo a janela de manutenção…')
    try {
      const ab = await supabase.rpc('atas_manutencao_abrir')
      if (ab.error) throw new Error(ab.error.message)

      const atas: AtaFull[] = []
      for (let i = 0; ; i += 500) {
        setProg(`Lendo as atas… ${atas.length}`)
        const r = await supabase.from('atas').select('*').order('criado_em').order('id').range(i, i + 499)
        if (r.error) throw new Error(r.error.message)
        atas.push(...((r.data || []) as AtaFull[]))
        if ((r.data || []).length < 500) break
      }
      const pr = await supabase.from('profiles').select('id,nome,email')
      const nomes = new Map(((pr.data || []) as { id: string; nome: string; email: string }[]).map((p) => [p.id, p.nome || p.email]))
      const dono = (id: string) => nomes.get(id) || 'usuario-' + id.slice(0, 8)

      const z = new ZipBuilder()
      const incluidas: { id: string; u: string }[] = []
      const falhas: string[] = []
      let nArq = 0
      for (let k = 0; k < atas.length; k++) {
        const a = atas[k]
        setProg(`Montando o arquivo… ata ${k + 1} de ${atas.length}`)
        if (a.arquivo_path) {
          const d = await supabase.storage.from('atas').download(a.arquivo_path)
          if (d.error || !d.data) { falhas.push(`${dono(a.user_id)} · ${a.data_reuniao} · ${a.nome} (anexo ${a.arquivo_nome || ''} não pôde ser baixado)`); continue }  // fica FORA da lista de exclusão
          const pasta = `arquivos/${pastaSegura(dono(a.user_id))}/${a.data_reuniao}_${pastaSegura(a.nome).slice(0, 60)}__${a.id.slice(0, 8)}/`
          z.add({ nome: pasta + pastaSegura(a.arquivo_nome || nomeSeguro('anexo.docx')), dados: new Uint8Array(await d.data.arrayBuffer()) })
          nArq++
        }
        incluidas.push({ id: a.id, u: a.atualizado_em })
      }
      const ok = atas.filter((a) => incluidas.some((i) => i.id === a.id))
      const agora = new Date()
      const selo = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}_${pad(agora.getHours())}${pad(agora.getMinutes())}`
      const cab = 'usuario;data_reuniao;nome;resumo;texto;arquivo;tamanho_arquivo_bytes;criada_em;atualizada_em;id'
      const linhas = ok.map((a) => [dono(a.user_id), a.data_reuniao, a.nome, a.resumo, a.texto, a.arquivo_nome, a.arquivo_tamanho, a.criado_em, a.atualizado_em, a.id].map(csv).join(';'))
      z.addTexto('atas.csv', [cab, ...linhas].join('\r\n'), true)
      z.addTexto('atas.json', JSON.stringify(ok.map((a) => ({ ...a, usuario: dono(a.user_id) })), null, 1))
      z.addTexto('LEIAME.txt', [
        'BACKUP DE ATAS — Gestão de atividades',
        'Gerado em: ' + agora.toLocaleString('pt-BR'),
        `Atas neste arquivo: ${ok.length} · anexos: ${nArq}`,
        '',
        'atas.csv  → todas as atas em planilha (abra no Excel; separador ponto e vírgula, UTF-8).',
        'atas.json → mesma informação completa, para reimportar se necessário.',
        'arquivos/ → anexos originais (Word/PDF), em pastas por pessoa e por ata.',
        '',
        falhas.length ? 'ATENÇÃO — atas NÃO incluídas (anexo não baixou) e, por isso, NÃO foram excluídas do sistema:\r\n' + falhas.map((f) => ' - ' + f).join('\r\n') : 'Todas as atas e anexos foram incluídos.',
        '',
        'Este arquivo contém atas PRIVADAS de todas as pessoas. Guarde-o em local seguro.',
      ].join('\r\n'))
      const blob = z.fechar()
      const nome = `backup-atas_${selo}.zip`
      setZip({ blob, nome, atas: ok.length, arquivos: nArq, falhas })

      baixar(blob, nome)
      const rg = await supabase.rpc('atas_backup_registrar', { p_itens: incluidas })
      if (rg.error) throw new Error(rg.error.message)
      setEtapa('backup')
    } catch (e) {
      setErr((e as Error).message); setEtapa('inicio')
    }
  }

  async function excluir() {
    setErr(''); setEtapa('excluindo'); setProg('Excluindo as atas…')
    try {
      const r = await supabase.rpc('atas_esvaziar', { p_confirmacao: 'EXCLUIR ATAS' })
      if (r.error) throw new Error(r.error.message)
      const d = r.data as { excluidas: number; caminhos: string[] }
      let removidos = 0, falhaStorage = 0
      for (let i = 0; i < d.caminhos.length; i += 100) {
        setProg(`Liberando arquivos… ${removidos}/${d.caminhos.length}`)
        const lote = d.caminhos.slice(i, i + 100)
        const x = await supabase.storage.from('atas').remove(lote)
        if (x.error) falhaStorage += lote.length; else removidos += (x.data || []).length || lote.length
      }
      await supabase.rpc('atas_manutencao_fechar')
      setRes({ excluidas: d.excluidas, removidos, falhaStorage }); setEtapa('fim'); onDone()
    } catch (e) {
      setErr((e as Error).message); setEtapa('backup')
    }
  }

  const trava = etapa === 'gerando' || etapa === 'excluindo'
  async function fechar() { if (etapa === 'backup') await supabase.rpc('atas_manutencao_fechar'); onClose() }

  return (
    <Modal title="Arquivar atas (backup + liberar espaço)" onClose={trava ? () => {} : fechar} wide>
      <div className="space-y-3 text-sm text-slate-700">
        {err && <Msg kind="erro">{err}</Msg>}

        {etapa === 'inicio' && (<>
          <p>Vamos gerar <b>um único arquivo .zip</b> com <b>todas as atas de todos os usuários</b> (texto em planilha e JSON + os anexos Word/PDF) para você baixar e guardar.</p>
          <p>Só depois disso o botão de excluir fica disponível — e ele apaga <b>exclusivamente as atas</b> que entraram no arquivo. Projetos, ideias, tarefas e demais dados não são tocados.</p>
          <Msg kind="aviso">Esta ação abre, por até 3 horas, o seu acesso de leitura às atas dos demais usuários (que normalmente são privadas) e fica registrada na auditoria.</Msg>
          <div className="flex justify-end gap-2"><button className={btnG} onClick={onClose}>Cancelar</button><button className={btnP} onClick={gerar}>Gerar backup</button></div>
        </>)}

        {(etapa === 'gerando' || etapa === 'excluindo') && <p className="py-6 text-center font-semibold text-navy" role="status">{prog}</p>}

        {etapa === 'backup' && zip && (<>
          <Msg kind="ok">Backup gerado: <b>{zip.nome}</b> · {zip.atas} ata(s) · {zip.arquivos} anexo(s) · {fmtBytes(zip.blob.size)}. O download começou automaticamente.</Msg>
          {zip.falhas.length > 0 && <Msg kind="aviso">{zip.falhas.length} ata(s) ficaram fora do arquivo (anexo não baixou) e <b>não serão excluídas</b>: {zip.falhas.join(' · ')}</Msg>}
          <div className="flex flex-wrap items-center gap-2"><button className={btnG} onClick={() => baixar(zip.blob, zip.nome)}>⬇ Baixar de novo</button><span className="text-xs text-slate-500">Abra o arquivo e confira se está tudo ali antes de excluir.</span></div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="font-bold text-red-800">Excluir as {zip.atas} ata(s) do banco</p>
            <p className="mt-1 text-xs text-red-800">Não vão para a Lixeira — a cópia é o arquivo que você baixou. Não dá para desfazer pelo sistema.</p>
            <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={guardei} onChange={(e) => setGuardei(e.target.checked)} /><span>Baixei o arquivo, conferi e guardei em local seguro.</span></label>
            <label className="mt-2 block text-xs font-semibold text-red-900">Digite EXCLUIR ATAS para confirmar</label>
            <input className={inp + ' mt-1 max-w-xs'} value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Confirmação" autoComplete="off" />
            <div className="mt-3 flex justify-end gap-2"><button className={btnG} onClick={fechar}>Agora não</button><button className={btnD} disabled={!guardei || txt.trim() !== 'EXCLUIR ATAS'} onClick={excluir}>Excluir todas as atas</button></div>
          </div>
        </>)}

        {etapa === 'fim' && res && (<>
          <Msg kind="ok"><b>{res.excluidas}</b> ata(s) excluída(s) e {res.removidos} arquivo(s) removido(s) do Storage. Os usuários já podem registrar uma nova carga de atas.</Msg>
          {res.falhaStorage > 0 && <Msg kind="aviso">{res.falhaStorage} arquivo(s) não puderam ser removidos do Storage agora; a rotina de limpeza de órfãos da página Atas remove-os depois.</Msg>}
          <p className="text-xs text-slate-500">Observação: o espaço do Storage é liberado na hora; o do banco de dados pode demorar a diminuir no painel do Supabase.</p>
          <div className="flex justify-end"><button className={btnP} onClick={onClose}>Concluir</button></div>
        </>)}
      </div>
    </Modal>
  )
}
