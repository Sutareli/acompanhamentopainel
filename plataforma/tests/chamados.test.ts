import test from 'node:test'
import assert from 'node:assert/strict'
import { contar, diasNoMes, kpis, lerBase, mesAnterior, mesLabel, porDia, quinzenaDe, resumoMes, semanaDe, semanasDoMes } from '../src/lib/chamados'
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

test('KPIs seguem a planilha: Improcedente e Cancelado não são casos; prazo em branco não é "dentro"; % no prazo sobre os concluídos', () => {
  const C = { status: '3 - Concluído' }
  const k = kpis([ch(C), ch({ ...C, prazo: 'Fora do prazo' }), ch({ ...C, tipo: 'Melhoria', subcategoria: 'B' }), ch({ ...C, prazo: null }), ch({ status: '6 - Improcedente' }), ch({ status: '5 - Cancelado' }), ch({ status: '1 - A iniciar', prazo: null })])
  assert.equal(k.total, 5); assert.equal(k.improcedentes, 2)          // 7 linhas − improcedente − cancelado
  assert.equal(k.noPrazo, 2); assert.equal(k.pctPrazo, 0.5)          // 3 de 4 concluídos (o pendente não entra na base)
  assert.equal(k.tipos, 2); assert.equal(k.subcategorias, 2)
  assert.equal(kpis([]).pctPrazo, null)
})

test('Resumo do mês reproduz a planilha (Set: 211 linhas → 204 casos, 201 no prazo, 4 reincidentes)', () => {
  const C = { status: '3 - Concluído', data_ref: '2026-09-10' }
  const set = [...Array(201).fill(0).map((_, i) => ch({ ...C, prazo: 'Dentro do prazo', reincidente: i < 4 })), ...Array(3).fill(0).map(() => ch({ ...C, prazo: 'Fora do prazo' })), ...Array(7).fill(0).map(() => ch({ status: '6 - Improcedente', data_ref: '2026-09-11' }))]
  const [r] = resumoMes(set, ['2026-09'])
  assert.equal(set.length, 211); assert.equal(r.casos, 204); assert.equal(r.concluidos, 204); assert.equal(r.noPrazo, 201)
  assert.equal(Math.round((r.pctNoPrazo as number) * 1000) / 10, 98.5); assert.equal(r.reincidentes, 4); assert.equal(Math.round((r.pctReincidentes as number) * 1000) / 10, 2); assert.equal(r.improcedentes, 7)
})

test('Resumo do mês: pendentes e pendentes no prazo (Nov: 9 pendentes, 5 no prazo = 55,6%)', () => {
  const N = { data_ref: '2026-11-10' }
  const pend = [...Array(5).fill(0).map(() => ch({ ...N, status: '1 - A iniciar', prazo: 'Dentro do prazo' })), ...Array(4).fill(0).map(() => ch({ ...N, status: '2 - Em andamento', prazo: 'Fora do prazo' }))]
  const [r] = resumoMes([...pend, ...Array(41).fill(0).map(() => ch({ ...N, status: '3 - Concluído' }))], ['2026-11'])
  assert.equal(r.casos, 50); assert.equal(r.concluidos, 41); assert.equal(Math.round((r.pctConcluidos as number) * 100), 82)
  assert.equal(r.pendentes, 9); assert.equal(r.pendNoPrazo, 5); assert.equal(Math.round((r.pctPendNoPrazo as number) * 1000) / 10, 55.6)
})

test('leitura do CSV: Status_Prazo manda no prazo (como no Resumo Mês) e REINCIDENTE ? vira verdadeiro/falso', () => {
  const csv = 'ID;DATA IDENTIFICAÇÃO;CATEGORIA;SUBCATEGORIA;TIPO ;STATUS;TRATADO DENTRO DO PRAZO?;Status_Prazo;REINCIDENTE ?\n1;05/11/2026;A;B;Correção;3 - Concluído;;Dentro do Prazo;SIM\n2;05/11/2026;A;B;Correção;1 - A iniciar;;Fora do Prazo;NÃO\n3;05/11/2026;A;B;Correção;3 - Concluído;Fora do prazo;Dentro do Prazo;'
  const r = lerBase(csv).rows
  assert.equal(r[0].prazo, 'Dentro do prazo'); assert.equal(r[0].reincidente, true)
  assert.equal(r[1].prazo, 'Fora do prazo'); assert.equal(r[1].reincidente, false)
  assert.equal(r[2].prazo, 'Dentro do prazo'); assert.equal(r[2].reincidente, null)   // Status_Prazo prevalece sobre a coluna manual
  assert.equal(lerBase('ID;DATA IDENTIFICAÇÃO;TRATADO DENTRO DO PRAZO?\n1;05/11/2026;Fora do prazo').rows[0].prazo, 'Fora do prazo')   // sem Status_Prazo, usa a coluna manual
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
