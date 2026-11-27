/** Leitura/gravação dos dados do C-SAT Rocco no Supabase e montagem da planilha (motor) com eles. */
import { supabase } from '../lib/supabase'
import { Modelo, Pasta } from './motor/pasta'
import { Esc } from './motor/valores'

export const COLS_EXPORT = ['Código', 'Data e hora', 'Dia da pesquisa', 'Usuário', 'Nome', 'Módulo', 'Código da operação', 'Operação', 'Campanhas vinculadas', 'Avaliação CSAT', 'Motivo', 'Comentário', 'Filtros selecionados', 'C-SAT', 'Detrator', 'Promotor', 'Neutro']
export type Linha = Record<string, Esc>
export interface LinhaBase { id: number; ordem: number; codigo: string | null; linha: Linha; cat_manual: string | null; obs_revisao: string | null }
export interface Dados { base: LinhaBase[]; quadros: Record<string, Esc[][]>; ajustes: { folha: string; celula: string; valor: Esc }[]; carga: { em: string; arquivo: string | null } | null }

/** Filtros (entradas) da planilha: não são gravados, cada pessoa usa os seus. */
export const ENTRADAS: [string, number, number][] = [
  ...[4, 6, 8, 10, 13, 15, 18, 19, 20, 24, 26, 29].map((c) => ['Dashboard', 6, c] as [string, number, number]),
  ['Dashboard', 8, 24], ['Dashboard', 8, 29],
  ['Comentários', 5, 6], ['Comentários', 6, 6], ['Comentários', 7, 6],
]
/** Áreas editáveis (gravadas para todos): as mesmas que a planilha manda editar. */
export const EDITAVEIS: Record<string, [number, number, number, number][]> = {
  Regras: [[6, 2, 21, 5], [6, 10, 131, 11], [6, 13, 37, 13], [25, 3, 30, 3]],
  Hierarquia: [[8, 3, 15, 4]],
  'Base de Dados': [],   // Categoria_Manual (lista) e Obs_Revisao: tratadas à parte
}
/** Conteúdo que não vai no modelo publicado (cadastros e regras reais): vem da planilha completa e fica no banco. */
export const DA_PLANILHA: Record<string, [number, number, number, number][]> = {
  Regras: [[6, 2, 21, 5], [6, 10, 131, 11], [6, 13, 37, 13], [25, 3, 30, 3]],
  Cadastros: [[5, 1, 58, 3], [5, 5, 1089, 8], [5, 10, 24, 11]],
  Hierarquia: [[8, 3, 15, 4]],
}
export const podeEditar = (folha: string, r: number, c: number) => (EDITAVEIS[folha] ?? []).some(([r1, c1, r2, c2]) => r >= r1 && r <= r2 && c >= c1 && c <= c2)

async function paginado<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) { const r = await q(de, de + 999); if (r.error) throw new Error(r.error.message); out.push(...(r.data || [])); if (!r.data || r.data.length < 1000) break }
  return out
}
export async function carregarDados(): Promise<Dados> {
  const [base, quadros, ajustes, carga] = await Promise.all([
    paginado<LinhaBase>((a, b) => supabase.from('csat_base').select('id,ordem,codigo,linha,cat_manual,obs_revisao').order('ordem').order('id').range(a, b)),
    paginado<{ fonte: string; parte: number; linhas: Esc[][] }>((a, b) => supabase.from('csat_quadros').select('fonte,parte,linhas').order('fonte').order('parte').range(a, b)),
    paginado<{ folha: string; celula: string; valor: Esc }>((a, b) => supabase.from('csat_ajustes').select('folha,celula,valor').range(a, b)),
    supabase.from('csat_cargas').select('em,arquivo').in('tipo', ['base', 'planilha']).order('em', { ascending: false }).limit(1),
  ])
  const q: Record<string, Esc[][]> = {}
  for (const p of quadros) (q[p.fonte] ??= []).push(...p.linhas)
  return { base, quadros: q, ajustes, carga: carga.data?.[0] ?? null }
}

export function montarPasta(modelo: Modelo, d: Dados): Pasta {
  const P = new Pasta(modelo)
  for (const [s, r, c] of ENTRADAS) P.marcarEntrada(s, r, c)
  for (const a of d.ajustes) { const [r, c] = a.celula.split(',').map(Number); P.gravar(a.folha, r, c, a.valor) }
  for (const fonte of ['Quadro Colaboradores', 'Quadro STAFF']) {
    const linhas = d.quadros[fonte]
    if (linhas?.length) {
      // a linha 1 (cabeçalho) também vem do arquivo: as colunas são localizadas pelo nome
      for (let j = 0; j < Math.max(linhas[0].length, 40); j++) P.gravar(fonte, 1, j + 1, linhas[0][j] ?? null)
      P.carregarValores(fonte, linhas.slice(1))
    }
  }
  P.carregarTabela('tbAvaliacoes', d.base.map((b) => ({ ...b.linha, Categoria_Manual: b.cat_manual, Obs_Revisao: b.obs_revisao })))
  return P
}

// ---------------- gravação ----------------
export async function gravarAjuste(folha: string, r: number, c: number, valor: Esc, por?: string) {
  const celula = `${r},${c}`
  const q = valor === null || valor === '' ? supabase.from('csat_ajustes').upsert({ folha, celula, valor: null, por, em: new Date().toISOString() }) : supabase.from('csat_ajustes').upsert({ folha, celula, valor, por, em: new Date().toISOString() })
  const res = await q; if (res.error) throw new Error(res.error.message)
}
export async function gravarRevisao(id: number, campo: 'cat_manual' | 'obs_revisao', valor: string | null) {
  const r = await supabase.from('csat_base').update({ [campo]: valor || null }).eq('id', id); if (r.error) throw new Error(r.error.message)
}
