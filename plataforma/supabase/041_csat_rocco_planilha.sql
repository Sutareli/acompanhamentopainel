-- 041 · C-SAT Rocco como réplica da planilha Rocco_CSAT_Dashboard: guarda a exportação do Rocco (colunas A:Q, na ordem da aba
-- "Base de Dados"), as abas do QUADRO (Colaboradores e STAFF) e os ajustes feitos nas abas Regras/Hierarquia. Os cálculos são as
-- próprias fórmulas da planilha, executadas no navegador. Leitura: is_viewer_all(); escrita: is_manager(). Idempotente.

create table if not exists public.csat_base (
  id bigserial primary key,
  ordem bigint not null,                 -- posição da linha na aba "Base de Dados" (a ordem importa para as fórmulas de 1ª ocorrência)
  codigo text,                           -- coluna "Código" da exportação; repetido = não entra de novo
  linha jsonb not null,                  -- colunas A:Q com os nomes do cabeçalho (Código … Neutro), tipos como no Excel
  cat_manual text,                       -- coluna Categoria_Manual (revisão manual)
  obs_revisao text,                      -- coluna Obs_Revisao
  carga_id bigint references public.csat_cargas(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists csat_base_codigo_uidx on public.csat_base (codigo);   -- vários nulos são permitidos
create index if not exists csat_base_ordem_idx on public.csat_base (ordem);

create table if not exists public.csat_quadros (
  fonte text not null check (fonte in ('Quadro Colaboradores','Quadro STAFF')),
  parte integer not null,                -- blocos de até 2.000 linhas (a linha 1 do bloco 0 é o cabeçalho)
  linhas jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (fonte, parte)
);

create table if not exists public.csat_ajustes (
  folha text not null,
  celula text not null,                  -- "linha,coluna"
  valor jsonb,
  por uuid references public.profiles(id) on delete set null,
  em timestamptz not null default now(),
  primary key (folha, celula)
);

alter table public.csat_cargas drop constraint if exists csat_cargas_tipo_check;
alter table public.csat_cargas add constraint csat_cargas_tipo_check check (tipo in ('respostas','quadro','base','planilha'));

alter table public.csat_base enable row level security;
alter table public.csat_quadros enable row level security;
alter table public.csat_ajustes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['csat_base','csat_quadros','csat_ajustes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_viewer_all())', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_manager())', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_manager()) with check (public.is_manager())', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_manager())', t || '_del', t);
  end loop;
end $$;
grant select, insert, update, delete on public.csat_base, public.csat_quadros, public.csat_ajustes to authenticated;
grant usage, select on sequence public.csat_base_id_seq to authenticated;

-- substitui a base inteira numa transação (carga da planilha completa)
create or replace function public.csat_base_substituir(p_linhas jsonb, p_carga bigint) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if not public.is_manager() then raise exception 'Sem permissão'; end if;
  delete from csat_base where true;
  insert into csat_base (ordem, codigo, linha, cat_manual, obs_revisao, carga_id)
  select (e->>'ordem')::bigint, nullif(e->>'codigo',''), e->'linha', nullif(e->>'cat_manual',''), nullif(e->>'obs_revisao',''), p_carga
  from jsonb_array_elements(p_linhas) e
  on conflict (codigo) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.csat_base_substituir(jsonb, bigint) from public, anon;
grant execute on function public.csat_base_substituir(jsonb, bigint) to authenticated;
