import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCOS_PADRAO, blocosNovos, consolidarPedidos, duplicarBlocos, pedidosTexto, lerBlocos, moverItem, resumoBlocos } from '../src/lib/semanal'

test('Semanal: nasce com os 5 blocos na ordem combinada', () => {
  const b = blocosNovos()
  assert.deepEqual(b.map((x) => x.n), BLOCOS_PADRAO)
  assert.equal(b.length, 5); assert.ok(b.every((x) => !x.done && x.items.length === 0))
})
test('Semanal: lerBlocos completa os 5 blocos e descarta itens inválidos', () => {
  const r = lerBlocos([{ n: 'Básico', done: 1, items: [{ k: 't', v: 'a', d: 1 }, { k: 'x' }, { k: 'i', src: 'data:image/jpeg;base64,AA', cap: 'c' }, { k: 'i' }] }])
  assert.equal(r.length, 5); assert.equal(r[0].done, true); assert.equal(r[0].items.length, 2)
  assert.equal(r[4].n, 'Próximos passos'); assert.deepEqual(lerBlocos(null).map((x) => x.n), BLOCOS_PADRAO)
})
test('Semanal: duplicar mantém textos sem marcações e sem imagens', () => {
  const o = lerBlocos([{ n: 'Básico', done: true, items: [{ k: 't', v: 'x', d: true }, { k: 'i', src: 's', cap: '' }] }])
  const d = duplicarBlocos(o)
  assert.deepEqual(d[0].items, [{ k: 't', v: 'x', d: false }]); assert.equal(d[0].done, false)
})
test('Semanal: resumo e mover itens', () => {
  const o = lerBlocos([{ done: true, items: [{ k: 't', v: 'a', d: false }, { k: 'i', src: 's', cap: '' }] }, { done: true, items: [] }])
  assert.deepEqual(resumoBlocos(o), { vistos: 2, textos: 1, imagens: 1, pedidos: 0, pedidosAbertos: 0 })
  assert.deepEqual(moverItem([1, 2, 3], 0, 1), [2, 1, 3]); assert.deepEqual(moverItem([1, 2, 3], 0, -1), [1, 2, 3])
})
test('Semanal: pedidos por etapa, consolidado, texto e duplicação (só os em aberto)', () => {
  const o = lerBlocos([{ n: 'Básico', pedidos: [{ v: 'Enviar relatório', ok: true }, { v: 'Revisar prazo', ok: false }, { x: 1 }] }, {}, { pedidos: [{ v: 'Treinar equipe', ok: false }] }])
  assert.equal(o[0].pedidos.length, 2)
  const c = consolidarPedidos(o)
  assert.deepEqual(c.map((x) => [x.etapa, x.v, x.ok]), [['Básico', 'Enviar relatório', true], ['Básico', 'Revisar prazo', false], ['Implantações', 'Treinar equipe', false]].map((r, i) => i === 2 ? ['Melhorias e customizações', 'Treinar equipe', false] : r))
  assert.equal(resumoBlocos(o).pedidosAbertos, 2)
  assert.equal(pedidosTexto(o), 'Básico\n  [x] Enviar relatório\n  [ ] Revisar prazo\n\nMelhorias e customizações\n  [ ] Treinar equipe')
  assert.deepEqual(duplicarBlocos(o)[0].pedidos, [{ v: 'Revisar prazo', ok: false }])
})
