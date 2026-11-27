/** Leitura dos arquivos do C-SAT Rocco (planilha completa, exportação do Rocco e QUADRO) e gravação no banco. */
import { supabase } from '../lib/supabase'
import { lerXlsxTipado, CelX } from '../lib/xlsx'
import { parseCsv } from '../lib/chamados'
import { COLS_EXPORT, DA_PLANILHA, Linha } from './dados'
import type { Modelo } from './motor/pasta'

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const vazio = (v: CelX | undefined) => v === null || v === undefined || v === ''

export interface LeituraBase { linhas: { codigo: string | null; linha: Linha; cat_manual: string | null; obs_revisao: string | null }[]; avisos: string[] }

/** Acha a linha de cabeçalho (a que tem "Código" e "Avaliação CSAT") e devolve as linhas A:Q com os nomes da exportação. */
export function lerLinhasExportacao(t: CelX[][], extras = false): LeituraBase {
  const alvo = COLS_EXPORT.map(norm)
  let hi = -1
  for (let i = 0; i < Math.min(t.length, 30); i++) { const h = (t[i] || []).map(norm); if (h.includes('codigo') && h.includes('avaliacaocsat')) { hi = i; break } }
  if (hi < 0) throw new Error('Não encontrei o cabeçalho da exportação do Rocco (colunas "Código" … "Avaliação CSAT").')
  const h = (t[hi] || []).map(norm)
  const idx = alvo.map((a) => h.indexOf(a))
  const faltam = COLS_EXPORT.filter((_, i) => idx[i] < 0)
  const iCat = h.indexOf('categoriamanual'), iObs = h.indexOf('obsrevisao')
  const linhas: LeituraBase['linhas'] = []
  for (const row of t.slice(hi + 1)) {
    if (!row || idx.every((j) => j < 0 || vazio(row[j]))) continue
    const linha: Linha = {}
    COLS_EXPORT.forEach((c, i) => { const v = idx[i] >= 0 ? row[idx[i]] : null; if (!vazio(v)) linha[c] = v as Linha[string] })
    const cod = linha['Código']
    linhas.push({ codigo: cod === undefined || cod === null || String(cod).trim() === '' ? null : String(cod).trim(), linha, cat_manual: extras && iCat >= 0 && !vazio(row[iCat]) ? String(row[iCat]) : null, obs_revisao: extras && iObs >= 0 && !vazio(row[iObs]) ? String(row[iObs]) : null })
  }
  return { linhas, avisos: faltam.length ? ['Colunas não encontradas (ficarão vazias): ' + faltam.join(', ') + '.'] : [] }
}

async function tabelaDoArquivo(f: File, preferida?: (n: string) => boolean): Promise<{ abas: { nome: string; linhas: CelX[][] }[] }> {
  const buf = await f.arrayBuffer()
  if (/\.xls[xm]$/i.test(f.name)) return { abas: await lerXlsxTipado(buf, preferida) }
  if (/\.xls$/i.test(f.name)) throw new Error('Formato .xls antigo: no Excel, salve como .xlsx.')
  let txt: string; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { txt = new TextDecoder('windows-1252').decode(buf) }
  const linhas = parseCsv(txt).map((l) => l.map((v): CelX => { const s = v.trim(); if (s === '') return null; return /^-?\d+([.,]\d+)?$/.test(s) && !/^0\d/.test(s) ? Number(s.replace(',', '.')) : v }))
  return { abas: [{ nome: f.name, linhas }] }
}

export async function lerExportacao(f: File): Promise<LeituraBase> {
  const { abas } = await tabelaDoArquivo(f)
  for (const a of abas) { try { return lerLinhasExportacao(a.linhas) } catch { /* tenta a próxima aba */ } }
  throw new Error('Não encontrei o cabeçalho da exportação do Rocco (colunas "Código" … "Avaliação CSAT").')
}

export interface LeituraQuadro { colab: CelX[][] | null; staff: CelX[][] | null }
export async function lerQuadro(f: File): Promise<LeituraQuadro> {
  const { abas } = await tabelaDoArquivo(f, (n) => /colab|staff/i.test(n))
  const pega = (re: RegExp) => { const a = abas.find((x) => re.test(x.nome)); return a ? limparLinhas(a.linhas) : null }
  const r = { colab: pega(/colab/i), staff: pega(/staff/i) }
  if (!r.colab && !r.staff) throw new Error('O arquivo não tem as abas "Colaboradores" e/ou "STAFF".')
  return r
}
const limparLinhas = (t: CelX[][]) => t.filter((l, i) => i === 0 || (l && l.some((v) => !vazio(v))))

export interface LeituraPlanilha { base: LeituraBase; quadros: LeituraQuadro; ajustes: { folha: string; celula: string; valor: CelX }[] }
/** Planilha completa Rocco_CSAT_Dashboard: base (com revisões manuais), quadros, Regras, Cadastros e o mapeamento da Hierarquia. */
export async function lerPlanilhaCompleta(f: File, modelo: Modelo): Promise<LeituraPlanilha> {
  const { abas } = await tabelaDoArquivo(f, (n) => ['Base de Dados', 'Quadro Colaboradores', 'Quadro STAFF', 'Regras', 'Hierarquia', 'Cadastros'].includes(n))
  const aba = (n: string) => abas.find((a) => a.nome === n)
  const b = aba('Base de Dados'); if (!b) throw new Error('Este arquivo não tem a aba "Base de Dados" da planilha Rocco_CSAT_Dashboard.')
  const base = lerLinhasExportacao(b.linhas, true)
  const qc = aba('Quadro Colaboradores'), qs = aba('Quadro STAFF')
  const ajustes: LeituraPlanilha['ajustes'] = []
  for (const folha of Object.keys(DA_PLANILHA)) {
    const a = aba(folha); if (!a) continue
    for (const [r1, c1, r2, c2] of DA_PLANILHA[folha]) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const novo = a.linhas[r - 1]?.[c - 1] ?? null
      const e = modelo.sheets[folha].cells[`${r},${c}`] as unknown[] | undefined
      if (e && e[2]) continue   // célula com fórmula: não é edição
      const antigo = (e?.[1] ?? null) as CelX
      if (String(novo ?? '') !== String(antigo ?? '')) ajustes.push({ folha, celula: `${r},${c}`, valor: novo })
    }
  }
  return { base, quadros: { colab: qc ? limparLinhas(qc.linhas) : null, staff: qs ? limparLinhas(qs.linhas) : null }, ajustes }
}

// ---------------- gravação ----------------
async function registrarCarga(tipo: string, arquivo: string, lidas: number, por?: string) {
  const c = await supabase.from('csat_cargas').insert({ tipo, arquivo, lidas, por }).select('id').single()
  if (c.error) throw new Error('Falha ao registrar a carga: ' + c.error.message + ' (a migração 041 foi executada?)')
  return c.data.id as number
}
/** Acrescenta ao fim da base as respostas com Código ainda não carregado (as repetidas são puladas). */
export async function acrescentarBase(l: LeituraBase, arquivo: string, por?: string, prog?: (s: string) => void): Promise<{ novas: number; repetidas: number }> {
  const existentes = new Set<string>(); let maxOrdem = 0
  for (let de = 0; ; de += 1000) { const r = await supabase.from('csat_base').select('codigo,ordem').order('id').range(de, de + 999); if (r.error) throw new Error(r.error.message); for (const x of r.data || []) { if (x.codigo) existentes.add(x.codigo); if (x.ordem > maxOrdem) maxOrdem = x.ordem } if (!r.data || r.data.length < 1000) break }
  const vistos = new Set<string>()
  const novas = l.linhas.filter((x) => { if (!x.codigo) return true; if (existentes.has(x.codigo) || vistos.has(x.codigo)) return false; vistos.add(x.codigo); return true })
  const cid = await registrarCarga('base', arquivo, l.linhas.length, por)
  for (let i = 0; i < novas.length; i += 500) {
    prog?.(`Gravando ${Math.min(i + 500, novas.length)} de ${novas.length}…`)
    const r = await supabase.from('csat_base').insert(novas.slice(i, i + 500).map((x, k) => ({ ordem: maxOrdem + i + k + 1, codigo: x.codigo, linha: x.linha, carga_id: cid })))
    if (r.error) throw new Error(`Falha na gravação (${i} já gravadas; reenviar não duplica): ` + r.error.message)
  }
  await supabase.from('csat_cargas').update({ novas: novas.length }).eq('id', cid)
  return { novas: novas.length, repetidas: l.linhas.length - novas.length }
}
export async function gravarQuadros(q: LeituraQuadro, arquivo: string, por?: string) {
  for (const [fonte, linhas] of [['Quadro Colaboradores', q.colab], ['Quadro STAFF', q.staff]] as const) {
    if (!linhas) continue
    const d = await supabase.from('csat_quadros').delete().eq('fonte', fonte); if (d.error) throw new Error(d.error.message + ' (a migração 041 foi executada?)')
    for (let i = 0, parte = 0; i < linhas.length; i += 2000, parte++) {
      const r = await supabase.from('csat_quadros').insert({ fonte, parte, linhas: linhas.slice(i, i + 2000) }); if (r.error) throw new Error(r.error.message)
    }
  }
  await registrarCarga('quadro', arquivo, (q.colab?.length ?? 1) - 1 + (q.staff?.length ?? 1) - 1, por)
}
/** Substitui tudo pela planilha completa (base na ordem do arquivo, revisões manuais, quadros, Regras, Cadastros e Hierarquia). */
export async function gravarPlanilhaCompleta(l: LeituraPlanilha, arquivo: string, por?: string, prog?: (s: string) => void) {
  const cid = await registrarCarga('planilha', arquivo, l.base.linhas.length, por)
  const linhas = l.base.linhas.map((x, i) => ({ ordem: i + 1, codigo: x.codigo, linha: x.linha, cat_manual: x.cat_manual, obs_revisao: x.obs_revisao }))
  prog?.('Gravando a base…')
  const r0 = await supabase.rpc('csat_base_substituir', { p_linhas: linhas.slice(0, 500), p_carga: cid }); if (r0.error) throw new Error(r0.error.message)
  // códigos repetidos dentro da própria base ficam só na 1ª ocorrência (o Excel os marca como "Duplicado (ignorado)")
  for (let i = 500; i < linhas.length; i += 500) {
    prog?.(`Gravando a base: ${Math.min(i + 500, linhas.length)} de ${linhas.length}…`)
    const r = await supabase.from('csat_base').upsert(linhas.slice(i, i + 500).map((x) => ({ ...x, carga_id: cid })), { onConflict: 'codigo', ignoreDuplicates: true }); if (r.error) throw new Error(r.error.message)
  }
  prog?.('Gravando os quadros…')
  await gravarQuadros(l.quadros, arquivo, por)
  prog?.('Gravando Regras, Cadastros e Hierarquia…')
  const d = await supabase.from('csat_ajustes').delete().in('folha', Object.keys(DA_PLANILHA)); if (d.error) throw new Error(d.error.message)
  for (let i = 0; i < l.ajustes.length; i += 1000) { const a = await supabase.from('csat_ajustes').insert(l.ajustes.slice(i, i + 1000).map((x) => ({ ...x, por }))); if (a.error) throw new Error(a.error.message) }
  await supabase.from('csat_cargas').update({ novas: linhas.length }).eq('id', cid)
}
