import { hnorm, parseCsv, parseData } from './chamados'

/** Leitura do CSV da base de MELHORIAS (colunas: ID, Módulo, Melhoria, Descrição, Descrição detalhada, Objetivo, Objetivo detalhado, AS IS, TO BE, Prioridade, Status, 10 PRIMEIRAS). */
export type StatusMel = 'A Iniciar' | 'Em andamento' | 'Concluído'
export interface MelhoriaImport {
  codigo: number; modulo: string; melhoria: string; descricao: string | null; descricao_detalhada: string | null
  objetivo: string | null; objetivo_detalhado: string | null; as_is: string | null; to_be: string | null
  prioridade: number | null; status: StatusMel; ordem_top: number | null
  // colunas OPCIONAIS (se existirem na base): datas do processo e nº do chamado
  data_ideia: string | null; data_abertura: string | null; numero_chamado: string | null
  responsavel_nome: string | null   // nome de um usuário da plataforma (sem correspondência → definir na tela)
}
export interface LeituraMelhorias { itens: MelhoriaImport[]; canceladas: number; vazias: number; erros: { linha: number; msg: string }[]; erroGeral: string | null }

const vazio = (e: string): LeituraMelhorias => ({ itens: [], canceladas: 0, vazias: 0, erros: [], erroGeral: e })
const inteiro = (v: string | undefined): number | null => { const t = (v || '').trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null }
const txt = (v: string | undefined): string | null => { const t = (v || '').replace(/\r/g, '').trim(); return t && t !== '-' ? t : null }

export function lerMelhorias(texto: string): LeituraMelhorias {
  const linhas = parseCsv(texto.replace(/^﻿/, ''))
  if (linhas.length < 2) return vazio('O arquivo está vazio.')
  const idx: Record<string, number> = {}
  linhas[0].forEach((h, i) => { const k = hnorm(h); if (k && !(k in idx)) idx[k] = i })
  const faltam = ['id', 'modulo', 'melhoria'].filter((k) => !(k in idx))
  if (faltam.length) return vazio('Colunas obrigatórias ausentes: ' + faltam.map((k) => k.toUpperCase()).join(', ') + '. Use o CSV da base de melhorias (ID, Módulo, Melhoria, …).')
  const achar = (ks: string[]) => ks.find((k) => k in idx)
  const colAbertura = achar(['dataabertura', 'datadeabertura', 'dataaberturachamado', 'dataaberturadochamado', 'datadochamado', 'datachamado', 'dataidentificacao', 'data'])
  const colIdeia = achar(['dataideia', 'datadaideia', 'datacriacao', 'datainclusao', 'criadoem'])
  const colResp = achar(['responsavel', 'responsavelpelaideia', 'responsavelpelamelhoria', 'dono', 'owner'])
  const colChamado = achar(['nchamado', 'ndochamado', 'numerochamado', 'numerodochamado', 'nrchamado', 'idchamado', 'chamado', 'ticket'])
  const g = (r: string[], k: string) => (k in idx ? r[idx[k]] : undefined)
  const itens: MelhoriaImport[] = []; const erros: LeituraMelhorias['erros'] = []; const vistos = new Set<number>(); let canceladas = 0, vazias = 0
  linhas.slice(1).forEach((r, i) => {
    const linha = i + 2
    if (!r.some((c) => (c || '').trim())) return
    const modulo = (g(r, 'modulo') || '').trim(); const melhoria = (g(r, 'melhoria') || '').trim()
    const err = (msg: string) => { erros.push({ linha, msg }) }
    if (!modulo && !melhoria && !(g(r, 'id') || '').trim()) { vazias++; return }
    const codigo = inteiro(g(r, 'id'))
    if (codigo === null) return err('ID ausente ou não numérico.')
    if (vistos.has(codigo)) return err(`ID ${codigo} repetido no arquivo.`)
    if (!melhoria) return err(`ID ${codigo}: nome da melhoria vazio.`)
    const s = hnorm(g(r, 'status') || '')
    if (s.startsWith('cancel') || s.startsWith('descart')) { canceladas++; vistos.add(codigo); return }
    const status: StatusMel = s.startsWith('conclu') ? 'Concluído' : s.startsWith('emand') ? 'Em andamento' : 'A Iniciar'
    vistos.add(codigo)
    itens.push({
      codigo, modulo: modulo || 'Sem módulo', melhoria,
      descricao: txt(g(r, 'descricao')), descricao_detalhada: txt(g(r, 'descricaodetalhada')), objetivo: txt(g(r, 'objetivo')), objetivo_detalhado: txt(g(r, 'objetivodetalhado')),
      as_is: txt(g(r, 'asis')), to_be: txt(g(r, 'tobe')), prioridade: inteiro(g(r, 'prioridade')), status, ordem_top: inteiro(g(r, '10primeiras')),
      data_ideia: colIdeia ? parseData(g(r, colIdeia)) : null, data_abertura: colAbertura ? parseData(g(r, colAbertura)) : null,
      responsavel_nome: colResp ? txt(g(r, colResp)) : null,
      numero_chamado: colChamado ? (txt(g(r, colChamado)) || '').slice(0, 60) || null : null,
    })
  })
  return { itens, canceladas, vazias, erros, erroGeral: itens.length === 0 && erros.length === 0 && canceladas === 0 ? 'Nenhuma melhoria encontrada no arquivo.' : null }
}
