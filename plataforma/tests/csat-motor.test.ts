import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '../src/csat/motor/parser'
import { Pasta, Modelo } from '../src/csat/motor/pasta'
import { formatar } from '../src/csat/motor/formato'
import { numTexto } from '../src/csat/motor/valores'

const modelo = JSON.parse(readFileSync('src/csat/modelo.json', 'utf8')) as Modelo   // os testes rodam na pasta plataforma
const linha = (cod: number, data: string, mod: string, nota: number, coment = '') => ({ 'Código': cod, 'Data e hora': data, 'Dia da pesquisa': data.slice(0, 10) + ' 00:00:00', 'Usuário': 100 + cod, 'Nome': 'Pessoa ' + cod, 'Módulo': mod, 'Operação': 'Nubank', 'Campanhas vinculadas': 'NUBANK ATIVO FOR', 'Avaliação CSAT': nota, 'Motivo': 'Design', 'Comentário': coment })

test('C-SAT motor: lê fórmulas com referências estruturadas e funções do Excel', () => {
  const n = parse('=IF(tbAvaliacoes[[#This Row],[Valido]]=0,"",COUNTIF(INDEX(tbAvaliacoes[Chave],1):tbAvaliacoes[[#This Row],[Chave]],"x"))')
  assert.equal(n.t, 'fn')
  assert.equal(formatar(0.567, '0.0%'), '56,7%')
  assert.equal(formatar(46339, 'mm-dd-yy'), '13/11/2026')
  assert.equal(formatar(0, '0%;\\-0%;'), '')
  assert.equal(numTexto(2.5), '2,5')
})

test('C-SAT motor: painel calcula com a base (Performance × Executiva, C-SAT = notas 4 e 5 ÷ total)', () => {
  const P = new Pasta(modelo)
  // regras e cadastros reais vêm do banco; aqui, uma regra de exemplo
  P.gravar('Regras', 6, 10, 'não carrega'); P.gravar('Regras', 6, 11, 'Indicadores ausentes ou incompletos')
  P.carregarTabela('tbAvaliacoes', [linha(1, '02/11/2026 10:00:00', 'performance', 5, 'ótimo'), linha(2, '03/11/2026 10:00:00', 'performance', 3), linha(3, '04/11/2026 11:00:00', 'performance', 1, 'não carrega'), linha(4, '05/11/2026 09:00:00', 'executive', 4), linha(4, '05/11/2026 09:00:00', 'executive', 4)])
  assert.equal(P.valor('Base de Dados', 9, 54), 'Duplicado (ignorado)')
  assert.equal(P.valor('Dashboard', 3, 39), 3)                      // respostas Performance
  assert.ok(Math.abs((P.valor('Dashboard', 7, 39) as number) - 1 / 3) < 1e-12)   // C-SAT Performance
  assert.equal(P.valor('Base de Dados', 7, 46), 'Indicadores ausentes ou incompletos')   // categoria pela palavra-chave
  // filtro de nota recalcula só o que depende dele
  P.marcarEntrada('Dashboard', 6, 19)
  P.definir('Dashboard', 6, 19, 5)
  assert.equal(P.valor('Dashboard', 3, 39), 1)
})
