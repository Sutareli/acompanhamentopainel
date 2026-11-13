/** Gerador de ZIP mínimo (método "store", sem compressão) — sem dependências. Nomes em UTF-8. Não usa ZIP64: limite de ~4 GB no total. */
const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export interface ZipEntry { nome: string; dados: Uint8Array; data?: Date }
export const ZIP_LIMITE = 3.5 * 1024 * 1024 * 1024

export class ZipBuilder {
  private partes: Uint8Array[] = []
  private central: Uint8Array[] = []
  private offset = 0
  private n = 0
  get tamanho() { return this.offset }
  get itens() { return this.n }

  add(e: ZipEntry) {
    if (this.offset + e.dados.length > ZIP_LIMITE) throw new Error('O backup passou do limite de ~3,5 GB de um único arquivo.')
    const nome = new TextEncoder().encode(e.nome.replace(/\\/g, '/').replace(/^\/+/, ''))
    const d = e.data || new Date()
    const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    const dosD = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    const crc = crc32(e.dados), tam = e.dados.length
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true)
    lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true)
    ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true)
    ch.setUint16(28, nome.length, true); ch.setUint32(42, this.offset, true)
    const c = new Uint8Array(46 + nome.length); c.set(new Uint8Array(ch.buffer), 0); c.set(nome, 46)
    this.central.push(c)
    this.partes.push(new Uint8Array(lh.buffer), nome, e.dados)
    this.offset += 30 + nome.length + tam
    this.n++
  }
  addTexto(nome: string, texto: string, bom = false) { this.add({ nome, dados: new TextEncoder().encode((bom ? '﻿' : '') + texto) }) }

  fechar(): Blob {
    const ini = this.offset
    let tamCentral = 0
    for (const c of this.central) { this.partes.push(c); tamCentral += c.length }
    const e = new DataView(new ArrayBuffer(22))
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.n, true); e.setUint16(10, this.n, true); e.setUint32(12, tamCentral, true); e.setUint32(16, ini, true)
    this.partes.push(new Uint8Array(e.buffer))
    return new Blob(this.partes as unknown as BlobPart[], { type: 'application/zip' })
  }
}
