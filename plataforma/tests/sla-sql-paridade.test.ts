import test from 'node:test'
import assert from 'node:assert/strict'
import { setFeriados, somaDiasUteis } from '../src/lib/sla'

// Os mesmos casos do teste SQL (tests/sql/025_testes.sql): a função do banco e a da tela precisam dar a MESMA data.
test('paridade com public.somar_dias_uteis (SQL)', () => {
  setFeriados(['2026-04-03'])
  assert.equal(somaDiasUteis('2026-04-02', 1), '2026-04-06')
  assert.equal(somaDiasUteis('2026-04-06', 3), '2026-04-09')
  assert.equal(somaDiasUteis('2026-04-10', 1), '2026-04-13')
  setFeriados([])
})
