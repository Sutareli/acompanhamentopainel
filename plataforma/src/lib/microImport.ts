/** Importação de Projetos (macro/micro) por CSV (modelo padrão). Funções puras: leitura, validação e detecção de duplicadas. */
import { hnorm, mesNum, parseCsv, parseData } from './chamados'
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
export interface LeituraMicro { rows: MicroNova[]; nomes: string[]; erros: { linha: number; msg: string }[]; duplicadas: number; agrupadas: number; vazias: number; erroGeral: string | null }

const CRIT: Record<string, Crit> = { alta: 'alta', alto: 'alta', media: 'media', medio: 'media', baixa: 'baixa', baixo: 'baixa', recorrente: 'recorrente' }
/** Status textual da planilha → coluna de distribuição (usado só quando a distribuição numérica vem toda zerada). */
const STATUS_COL = (t: string): number => { const s = hnorm(t); return s.startsWith('emand') ? 1 : s.startsWith('conclu') ? 2 : s.startsWith('cancel') || s.startsWith('suspen') ? 3 : 0 }
/** "Recorrente" na Data Target: usa o último dia do mês da coluna MÊS_REF (o ano é o corrente; mês posterior ao atual = ano anterior). */
function fimDoMes(mesRef: string | undefined): string | null {
  const m = mesNum(mesRef); if (!m) return null
  const hoje = new Date(); let y = hoje.getFullYear(); if (m > hoje.getMonth() + 1) y -= 1
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const num = (v: string | undefined): number | null => { const s = (v ?? '').trim(); if (!s) return null; return /^\d+$/.test(s) ? +s : NaN }

/** existentes: chaves "demanda|responsavel_id|data_target" já cadastradas — linhas iguais são puladas (não duplica ao reimportar). */
export function lerMicro(text: string, pessoas: PessoaRef[], existentes: Set<string>): LeituraMicro {
  const t = parseCsv(text)
  const vazio = (e: string): LeituraMicro => ({ rows: [], nomes: [], erros: [], duplicadas: 0, agrupadas: 0, vazias: 0, erroGeral: e })
  if (t.length < 2) return vazio('O arquivo está vazio ou sem linhas de dados.')
  const idx: Record<string, number> = {}; t[0].forEach((h, i) => { const k = hnorm(h); if (k && !(k in idx)) idx[k] = i })
  const arqMacro = !('criticidade' in idx) && !('quantidade' in idx)   // planilha de MacroProjetos: sem criticidade/quantidade → macro, média, 1 unidade com o status da linha
  const faltam = ['demanda', 'responsavel', 'datatarget', ...(arqMacro ? [] : ['criticidade'])].filter((k) => !(k in idx))
  if (faltam.length) return vazio('Colunas obrigatórias não encontradas: ' + faltam.join(', ') + '. Use o modelo padrão.')
  const g = (r: string[], k: string) => (k in idx ? r[idx[k]] : undefined)
  const ativos = pessoas.filter((p) => p.ativo)
  const porEmail = new Map(ativos.map((p) => [p.email.trim().toLowerCase(), p]))
  const porNome = new Map<string, PessoaRef[]>(); ativos.forEach((p) => { const k = hnorm(p.nome); porNome.set(k, [...(porNome.get(k) || []), p]) })
  /** e-mail → nome completo → nome/sobrenome isolado (ex.: "Higor") → iniciais (ex.: "MA"); só vale se resolver para UMA pessoa. */
  const achar = (txt: string): PessoaRef | 'ambiguo' | undefined => {
    const t = txt.trim(); const h = hnorm(t); if (!h) return undefined
    const e = porEmail.get(t.toLowerCase()); if (e) return e
    const ex = porNome.get(h); if (ex) return ex.length === 1 ? ex[0] : 'ambiguo'
    const tokens = (p: PessoaRef) => p.nome.trim().split(/\s+/).map(hnorm)
    const tk = ativos.filter((p) => tokens(p).includes(h)); if (tk.length) return tk.length === 1 ? tk[0] : 'ambiguo'
    if (/^[A-Za-zÀ-ú]{2,3}$/.test(t)) { const ini = ativos.filter((p) => tokens(p).map((x) => x[0]).join('') === h); if (ini.length) return ini.length === 1 ? ini[0] : 'ambiguo' }
    return undefined
  }
  const rows: MicroNova[] = []; const erros: { linha: number; msg: string }[] = []; const vistas = new Set<string>(); const recorr = new Map<string, MicroNova>(); let duplicadas = 0, agrupadas = 0, vazias = 0
  t.slice(1).forEach((r, i) => {
    const linha = i + 2
    const err = (msg: string) => erros.push({ linha, msg })
    const demanda = (g(r, 'demanda') || '').trim()
    if (!demanda && !(g(r, 'responsavel') || '').trim()) { vazias++; return }   // linha em branco/sobra da planilha
    if (!demanda) return err('Demanda vazia.')
    const resp = (g(r, 'responsavel') || '').trim()
    if (!resp) return err('Responsável vazio.')
    const p = achar(resp)
    if (p === 'ambiguo') return err(`Responsável "${resp}" é ambíguo — use o nome completo ou o e-mail.`)
    if (!p) return err(`Responsável "${resp}" não encontrado entre os usuários ativos (use o e-mail, o nome completo, o primeiro nome ou as iniciais).`)
    const crit = arqMacro ? 'media' : CRIT[hnorm(g(r, 'criticidade') || '')]
    if (!crit) return err('Criticidade inválida (use alta, média, baixa ou recorrente).')
    let dt = parseData(g(r, 'datatarget')); let derivada = false
    if (!dt && (hnorm(g(r, 'datatarget') || '') === 'recorrente' || ((g(r, 'datatarget') || '').trim() === '' && crit === 'recorrente'))) {
      dt = fimDoMes(g(r, 'mesref')); derivada = !!dt
      if (!dt) return err('Data target "Recorrente" precisa da coluna MÊS_REF preenchida (ex.: Julho).')
    }
    if (!dt) return err('Data target inválida (use dd/mm/aaaa).')
    const tipoTxt = hnorm(g(r, 'tipo') || '')
    const tipo: TipoProjeto | null = arqMacro ? 'macro' : tipoTxt === '' || tipoTxt === 'micro' || tipoTxt === 'microprojeto' ? 'micro' : tipoTxt === 'macro' || tipoTxt === 'macroprojeto' ? 'macro' : null
    if (!tipo) return err('Tipo inválido (use macro ou micro; vazio = micro).')
    const cq = (g(r, 'comquemesta') || '').trim()
    let comQuem: string | null = null
    if (cq) {
      if (tipo !== 'macro') return err('"Com quem está" só se aplica a MacroProjetos.')
      const pc = achar(cq)
      if (!pc || pc === 'ambiguo') return err(`"Com quem está" "${cq}" não encontrado entre os usuários ativos (use o e-mail ou o nome exato).`)
      comQuem = pc.id
    }
    const ns = (['ainiciar', 'emandamento', 'concluido', 'cancelado'] as const).map((k) => num(g(r, k)))
    const q0 = arqMacro ? 1 : num(g(r, 'quantidade'))
    if (ns.some((n) => Number.isNaN(n)) || Number.isNaN(q0)) return err('Quantidade e distribuição devem ser números inteiros.')
    const dist = ns.map((n) => n ?? 0); let soma = dist.reduce((a, b) => a + b, 0)
    if (soma === 0 && (q0 ?? 0) > 0 && (arqMacro || ns.some((n) => n === 0))) { dist[STATUS_COL(g(r, 'status') || '')] = q0!; soma = q0! }   // distribuição zerada → usa a coluna Status
    const q = q0 ?? soma
    if (q <= 0) return err('Quantidade deve ser maior que zero.')
    if (ns.every((n) => n === null) && soma === 0) dist[0] = q      // sem distribuição informada → tudo "a iniciar"
    const m: MicroNova = { criticidade: crit, responsavel_id: p.id, demanda, resumo: (g(r, 'resumo') || '').trim() || null, data_target: dt, quantidade: q,
      a_iniciar: dist[0], em_andamento: dist[1], concluido: dist[2], cancelado: dist[3], observacoes: (g(r, 'observacoes') || '').trim() || null, tipo_projeto: tipo, com_quem_id: comQuem }
    const v = validateMicro({ demanda: m.demanda, responsavel_id: m.responsavel_id, data_target: m.data_target, quantidade: m.quantidade, a_iniciar: m.a_iniciar, em_andamento: m.em_andamento, concluido: m.concluido, cancelado: m.cancelado })
    if (v) return err(v)
    const key = `${demanda.toLowerCase()}|${p.id}|${dt}`
    if (existentes.has(key)) { duplicadas++; return }
    if (derivada) {   // ocorrências recorrentes do mesmo mês somam em uma única linha (não se perde nenhuma unidade)
      const ant = recorr.get(key)
      if (ant) { ant.quantidade += m.quantidade; ant.a_iniciar += m.a_iniciar; ant.em_andamento += m.em_andamento; ant.concluido += m.concluido; ant.cancelado += m.cancelado; agrupadas++; return }
      recorr.set(key, m)
    } else if (vistas.has(key)) { duplicadas++; return }
    vistas.add(key); rows.push(m)
  })
  return { rows, nomes: [...new Set(rows.map((m) => pessoas.find((p) => p.id === m.responsavel_id)!.nome))], erros, duplicadas, agrupadas, vazias, erroGeral: null }
}
