import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtPct, lerMetas, pct, serieEvolucao, validarNumeros } from '../src/lib/metas'

test('Metas: percentuais no formato do painel (vírgula, sem zero à direita)', () => {
  assert.equal(fmtPct(16, 48), '33,3%'); assert.equal(fmtPct(11, 11), '100%'); assert.equal(fmtPct(26, 33), '78,8%'); assert.equal(fmtPct(17, 23), '73,9%')
  assert.equal(fmtPct(11, 17), '64,7%'); assert.equal(fmtPct(0, 0), '—'); assert.equal(pct(1, 18), 5.6)
})
test('Metas: validação de números', () => {
  assert.equal(validarNumeros(10, 4, 8), null)
  assert.match(validarNumeros(10, 11, 8)!, /antes/); assert.match(validarNumeros(10, 4, 12)!, /depois/); assert.match(validarNumeros(10, -1, 2)!, /inteiros/)
})
test('Metas: leitura do CSV (apelidos de coluna, antes opcional, erros por linha)', () => {
  const r = lerMetas('Produto;Indicadores Habilitados;Antes;Depois\nNu SAC;11;11;11\nSantander;33;;26\nnu sac;5;1;2\nPAN;10;12;3\nKeeta;x;1;1\n;1;1;1\n')
  assert.equal(r.erroGeral, null)
  assert.deepEqual(r.itens.map((i) => [i.nome, i.habilitados, i.antes, i.depois]), [['Nu SAC', 11, 11, 11], ['Santander', 33, null, 26]])
  assert.equal(r.erros.length, 4); assert.match(r.erros[0].msg, /mais de uma vez/); assert.match(r.erros[1].msg, /antes/)
  assert.match(lerMetas('Produto;Depois\nA;1').erroGeral!, /Habilitados/); assert.match(lerMetas('').erroGeral!, /vazio/)
  assert.equal(lerMetas('produto,habilitados,depois\nA,4,2\n').itens[0].antes, null)
})
test('Metas: série de evolução', () => {
  const s = serieEvolucao([{ id: 1, produto_id: 'p', registrado_em: '2026-11-01', habilitados: 10, antes: 4, depois: 4, origem: 'cadastro' }, { id: 2, produto_id: 'p', registrado_em: '2026-11-10', habilitados: 10, antes: 4, depois: 8, origem: 'manual' }])
  assert.deepEqual(s.map((x) => x.depois), [40, 80]); assert.deepEqual(s.map((x) => x.antes), [40, 40])
})
