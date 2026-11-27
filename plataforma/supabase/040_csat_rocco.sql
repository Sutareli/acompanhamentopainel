-- 040 · C-SAT Rocco: respostas da pesquisa de satisfação (histórico acumulativo), cargas e QUADRO (hierarquia ligada por ALMOPE = usuário).
-- Leitura: Diretor, Gerente e Analista Sr (is_viewer_all). Escrita: is_manager(). Idempotente.

create table if not exists public.csat_cargas (
  id bigserial primary key,
  em timestamptz not null default now(),
  por uuid references public.profiles(id) on delete set null,
  tipo text not null default 'respostas' check (tipo in ('respostas','quadro')),
  arquivo text,
  lidas integer not null default 0,
  novas integer not null default 0
);

create table if not exists public.csat_respostas (
  id bigserial primary key,
  chave text not null unique,   -- identifica a resposta: reenviar a mesma base (ou bases sobrepostas) não duplica
  visao text not null check (visao in ('performance','executiva')),
  data date not null,
  usuario text,
  pergunta text,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  carga_id bigint references public.csat_cargas(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists csat_respostas_data_idx on public.csat_respostas (data);
create index if not exists csat_respostas_carga_idx on public.csat_respostas (carga_id);

create table if not exists public.csat_quadro (
  almope text primary key,   -- sempre em minúsculas
  nome text, supervisor text, coordenador text, gerente text, site text, cargo text, operacao text,
  atualizado_em timestamptz not null default now()
);

alter table public.csat_cargas enable row level security;
alter table public.csat_respostas enable row level security;
alter table public.csat_quadro enable row level security;

do $$
declare t text;
begin
  foreach t in array array['csat_cargas','csat_respostas','csat_quadro'] loop
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

grant select, insert, update, delete on public.csat_cargas, public.csat_respostas, public.csat_quadro to authenticated;
grant usage, select on sequence public.csat_cargas_id_seq, public.csat_respostas_id_seq to authenticated;
