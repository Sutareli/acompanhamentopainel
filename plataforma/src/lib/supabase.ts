import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** false quando as variáveis de ambiente não foram configuradas */
export const configured = !!url && !!key

// Somente a chave pública (anon). A proteção real dos dados é feita por RLS no banco.
export const supabase = createClient(url || 'http://localhost', key || 'missing-key')
