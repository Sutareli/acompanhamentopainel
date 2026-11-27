/** Leitor mínimo de .xlsx (sem dependências): abre o ZIP, descompacta com o DecompressionStream nativo do navegador
 *  e devolve as células de uma aba como texto (datas ficam como número de série do Excel; parseData já entende). */

interface Entrada { nome: string; metodo: number; tamComp: number; offset: number }

function entradasZip(b: Uint8Array): Entrada[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido (não é um ZIP).')
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true)
  const out: Entrada[] = []
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const metodo = dv.getUint16(p + 10, true), tamComp = dv.getUint32(p + 20, true)
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true)
    const offset = dv.getUint32(p + 42, true)
    out.push({ nome: new TextDecoder().decode(b.subarray(p + 46, p + 46 + ln)), metodo, tamComp, offset })
    p += 46 + ln + le + lc
  }
  return out
}

async function lerEntrada(b: Uint8Array, e: Entrada): Promise<string> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ini = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true)
  const dados = b.slice(ini, ini + e.tamComp)
  if (e.metodo === 0) return new TextDecoder().decode(dados)
  if (e.metodo !== 8) throw new Error('Compressão não suportada no .xlsx.')
  const ds = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(ds).text()
}

const desc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/\r\n?/g, '\n').replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
const textoDe = (xml: string) => { let t = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) t += m[1]; return desc(t) }
const colIdx = (ref: string) => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1 }

export interface AbaXlsx { nome: string; linhas: string[][] }
export type CelX = string | number | boolean | null
export interface AbaTipada { nome: string; linhas: CelX[][] }

/** Lê todas as abas do .xlsx como texto. */
export async function lerXlsx(buf: ArrayBuffer): Promise<AbaXlsx[]> {
  return (await lerXlsxTipado(buf)).map((a) => ({ nome: a.nome, linhas: a.linhas.map((l) => l.map((v) => (v === null ? '' : String(v)))) }))
}
/** Lê todas as abas mantendo o tipo de cada célula (número, texto, lógico), como o Excel guarda. Opcional: só as abas pedidas. */
export async function lerXlsxTipado(buf: ArrayBuffer, filtro?: (nome: string) => boolean): Promise<AbaTipada[]> {
  const b = new Uint8Array(buf)
  const ents = entradasZip(b)
  const get = async (nome: string) => { const e = ents.find((x) => x.nome === nome); return e ? lerEntrada(b, e) : '' }
  const ss: string[] = []
  const ssXml = await get('xl/sharedStrings.xml')
  { const re = /<si>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(ssXml))) ss.push(textoDe(m[1])) }
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels')
  const alvo: Record<string, string> = {}
  { const re = /<Relationship\b[^>]*>/g; let m; while ((m = re.exec(rels))) { const id = /Id="([^"]+)"/.exec(m[0])?.[1], t = /Target="([^"]+)"/.exec(m[0])?.[1]; if (id && t) alvo[id] = t.replace(/^\/?xl\//, '').replace(/^\//, '') } }
  const abas: { nome: string; arq: string }[] = []
  { const re = /<sheet\b[^>]*>/g; let m; while ((m = re.exec(wb))) { const nome = desc(/name="([^"]*)"/.exec(m[0])?.[1] || ''); const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] || ''; if (alvo[rid]) abas.push({ nome, arq: 'xl/' + alvo[rid] }) } }
  if (!abas.length) ents.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.nome)).forEach((e, i) => abas.push({ nome: 'Planilha' + (i + 1), arq: e.nome }))
  const out: AbaTipada[] = []
  for (const a of abas) {
    if (filtro && !filtro(a.nome)) continue
    const xml = await get(a.arq); const linhas: CelX[][] = []
    const reR = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let r
    while ((r = reR.exec(xml))) {
      const rn = +(/\br="(\d+)"/.exec(r[1])?.[1] ?? linhas.length + 1)
      while (linhas.length < rn - 1) linhas.push([])
      const lin: CelX[] = []; const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c, pos = 0
      while ((c = reC.exec(r[2] || ''))) {
        const at = c[1], corpo = c[2] || ''
        const ref = /r="([A-Z]+\d+)"/.exec(at)?.[1]; const i = ref ? colIdx(ref) : pos; pos = i + 1
        const t = /t="([^"]+)"/.exec(at)?.[1]; const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1]
        let val: CelX = null
        if (t === 's') val = ss[+(v ?? -1)] ?? ''
        else if (t === 'inlineStr') val = textoDe(corpo)
        else if (t === 'str') val = v !== undefined ? desc(v) : ''
        else if (t === 'b') val = v === '1'
        else if (t === 'e') val = v !== undefined ? desc(v) : null
        else if (v !== undefined) { const n = Number(v); val = isNaN(n) ? desc(v) : n }
        while (lin.length < i) lin.push(null)
        lin[i] = val
      }
      linhas.push(lin)
    }
    while (linhas.length && !linhas[linhas.length - 1].some((x) => x !== null && x !== '')) linhas.pop()
    out.push({ nome: a.nome, linhas })
  }
  return out
}
