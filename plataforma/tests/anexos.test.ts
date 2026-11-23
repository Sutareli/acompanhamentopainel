import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtTamanho, LIMITE_ANEXO, nomeSeguro, validarAnexo } from '../src/lib/anexos'

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]), ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])
test('anexo: aceita PDF, DOCX e DOC reais', () => {
  assert.equal(validarAnexo('Especificação.pdf', 1000, pdf), null)
  assert.equal(validarAnexo('Doc.DOCX', 1000, zip), null)
  assert.equal(validarAnexo('antigo.doc', 1000, ole), null)
})
test('anexo: recusa extensão, tamanho e conteúdo inválidos', () => {
  assert.match(validarAnexo('planilha.xlsx', 10, zip)!, /PDF ou Word/)
  assert.match(validarAnexo('a.pdf', 0, pdf)!, /vazio/)
  assert.match(validarAnexo('grande.pdf', LIMITE_ANEXO + 1, pdf)!, /10 MB/)
  assert.match(validarAnexo('falso.pdf', 100, zip)!, /não parece ser um PDF/)   // renomeado: conteúdo não é PDF
  assert.equal(validarAnexo('limite.pdf', LIMITE_ANEXO, pdf), null)
})
test('anexo: nome seguro e tamanho legível', () => {
  assert.equal(nomeSeguro('Especificação técnica (v2).pdf'), 'Especificacao_tecnica_v2.pdf')
  assert.equal(nomeSeguro('../../etc/passwd.docx'), 'etc_passwd.docx')
  assert.equal(nomeSeguro('???.pdf'), 'documento.pdf')
  assert.equal(fmtTamanho(500), '500 B'); assert.equal(fmtTamanho(2048), '2 KB'); assert.equal(fmtTamanho(1572864), '1,5 MB')
})
