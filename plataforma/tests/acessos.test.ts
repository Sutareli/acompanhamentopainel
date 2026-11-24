import test from 'node:test'
import assert from 'node:assert/strict'
import { Acesso, janela, montar } from '../src/lib/acessos'

// 2026-11-23 (segunda) é "hoje". 20/11 sexta, 21 e 22 fim de semana, 19/11 quinta, 18/11 quarta.
const hoje = '2026-11-23'
const util = (d: string) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 }
const ac = (u: string, dia: string, origem: 'app' | 'historico' = 'app'): Acesso => ({ usuario_id: u, dia, primeiro_em: dia + 'T11:00:00Z', ultimo_em: dia + 'T20:00:00Z', pings: 3, origem })
const ana = { id: 'a', nome: 'Ana', perfil: 'analista' }, beto = { id: 'b', nome: 'Beto', perfil: 'analista' }

test('janela: termina em hoje e vai da data mais antiga para a mais recente', () => {
  assert.deepEqual(janela(hoje, 3), ['2026-11-21', '2026-11-22', '2026-11-23'])
})
test('aderência: dias úteis com acesso ÷ dias úteis, sem contar fim de semana nem hoje sem acesso', () => {
  const dias = janela(hoje, 6)   // 18,19,20,21,22,23
  const [l] = montar([ana], [ac('a', '2026-11-18'), ac('a', '2026-11-20'), ac('a', '2026-11-21')], dias, hoje, util)
  assert.equal(l.uteis, 3)        // 18, 19, 20 (hoje sem acesso não entra; sáb/dom não são úteis)
  assert.equal(l.comAcesso, 2)    // 18 e 20 (o sábado não conta)
  assert.equal(l.pct, 67)
})
test('hoje com acesso entra na conta', () => {
  const [l] = montar([ana], [ac('a', hoje)], janela(hoje, 3), hoje, util)
  assert.equal(l.uteis, 1); assert.equal(l.pct, 100); assert.equal(l.semAcesso, 0)
})
test('sem acesso: conta dias úteis seguidos a partir de ontem, pulando fim de semana', () => {
  const [l] = montar([beto], [ac('b', '2026-11-18')], janela(hoje, 7), hoje, util)
  assert.equal(l.semAcesso, 2)    // sex 20 e qui 19 sem acesso; qua 18 teve
  assert.equal(l.ultimo, '2026-11-18T20:00:00Z')
})
test('sem nenhum dia útil considerado, a aderência fica vazia', () => {
  const [l] = montar([ana], [], ['2026-11-21', '2026-11-22'], hoje, util)
  assert.equal(l.pct, null)
})
test('acessos de outra pessoa não contam', () => {
  const [a, b] = montar([ana, beto], [ac('a', '2026-11-20')], janela(hoje, 4), hoje, util)
  assert.equal(a.comAcesso, 1); assert.equal(b.comAcesso, 0)
})
