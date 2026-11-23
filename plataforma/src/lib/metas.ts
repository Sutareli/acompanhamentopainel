import { hnorm, parseCsv } from './chamados'

/** Validação de metas: por produto/cliente, indicadores habilitados e quantos têm meta antes e depois da validação. */
export const SITES = ['MCZ', 'THE', 'FOR', 'NSS'] as const
export type Site = (typeof SITES)[number]
export interface Produto {
  id: string; nome: string; logo: string | null; sites: Site[]; ordem: number
  habilitados: number; antes: number; depois: number; ativo: boolean; atualizado_em: string
}
export interface Snapshot { id: number; produto_id: string; registrado_em: string; habilitados: number; antes: number; depois: number; origem: 'manual' | 'importacao' | 'cadastro' }

/** Percentual com meta (0–100, uma casa). Sem indicadores habilitados → 0. */
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
/** "33,3%", "100%", "64%" (vírgula decimal, sem zero à direita); sem habilitados mostra "—". */
export const fmtPct = (n: number, d: number) => (d > 0 ? String(pct(n, d)).replace('.', ',') + '%' : '—')

/** Valida os números de um produto; devolve a mensagem de erro ou null. */
export function validarNumeros(h: number, a: number, d: number): string | null {
  if (![h, a, d].every((x) => Number.isInteger(x) && x >= 0)) return 'Use apenas números inteiros, zero ou maiores.'
  if (a > h) return 'Indicadores com meta (antes) não pode passar dos habilitados.'
  if (d > h) return 'Indicadores com meta (depois) não pode passar dos habilitados.'
  return null
}

export interface LinhaMetas { nome: string; habilitados: number; antes: number | null; depois: number }
export interface LeituraMetas { itens: LinhaMetas[]; erros: { linha: number; msg: string }[]; erroGeral: string | null }

const COL: Record<string, string[]> = {
  nome: ['produto', 'cliente', 'nome', 'produtocliente'],
  habilitados: ['habilitados', 'indicadoreshabilitados', 'habilitado'],
  antes: ['antes', 'indicadorescommetasantes', 'commetaantes', 'metasantes'],
  depois: ['depois', 'indicadorescommetasdepois', 'commetadepois', 'metasdepois'],
}
export const modeloMetasCsv = () => '﻿Produto;Habilitados;Antes;Depois\nExemplo SAC;11;11;11\nExemplo Agências;48;16;48\n'

/** Lê o CSV de metas. Obrigatórias: Produto, Habilitados, Depois. "Antes" é opcional (se faltar, mantém o valor atual do produto). */
export function lerMetas(texto: string): LeituraMetas {
  const falha = (e: string): LeituraMetas => ({ itens: [], erros: [], erroGeral: e })
  const linhas = parseCsv(texto.replace(/^﻿/, '')).filter((l) => l.some((c) => c.trim() !== ''))
  if (linhas.length < 2) return falha('O arquivo está vazio.')
  const idx: Record<string, number> = {}
  linhas[0].forEach((h, i) => { const k = hnorm(h); for (const [campo, nomes] of Object.entries(COL)) if (nomes.includes(k) && !(campo in idx)) idx[campo] = i })
  const faltam = (['nome', 'habilitados', 'depois'] as const).filter((c) => !(c in idx))
  if (faltam.length) return falha('Colunas obrigatórias ausentes: ' + faltam.map((c) => ({ nome: 'Produto', habilitados: 'Habilitados', depois: 'Depois' }[c])).join(', ') + '. Baixe o modelo para ver o formato.')
  const inteiro = (v: string | undefined) => { const t = (v ?? '').trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null }
  const itens: LinhaMetas[] = []; const erros: LeituraMetas['erros'] = []; const vistos = new Set<string>()
  linhas.slice(1).forEach((l, i) => {
    const linha = i + 2
    const nome = (l[idx.nome] || '').trim()
    if (!nome) return erros.push({ linha, msg: 'Produto em branco.' })
    if (nome.length > 80) return erros.push({ linha, msg: `“${nome.slice(0, 20)}…”: nome com mais de 80 caracteres.` })
    const k = nome.toLowerCase(); if (vistos.has(k)) return erros.push({ linha, msg: `“${nome}” aparece mais de uma vez.` }); vistos.add(k)
    const h = inteiro(l[idx.habilitados]); const d = inteiro(l[idx.depois])
    const a = 'antes' in idx && (l[idx.antes] ?? '').trim() !== '' ? inteiro(l[idx.antes]) : null
    if (h === null || d === null || ('antes' in idx && (l[idx.antes] ?? '').trim() !== '' && a === null)) return erros.push({ linha, msg: `“${nome}”: Habilitados, Antes e Depois precisam ser números inteiros.` })
    const e = validarNumeros(h, a ?? 0, d); if (e) return erros.push({ linha, msg: `“${nome}”: ${e}` })
    itens.push({ nome, habilitados: h, antes: a, depois: d })
  })
  return { itens, erros, erroGeral: null }
}

/** Pontos do gráfico de evolução: % antes e % depois a cada instantâneo. */
export const serieEvolucao = (h: Snapshot[]) => h.map((s) => ({ em: s.registrado_em, antes: pct(s.antes, s.habilitados), depois: pct(s.depois, s.habilitados) }))
