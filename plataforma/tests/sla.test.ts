import test from 'node:test'
import assert from 'node:assert/strict'
import { diasUteisEntre, setFeriados, slaAtual, slaAtrasado, slaCumprido, somaDias, somaDiasUteis } from '../src/lib/sla'
import type { Melhoria } from '../src/lib/backlog'

const base = (o: Partial<Melhoria>) => ({ id: '1', modulo: 'M', melhoria: 'X', fase: 'chamado_aberto', status: 'Em andamento', ...o }) as Melhoria

test('dias úteis: pula sábado e domingo', () => {
  setFeriados([])
  assert.equal(somaDiasUteis('2026-04-10', 1), '2026-04-13')   // sexta → segunda
  assert.equal(somaDiasUteis('2026-04-06', 3), '2026-04-09')   // segunda + 3 = quinta
  assert.equal(somaDiasUteis('2026-04-10', 0), '2026-04-10')
})

test('dias úteis: feriado também é pulado (Sexta-feira Santa 03/04/2026)', () => {
  setFeriados(['2026-04-03'])
  assert.equal(somaDiasUteis('2026-04-02', 1), '2026-04-06')
  assert.equal(diasUteisEntre('2026-04-02', '2026-04-06'), 1)
  setFeriados([])
  assert.equal(somaDiasUteis('2026-04-02', 1), '2026-04-03')
})

test('dias úteis entre datas (positivo, negativo e igual)', () => {
  setFeriados([])
  assert.equal(diasUteisEntre('2026-04-06', '2026-04-10'), 4)
  assert.equal(diasUteisEntre('2026-04-10', '2026-04-06'), -4)
  assert.equal(diasUteisEntre('2026-04-06', '2026-04-06'), 0)
})

test('SLA de chamado aberto: 3 dias úteis por padrão', () => {
  setFeriados([])
  const m = base({ fase: 'chamado_aberto', data_abertura: '2026-04-06' })           // vence quinta 09/04
  assert.equal(slaAtual(m, '2026-04-08')?.estado, 'no_prazo')
  assert.equal(slaAtual(m, '2026-04-09')?.estado, 'vence_hoje')
  const atras = slaAtual(m, '2026-04-13')
  assert.equal(atras?.estado, 'atrasado'); assert.equal(atras?.venc, '2026-04-09'); assert.equal(slaAtrasado(m, '2026-04-13'), true)
})

test('SLA de chamado: um feriado empurra o vencimento', () => {
  setFeriados(['2026-04-08'])
  const m = base({ fase: 'chamado_aberto', data_abertura: '2026-04-06' })
  assert.equal(slaAtual(m, '2026-04-09')?.estado, 'no_prazo')   // sem o feriado seria vence_hoje
  assert.equal(slaAtual(m, '2026-04-10')?.estado, 'vence_hoje')
  setFeriados([])
})

test('SLA de desenvolvimento: 15 dias corridos e SLA próprio da ideia', () => {
  setFeriados([])
  const m = base({ fase: 'em_desenvolvimento', data_inicio: '2026-04-01' })
  assert.equal(slaAtual(m, '2026-04-16')?.estado, 'vence_hoje')
  assert.equal(slaAtual(m, '2026-04-17')?.estado, 'atrasado')
  const m2 = base({ fase: 'em_desenvolvimento', data_inicio: '2026-04-01', sla_dev_dias_corridos: 30 })
  assert.equal(slaAtual(m2, '2026-04-17')?.estado, 'no_prazo')
  assert.equal(somaDias('2026-04-01', 30), '2026-05-01')
})

test('SLA não se aplica fora de Chamado aberto/Desenvolvimento nem sem data', () => {
  assert.equal(slaAtual(base({ fase: 'ideia' }), '2026-04-10'), null)
  assert.equal(slaAtual(base({ fase: 'homologacao', data_inicio: '2026-04-01' }), '2026-04-10'), null)
  assert.equal(slaAtual(base({ fase: 'chamado_aberto', data_abertura: null }), '2026-04-10'), null)
})

test('cumprimento do SLA em transições já feitas', () => {
  setFeriados([])
  assert.equal(slaCumprido(base({ data_abertura: '2026-04-06', data_inicio: '2026-04-09' }), 'chamado_aberto'), true)
  assert.equal(slaCumprido(base({ data_abertura: '2026-04-06', data_inicio: '2026-04-10' }), 'chamado_aberto'), false)
  assert.equal(slaCumprido(base({ data_abertura: '2026-04-06' }), 'chamado_aberto'), null)
})
