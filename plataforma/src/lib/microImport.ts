/** Importação de Projetos (macro/micro) por CSV (modelo padrão). Funções puras: leitura, validação e detecção de duplicadas. */
import { hnorm, parseCsv, parseData } from './chamados'
import { Crit, TipoProjeto, validateMicro } from './rules'

export const MICRO_HEADERS = ['DEMANDA', 'RESPONSÁVEL', 'CRITICIDADE', 'DATA TARGET', 'QUANTIDADE', 'A INICIAR', 'EM ANDAMENTO', 'CONCLUÍDO', 'CANCELADO', 'RESUMO', 'OBSERVAÇÕES', 'TIPO', 'COM QUEM ESTÁ']
export const MICRO_EXEMPLO = ['Revisão da base de microatividades', 'nome.sobrenome@empresa.com', 'alta', '30/11/2026', '20', '12', '5', '3', '0', 'Resumo opcional', 'Observação opcional', 'micro', '']
export const modeloMicroCsv = () => '﻿' + [MICRO_HEADERS, MICRO_EXEMPLO].map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n') + '\r\n'

export interface PessoaRef { id: string; nome: string; email: string; ativo: boolean }
export interface MicroNova {
  criticidade: Crit; responsavel_id: string; demanda: string; resumo: string | null; data_target: string
  quantidade: number; a_iniciar: number; em_andamento: number; concluido: number; cancelado: number; observacoes: string | null
  tipo_projeto: TipoProjeto; com_quem_id: string | null
}
export interface LeituraMicro { rows: MicroNova[]; nomes: string[]; erros: { linha: number; msg: string }[]; duplicadas: number; erroGeral: string | null }

const CRIT: Record<string, Crit> = { alta: 'alta', media: 'media', baixa: 'baixa' }
const num = (v: string | undefined): number | null => { const s = (v ?? '').trim(); if (!s) return null; return /^\d+$/.test(s) ? +s : NaN }

/** existentes: chaves "demanda|responsavel_id|data_target" já cadastradas — linhas iguais são puladas (não duplica ao reimportar). */
export function lerMicro(text: string, pessoas: PessoaRef[], existentes: Set<string>): LeituraMicro {
  const t = parseCsv(text)
  const vazio = (e: string): LeituraMicro => ({ rows: [], nomes: [], erros: [], duplicadas: 0, erroGeral: e })
  if (t.length < 2) return vazio('O arquivo está vazio ou sem linhas de dados.')
  const idx: Record<string, number> = {}; t[0].forEach((h, i) => { const k = hnorm(h); if (k && !(k in idx)) idx[k] = i })
  const faltam = ['demanda', 'responsavel', 'criticidade', 'datatarget'].filter((k) => !(k in idx))
  if (faltam.length) return vazio('Colunas obrigatórias não encontradas: ' + faltam.join(', ') + '. Use o modelo padrão.')
  const g = (r: string[], k: string) => (k in idx ? r[idx[k]] : undefined)
  const ativos = pessoas.filter((p) => p.ativo)
  const porEmail = new Map(ativos.map((p) => [p.email.trim().toLowerCase(), p]))
  const porNome = new Map<string, PessoaRef[]>(); ativos.forEach((p) => { const k = hnorm(p.nome); porNome.set(k, [...(porNome.get(k) || []), p]) })
  const rows: MicroNova[] = []; const erros: { linha: number; msg: string }[] = []; const vistas = new Set<string>(); let duplicadas = 0
  t.slice(1).forEach((r, i) => {
    const linha = i + 2
    const err = (msg: string) => erros.push({ linha, msg })
    const demanda = (g(r, 'demanda') || '').trim()
    if (!demanda) return err('Demanda vazia.')
    const resp = (g(r, 'responsavel') || '').trim()
    const p = porEmail.get(resp.toLowerCase()) || (porNome.get(hnorm(resp))?.length === 1 ? porNome.get(hnorm(resp))![0] : undefined)
    if (!resp) return err('Responsável vazio.')
    if (!p) return err(porNome.get(hnorm(resp))?.length ? `Responsável "${resp}" é ambíguo — use o e-mail.` : `Responsável "${resp}" não encontrado entre os usuários ativos (use o e-mail ou o nome exato).`)
    const crit = CRIT[hnorm(g(r, 'criticidade') || '')]
    if (!crit) return err('Criticidade inválida (use alta, média ou baixa).')
    const dt = parseData(g(r, 'datatarget'))
    if (!dt) return err('Data target inválida (use dd/mm/aaaa).')
    const tipoTxt = hnorm(g(r, 'tipo') || '')
    const tipo: TipoProjeto | null = tipoTxt === '' || tipoTxt === 'micro' || tipoTxt === 'microprojeto' ? 'micro' : tipoTxt === 'macro' || tipoTxt === 'macroprojeto' ? 'macro' : null
    if (!tipo) return err('Tipo inválido (use macro ou micro; vazio = micro).')
    const cq = (g(r, 'comquemesta') || '').trim()
    let comQuem: string | null = null
    if (cq) {
      if (tipo !== 'macro') return err('"Com quem está" só se aplica a MacroProjetos.')
      const pc = porEmail.get(cq.toLowerCase()) || (porNome.get(hnorm(cq))?.length === 1 ? porNome.get(hnorm(cq))![0] : undefined)
      if (!pc) return err(`"Com quem está" "${cq}" não encontrado entre os usuários ativos (use o e-mail ou o nome exato).`)
      comQuem = pc.id
    }
    const ns = (['ainiciar', 'emandamento', 'concluido', 'cancelado'] as const).map((k) => num(g(r, k)))
    const q0 = num(g(r, 'quantidade'))
    if (ns.some((n) => Number.isNaN(n)) || Number.isNaN(q0)) return err('Quantidade e distribuição devem ser números inteiros.')
    const dist = ns.map((n) => n ?? 0); const soma = dist.reduce((a, b) => a + b, 0)
    const q = q0 ?? soma
    if (q <= 0) return err('Quantidade deve ser maior que zero.')
    if (ns.every((n) => n === null)) dist[0] = q      // sem distribuição informada → tudo "a iniciar"
    const m: MicroNova = { criticidade: crit, responsavel_id: p.id, demanda, resumo: (g(r, 'resumo') || '').trim() || null, data_target: dt, quantidade: q,
      a_iniciar: dist[0], em_andamento: dist[1], concluido: dist[2], cancelado: dist[3], observacoes: (g(r, 'observacoes') || '').trim() || null, tipo_projeto: tipo, com_quem_id: comQuem }
    const v = validateMicro({ demanda: m.demanda, responsavel_id: m.responsavel_id, data_target: m.data_target, quantidade: m.quantidade, a_iniciar: m.a_iniciar, em_andamento: m.em_andamento, concluido: m.concluido, cancelado: m.cancelado })
    if (v) return err(v)
    const key = `${demanda.toLowerCase()}|${p.id}|${dt}`
    if (existentes.has(key) || vistas.has(key)) { duplicadas++; return }
    vistas.add(key); rows.push(m)
  })
  return { rows, nomes: [...new Set(rows.map((m) => pessoas.find((p) => p.id === m.responsavel_id)!.nome))], erros, duplicadas, erroGeral: null }
}
