import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCOS_PADRAO, blocosNovos, consolidarPedidos, duplicarBlocos, herdarPedidos, pedidosTexto, lerBlocos, moverItem, resumoBlocos } from '../src/lib/semanal'

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
  assert.deepEqual(duplicarBlocos(o)[0].pedidos, [{ v: 'Revisar prazo', ok: false, ant: true }])
  // texto: seções por origem (anteriores em aberto · novos · atendidos)
  const m = lerBlocos([{ pedidos: [{ v: 'Velho aberto', ok: false, ant: true }, { v: 'Velho feito', ok: true, ant: true }, { v: 'Novo', ok: false }] }])
  assert.equal(pedidosTexto(m), 'SEGUEM EM ABERTO (REUNIÕES ANTERIORES)\nBásico\n  [ ] Velho aberto\n\nNOVOS PEDIDOS\nBásico\n  [ ] Novo\n\nATENDIDOS DESDE A REUNIÃO ANTERIOR\nBásico\n  [x] Velho feito')
})

test('Semanal: nova reunião herda só os pedidos não atendidos da anterior, etapa por etapa, sem os textos', () => {
  const ant = blocosNovos()
  ant[0].items.push({ k: 't', v: 'texto antigo', d: true })
  ant[0].pedidos = [{ v: 'A', ok: false, ant: false }, { v: 'B', ok: true, ant: false }, { v: 'C', ok: false, ant: true }]
  ant[3].pedidos = [{ v: 'D', ok: true, ant: true }, { v: 'E', ok: false, ant: false }]
  const n = herdarPedidos(ant)
  assert.deepEqual(n[0].pedidos, [{ v: 'A', ok: false, ant: true }, { v: 'C', ok: false, ant: true }])
  assert.deepEqual(n[3].pedidos, [{ v: 'E', ok: false, ant: true }])
  assert.equal(n[1].pedidos.length, 0); assert.ok(n.every((b) => b.items.length === 0 && !b.done))
  assert.deepEqual(n.map((b) => b.n), BLOCOS_PADRAO)
})
