import { addDays } from './rules'

/** Um registro por usuário por dia em que a plataforma foi aberta (tabela `acessos`, migração 037). */
export interface Acesso { usuario_id: string; dia: string; primeiro_em: string; ultimo_em: string; pings: number; origem: 'app' | 'historico' }
export interface PessoaAc { id: string; nome: string; perfil: string }

export interface LinhaAc {
  pessoa: PessoaAc
  dias: Record<string, Acesso | undefined>
  uteis: number          // dias úteis considerados no período
  comAcesso: number      // desses, quantos tiveram acesso
  pct: number | null     // aderência (null = nenhum dia útil considerado)
  ultimo?: string        // último acesso (ISO)
  semAcesso: number      // dias úteis seguidos sem acesso, contando de ontem para trás (0 se acessou hoje)
}

/** Lista de datas terminando em `fim`, da mais antiga para a mais recente. */
export const janela = (fim: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(fim, i - (n - 1)))

/**
 * Monta uma linha por pessoa. Aderência = dias úteis com acesso ÷ dias úteis do período.
 * Hoje só entra na conta se a pessoa já acessou (o dia ainda não acabou); acesso em fim de semana/feriado não conta.
 */
export function montar(pessoas: PessoaAc[], acessos: Acesso[], dias: string[], hoje: string, ehUtil: (d: string) => boolean): LinhaAc[] {
  const por = new Map<string, Map<string, Acesso>>()
  for (const a of acessos) { if (!por.has(a.usuario_id)) por.set(a.usuario_id, new Map()); por.get(a.usuario_id)!.set(a.dia, a) }
  return pessoas.map((pessoa) => {
    const m = por.get(pessoa.id) || new Map<string, Acesso>()
    const linha: LinhaAc['dias'] = {}
    let uteis = 0, comAcesso = 0, ultimo: string | undefined
    for (const d of dias) {
      const a = m.get(d); linha[d] = a
      if (a && (!ultimo || a.ultimo_em > ultimo)) ultimo = a.ultimo_em
      if (!ehUtil(d) || d > hoje) continue
      if (d === hoje && !a) continue
      uteis++; if (a) comAcesso++
    }
    for (const a of m.values()) if (!ultimo || a.ultimo_em > ultimo) ultimo = a.ultimo_em
    let semAcesso = 0
    if (!m.has(hoje)) for (let d = addDays(hoje, -1), k = 0; k < 60; d = addDays(d, -1), k++) {
      if (!ehUtil(d)) continue
      if (m.has(d)) break
      semAcesso++
    }
    return { pessoa, dias: linha, uteis, comAcesso, pct: uteis ? Math.round((comAcesso / uteis) * 100) : null, ultimo, semAcesso }
  })
}
