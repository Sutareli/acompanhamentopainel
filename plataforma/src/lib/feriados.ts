import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { setFeriados } from './sla'

export interface Feriado { data: string; nome: string }

/** Carrega os feriados e os entrega ao cálculo de SLA. Usado uma vez no App: quando chega, a árvore re-renderiza com os prazos corretos. */
export function useFeriados(ativo: boolean) {
  const [lista, setLista] = useState<Feriado[]>([])
  const [versao, setVersao] = useState(0)
  const recarregar = useCallback(async () => {
    const r = await supabase.from('feriados').select('data,nome').order('data')
    if (r.error) return                                   // migração 025 ainda não aplicada: segue só com fim de semana
    const l = (r.data || []) as Feriado[]
    setFeriados(l.map((x) => x.data)); setLista(l); setVersao((v) => v + 1)
  }, [])
  useEffect(() => { if (ativo) recarregar() }, [ativo, recarregar])
  return { lista, versao, recarregar }
}
