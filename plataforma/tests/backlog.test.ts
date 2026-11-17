import test from 'node:test'
import assert from 'node:assert/strict'
import { faseDe, melhoriaVencida, pctDaFase, vencida } from '../src/lib/backlog'
import type { Melhoria } from '../src/lib/backlog'

test('andamento % acompanha a etapa do funil (0/17/33/50/67/83/100)', () => {
  const esperado = { ideia: 0, priorizada: 17, especificacao: 33, chamado_aberto: 50, em_desenvolvimento: 67, homologacao: 83, producao: 100 }
  for (const [fase, pct] of Object.entries(esperado)) assert.equal(pctDaFase(fase), pct, fase)
  assert.equal(pctDaFase(null), 0)
})

test('fase deduzida do status quando não há fase gravada', () => {
  assert.equal(faseDe({ fase: undefined, status: 'Concluído' }), 'producao')
  assert.equal(faseDe({ fase: undefined, status: 'A Iniciar' }), 'ideia')
  assert.equal(faseDe({ fase: 'homologacao', status: 'Em andamento' }), 'homologacao')
})

test('prazo vencido: só se não estiver em Produção (melhoria) / Concluído (correção)', () => {
  const m = { data_termino: '2026-04-01', fase: 'em_desenvolvimento', status: 'Em andamento' } as Melhoria
  assert.equal(vencida(m, '2026-04-02'), true)
  assert.equal(vencida({ ...m, fase: 'producao' }, '2026-04-02'), false)
  assert.equal(vencida({ ...m, data_termino: null }, '2026-04-02'), false)
  assert.equal(melhoriaVencida({ ...m, status: 'Concluído' }, '2026-04-02'), false)
  assert.equal(melhoriaVencida(m, '2026-04-01'), false)   // no próprio dia ainda não venceu
})
