/** Medição de texto (canvas) para quebrar linhas como o Excel. */
let ctx: CanvasRenderingContext2D | null = null
export function largura(texto: string, px: number, negrito = false, fonte = 'Segoe UI'): number {
  if (typeof document === 'undefined') return texto.length * px * 0.55
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return texto.length * px * 0.55
  ctx.font = `${negrito ? 'bold ' : ''}${px}px "${fonte}", "Segoe UI", system-ui, sans-serif`
  return ctx.measureText(texto).width
}
/** Quebra o texto em linhas que cabem na largura (por palavras; palavra maior que a linha é cortada). */
export function quebrar(texto: string, max: number, px: number, negrito = false, fonte?: string): string[] {
  const out: string[] = []
  for (const par of texto.split(/\r?\n/)) {
    const pal = par.split(' '); let lin = ''
    for (const p of pal) {
      const t = lin ? lin + ' ' + p : p
      if (largura(t, px, negrito, fonte) <= max || !lin) lin = t
      else { out.push(lin); lin = p }
    }
    out.push(lin)
  }
  return out
}
export const ptPx = (pt: number) => (pt * 4) / 3
export const FONTE = '"Segoe UI", "Segoe UI Emoji", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif'
export const fonteCss = (nome?: string) => (nome && nome !== 'Segoe UI' ? `"${nome}", ${nome === 'Calibri' ? 'Carlito, ' : ''}${FONTE}` : FONTE)
export const cor = (c?: string | null) => {
  if (!c || c === 'none') return 'transparent'
  const [h, a] = c.split(':')
  if (a === undefined) return '#' + h
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
