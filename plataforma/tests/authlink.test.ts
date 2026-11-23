import test from 'node:test'
import assert from 'node:assert/strict'
import { lerLinkAuth } from '../src/lib/authLink'

test('link de recuperação válido (modelo antigo): pede a nova senha', () => {
  const r = lerLinkAuth('#access_token=abc&refresh_token=x&type=recovery', '')
  assert.equal(r.precisaSenha, true); assert.equal(r.erro, ''); assert.equal(r.token, null)
})
test('link expirado/usado: mostra mensagem clara e não pede senha', () => {
  const r = lerLinkAuth('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '')
  assert.equal(r.precisaSenha, false); assert.match(r.erro, /expirou ou já foi usado/); assert.match(r.erro, /mais recente/)
})
test('link novo com token_hash: só guarda o token para confirmar depois', () => {
  const r = lerLinkAuth('', '?token_hash=h123&type=recovery')
  assert.deepEqual(r.token, { token_hash: 'h123', type: 'recovery' }); assert.equal(r.precisaSenha, false); assert.equal(r.erro, '')
  assert.equal(lerLinkAuth('', '?token_hash=h&type=invite').token?.type, 'invite')
})
test('endereço comum não dispara nada; tipo desconhecido é ignorado', () => {
  assert.deepEqual(lerLinkAuth('', ''), { precisaSenha: false, erro: '', token: null })
  assert.equal(lerLinkAuth('', '?token_hash=h&type=magiclink').token, null)
})
