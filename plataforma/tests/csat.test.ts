import test from 'node:test'
import assert from 'node:assert/strict'
import { agrupar, kpis, lerQuadro, linhaCabecalho, montarRespostas, sugerirColunas, visaoDe } from '../src/lib/csat'

test('C-SAT: (notas 4 + 5) ÷ total, neutras no total', () => {
  const k = kpis([5, 4, 3, 2, 1, 5, 4, 3].map((nota) => ({ nota })))
  assert.equal(k.total, 8); assert.equal(k.satisfeitos, 4); assert.equal(k.neutros, 2); assert.equal(k.insatisfeitos, 2)
  assert.equal(k.csat, 50); assert.equal(k.media, 27 / 8)
  assert.equal(kpis([]).csat, null)
})

test('C-SAT: reconhece colunas, lê data/nota e ignora linhas inválidas', () => {
  const t = [['Relatório C-SAT'], ['Data da Resposta', 'Usuário', 'Pergunta', 'Nota', 'Comentário'], ['01/11/2026', 'ABC123', 'Facilidade', '5', 'ótimo'], ['02/11/2026', 'abc123', 'Facilidade', '3', ''], ['x', 'z', 'p', '9', ''], ['03/11/2026', 'def', 'Facilidade', '1', 'lento']]
  const hi = linhaCabecalho(t); assert.equal(hi, 1)
  const cols = sugerirColunas(t[hi], t.slice(hi + 1))
  assert.equal(cols.data, 0); assert.equal(cols.usuario, 1); assert.equal(cols.pergunta, 2); assert.equal(cols.nota, 3); assert.equal(cols.comentario, 4)
  const r = montarRespostas(t[hi], t.slice(hi + 1), { cols, visaoFixa: 'performance' })
  assert.equal(r.rows.length, 3); assert.equal(r.ignoradas, 1)
  assert.equal(r.rows[0].data, '2026-11-01'); assert.equal(r.rows[2].nota, 1)
  // reenviar a mesma base gera as mesmas chaves (histórico acumulativo sem duplicar)
  const r2 = montarRespostas(t[hi], t.slice(hi + 1), { cols, visaoFixa: 'performance' })
  assert.deepEqual(r.rows.map((x) => x.chave), r2.rows.map((x) => x.chave))
  assert.equal(new Set(r.rows.map((x) => x.chave)).size, 3)
})

test('C-SAT: linhas idênticas viram respostas distintas e a visão pode vir de uma coluna', () => {
  const head = ['Data', 'Login', 'Nota', 'Tipo pesquisa']
  const d = [['2026-11-05', 'u1', '4', 'Operador'], ['2026-11-05', 'u1', '4', 'Operador'], ['2026-11-05', 'g1', '2', 'Gestor'], ['2026-11-05', 'g2', '5', '???']]
  const cols = sugerirColunas(head, d)
  assert.equal(cols.visao, 3)
  const r = montarRespostas(head, d, { cols, visaoFixa: null })
  assert.equal(r.rows.length, 3); assert.equal(r.semVisao, 1)
  assert.notEqual(r.rows[0].chave, r.rows[1].chave)
  assert.deepEqual(r.rows.map((x) => x.visao), ['performance', 'performance', 'executiva'])
  assert.equal(visaoDe('Supervisor'), 'executiva'); assert.equal(visaoDe('Performance'), 'performance')
})

test('C-SAT: base larga (uma coluna por pergunta)', () => {
  const head = ['Data', 'Usuário', 'Facilidade', 'Agilidade']
  const d = [['10/11/2026', 'u1', '5', '2'], ['10/11/2026', 'u2', '4', '']]
  const cols = sugerirColunas(head, d)
  const r = montarRespostas(head, d, { cols, visaoFixa: 'executiva', notasExtras: [3] })
  assert.equal(r.rows.length, 3)
  assert.deepEqual(r.rows.map((x) => x.pergunta), ['Facilidade', 'Agilidade', 'Facilidade'])
})

test('C-SAT: QUADRO liga por ALMOPE e agrupa por supervisor', () => {
  const q = lerQuadro([['ALMOPE', 'NOME', 'SUPERVISOR', 'SITE'], ['ABC123', 'Ana', 'Sup A', 'SP'], ['', 'sem', 'x', 'y']])
  assert.equal(q.erro, null); assert.equal(q.rows.length, 1); assert.equal(q.rows[0].almope, 'abc123')
  const g = agrupar([{ nota: 5, s: 'A' }, { nota: 1, s: 'A' }, { nota: 4, s: null }], (r) => r.s)
  assert.equal(g[0].nome, 'A'); assert.equal(g[0].k.csat, 50); assert.equal(g[1].nome, '(sem informação)')
})
