import test from 'node:test'
import assert from 'node:assert/strict'
import { contar, diasNoMes, kpis, mesAnterior, mesLabel, porDia, quinzenaDe, semanaDe, semanasDoMes } from '../src/lib/chamados'
import type { Chamado } from '../src/lib/chamados'
import { compara, fatorPeriodo, naPeriodo } from '../src/lib/comparativo'

const ch = (o: Partial<Chamado>) => ({ id: Math.random().toString(), id_chamado: '1', data_identificacao: null, data_ref: '2026-10-05', categoria: null, subcategoria: 'A', tipo: 'Correção', item_sintoma: null, sistema_ofensor: null, cliente: null, site: null, status: null, prazo: 'Dentro do prazo', responsavel: null, empresa_responsavel: null, responsavel_rocco: null, fase: null, ...o }) as Chamado

test('mês anterior, rótulos e dias do mês', () => {
  assert.equal(mesAnterior('2026-03'), '2026-02'); assert.equal(mesAnterior('2026-01'), '2025-12')
  assert.equal(mesLabel('2026-10'), 'Out/26'); assert.equal(diasNoMes('2028-02'), 29); assert.equal(diasNoMes('2026-02'), 28)
})

test('quinzena e semanas (segunda a domingo)', () => {
  assert.equal(quinzenaDe('2026-10-15'), 1); assert.equal(quinzenaDe('2026-10-16'), 2)
  const s = semanasDoMes('2026-10')   // 01/10/2026 é quinta
  assert.deepEqual(s[0], { n: 1, ini: 1, fim: 4 }); assert.equal(semanaDe('2026-10-05'), 2)
})

test('contagem ignora maiúsculas/minúsculas e separa vazios', () => {
  const r = contar([ch({ subcategoria: 'Lentidão' }), ch({ subcategoria: 'lentidão ' }), ch({ subcategoria: 'Erro' }), ch({ subcategoria: null })], (c) => c.subcategoria)
  assert.equal(r.vazios, 1); assert.equal(r.barras[0].qtd, 2); assert.equal(r.barras.length, 2)
})

test('KPIs: total, % no prazo, tipos e subcategorias', () => {
  const k = kpis([ch({}), ch({ prazo: 'Fora do prazo' }), ch({ tipo: 'Melhoria', subcategoria: 'B' }), ch({ prazo: null })])
  assert.equal(k.total, 4); assert.equal(k.noPrazo, 2); assert.equal(k.pctPrazo, 0.5); assert.equal(k.tipos, 2); assert.equal(k.subcategorias, 2)
  assert.equal(kpis([]).pctPrazo, null)
})

test('chamados por dia do mês', () => {
  const a = porDia([ch({ data_ref: '2026-10-01' }), ch({ data_ref: '2026-10-01' }), ch({ data_ref: '2026-09-30' })], '2026-10')
  assert.equal(a.length, 31); assert.equal(a[0], 2); assert.equal(a.reduce((x, y) => x + y, 0), 2)
})

test('períodos do comparativo: mês, quinzenas e "dias 1 a N"', () => {
  assert.equal(naPeriodo('2026-10-20', 'mes'), true)
  assert.equal(naPeriodo('2026-10-15', 'q1'), true); assert.equal(naPeriodo('2026-10-16', 'q1'), false)
  assert.equal(naPeriodo('2026-10-16', 'q2'), true); assert.equal(naPeriodo('2026-10-15', 'q2'), false)
  assert.equal(naPeriodo('2026-10-17', 'ate17'), true); assert.equal(naPeriodo('2026-10-18', 'ate17'), false)
})

test('meta mensal proporcional ao período', () => {
  assert.equal(fatorPeriodo('2026-10', 'mes'), 1); assert.equal(fatorPeriodo('2026-10', 'q1'), 0.5)
  assert.equal(fatorPeriodo('2026-10', 'ate31'), 1); assert.ok(Math.abs(fatorPeriodo('2026-11', 'ate15') - 0.5) < 1e-9)
})

test('veredito: menos chamados e mais prazo = melhorou', () => {
  assert.equal(compara({ total: 80, pctPrazo: 0.9 }, { total: 100, pctPrazo: 0.8 }).veredito, 'melhorou')
  assert.equal(compara({ total: 120, pctPrazo: 0.7 }, { total: 100, pctPrazo: 0.8 }).veredito, 'piorou')
})
test('veredito: sinais opostos = misto; diferença pequena = estável', () => {
  assert.equal(compara({ total: 60, pctPrazo: 0.7 }, { total: 100, pctPrazo: 0.8 }).veredito, 'misto')   // volume caiu 40%, prazo caiu 10 p.p.
  assert.equal(compara({ total: 102, pctPrazo: 0.81 }, { total: 100, pctPrazo: 0.8 }).veredito, 'estavel')
})
test('veredito: sem chamados na base de comparação = sem base', () => {
  assert.equal(compara({ total: 10, pctPrazo: 0.5 }, { total: 0, pctPrazo: null }).veredito, 'sem_base')
})
