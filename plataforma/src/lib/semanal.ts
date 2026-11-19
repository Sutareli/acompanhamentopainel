/** Semanal Italo: modelo de dados (blocos → itens de texto/imagem) e funções puras. */
export type ItemTxt = { k: 't'; v: string; d: boolean }                 // d = flag "já discutido"
export type ItemImg = { k: 'i'; src: string; cap: string }
export type Item = ItemTxt | ItemImg
export interface Pedido { v: string; ok: boolean }                       // pedido do diretor nesta etapa; ok = atendido
export interface Bloco { n: string; done: boolean; items: Item[]; pedidos: Pedido[] }   // done = flag "bloco visto"
export const BLOCOS_PADRAO = ['Básico', 'Implantações', 'Melhorias e customizações', 'Atualização das atividades', 'Próximos passos']

export const blocosNovos = (): Bloco[] => BLOCOS_PADRAO.map((n) => ({ n, done: false, items: [], pedidos: [] }))

/** Normaliza o JSON vindo do banco (sempre devolve os 5 blocos, na ordem; ignora itens inválidos). */
export function lerBlocos(raw: unknown): Bloco[] {
  const arr = Array.isArray(raw) ? raw : []
  return BLOCOS_PADRAO.map((nome, i) => {
    const b: any = arr[i] || {}
    const items: Item[] = (Array.isArray(b.items) ? b.items : []).flatMap((it: any): Item[] =>
      it?.k === 't' ? [{ k: 't', v: String(it.v ?? ''), d: !!it.d }] : it?.k === 'i' && typeof it.src === 'string' ? [{ k: 'i', src: it.src, cap: String(it.cap ?? '') }] : [])
    const pedidos: Pedido[] = (Array.isArray(b.pedidos) ? b.pedidos : []).flatMap((p: any): Pedido[] => (p && typeof p.v === 'string' ? [{ v: p.v, ok: !!p.ok }] : []))
    return { n: typeof b.n === 'string' && b.n ? b.n : nome, done: !!b.done, items, pedidos }
  })
}

/** Nova semanal a partir da anterior: mantém os textos (sem as marcações) e os pedidos ainda não atendidos; descarta imagens. */
export const duplicarBlocos = (bl: Bloco[]): Bloco[] =>
  bl.map((b) => ({ n: b.n, done: false, items: b.items.filter((i): i is ItemTxt => i.k === 't').map((i) => ({ k: 't', v: i.v, d: false })), pedidos: b.pedidos.filter((p) => !p.ok).map((p) => ({ v: p.v, ok: false })) }))

export const resumoBlocos = (bl: Bloco[]) => ({
  vistos: bl.filter((b) => b.done).length,
  textos: bl.reduce((a, b) => a + b.items.filter((i) => i.k === 't').length, 0),
  imagens: bl.reduce((a, b) => a + b.items.filter((i) => i.k === 'i').length, 0),
  pedidos: bl.reduce((a, b) => a + b.pedidos.length, 0),
  pedidosAbertos: bl.reduce((a, b) => a + b.pedidos.filter((p) => !p.ok).length, 0),
})

/** Todos os pedidos da semanal, na ordem das etapas (b = índice da etapa, i = posição na etapa). */
export const consolidarPedidos = (bl: Bloco[]) => bl.flatMap((x, b) => x.pedidos.map((p, i) => ({ etapa: x.n, b, i, ...p })))

/** Texto pronto para copiar/enviar: pedidos agrupados por etapa, com [x] nos atendidos. */
export function pedidosTexto(bl: Bloco[], titulo = ''): string {
  const L: string[] = titulo ? [titulo, ''] : []
  bl.forEach((x) => { if (!x.pedidos.length) return; L.push(x.n); x.pedidos.forEach((p) => L.push(`  [${p.ok ? 'x' : ' '}] ${p.v}`)); L.push('') })
  return L.join('\n').trim()
}

export function moverItem<T>(arr: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr
  const c = arr.slice(); [c[i], c[j]] = [c[j], c[i]]; return c
}
