/** Anexos de documentação dos projetos: só PDF e Word (.doc/.docx), até 10 MB. */
export const LIMITE_ANEXO = 10 * 1024 * 1024
export const MAX_ANEXOS = 30
export const EXT_ANEXO = ['pdf', 'doc', 'docx'] as const
export const MIME_ANEXO: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
export const extensao = (nome: string) => (nome.includes('.') ? nome.split('.').pop()!.toLowerCase() : '')

/** Confere extensão, tamanho e o "cabeçalho" real do arquivo (não basta o nome terminar em .pdf). Devolve a mensagem de erro ou null se estiver ok. */
export function validarAnexo(nome: string, tamanho: number, cab: Uint8Array): string | null {
  const ext = extensao(nome)
  if (!(EXT_ANEXO as readonly string[]).includes(ext)) return `“${nome}”: use PDF ou Word (.doc, .docx).`
  if (tamanho <= 0) return `“${nome}”: o arquivo está vazio.`
  if (tamanho > LIMITE_ANEXO) return `“${nome}”: passa de 10 MB (${fmtTamanho(tamanho)}). Comprima o arquivo ou salve como PDF.`
  const b = (...v: number[]) => v.every((x, i) => cab[i] === x)
  const ok = ext === 'pdf' ? b(0x25, 0x50, 0x44, 0x46) : ext === 'docx' ? b(0x50, 0x4b, 0x03, 0x04) : b(0xd0, 0xcf, 0x11, 0xe0)
  return ok ? null : `“${nome}”: o conteúdo não parece ser um ${ext.toUpperCase()} válido.`
}

/** Nome do arquivo no armazenamento: sem acentos nem símbolos (o nome original é guardado à parte para exibir). */
export function nomeSeguro(nome: string): string {
  const ext = extensao(nome), base = nome.slice(0, nome.length - (ext ? ext.length + 1 : 0))
  const limpo = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80) || 'documento'
  return ext ? `${limpo}.${ext}` : limpo
}

export function fmtTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}
