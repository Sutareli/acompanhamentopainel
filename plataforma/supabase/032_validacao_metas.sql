-- 032 · Módulo "Validação de metas": por produto/cliente, quantos indicadores estão habilitados e quantos têm meta
-- (antes e depois da validação). Consulta: Diretor, Gerente e Analista Sr. Escrita: só Analista Sr (is_manager).
-- Cada alteração de números grava um instantâneo em metas_historico (para acompanhar a evolução).

create table if not exists public.metas_produtos(
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 80),
  logo text check (logo is null or length(logo) <= 300000),          -- imagem reduzida, como data URL
  ordem int not null default 0,
  habilitados int not null default 0 check (habilitados >= 0),
  antes int not null default 0 check (antes >= 0),
  depois int not null default 0 check (depois >= 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null,
  constraint metas_antes_ok check (antes <= habilitados),
  constraint metas_depois_ok check (depois <= habilitados));
create unique index if not exists metas_produtos_nome on public.metas_produtos (lower(trim(nome)));

create table if not exists public.metas_historico(
  id bigint generated always as identity primary key,
  produto_id uuid not null references public.metas_produtos(id) on delete cascade,
  registrado_em timestamptz not null default now(),
  habilitados int not null, antes int not null, depois int not null,
  origem text not null default 'manual' check (origem in ('manual','importacao','cadastro')),
  registrado_por uuid references public.profiles(id) on delete set null);
create index if not exists metas_historico_prod on public.metas_historico(produto_id, registrado_em);

alter table public.metas_produtos enable row level security;
alter table public.metas_historico enable row level security;
drop policy if exists mp_sel on public.metas_produtos; drop policy if exists mp_ins on public.metas_produtos;
drop policy if exists mp_upd on public.metas_produtos; drop policy if exists mp_del on public.metas_produtos; drop policy if exists mh_sel on public.metas_historico;
create policy mp_sel on public.metas_produtos for select to authenticated using (is_active() and is_viewer_all());
create policy mp_ins on public.metas_produtos for insert to authenticated with check (is_manager());
create policy mp_upd on public.metas_produtos for update to authenticated using (is_manager()) with check (is_manager());
create policy mp_del on public.metas_produtos for delete to authenticated using (is_manager());
create policy mh_sel on public.metas_historico for select to authenticated using (is_active() and is_viewer_all());   -- sem policy de escrita: só o gatilho grava

create or replace function public.tg_metas_antes() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); new.atualizado_por := auth.uid(); return new; end $$;
drop trigger if exists metas_antes on public.metas_produtos;
create trigger metas_antes before insert or update on public.metas_produtos for each row execute function public.tg_metas_antes();

create or replace function public.tg_metas_historico() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' or (old.habilitados, old.antes, old.depois) is distinct from (new.habilitados, new.antes, new.depois) then
    insert into metas_historico(produto_id, habilitados, antes, depois, origem, registrado_por)
      values (new.id, new.habilitados, new.antes, new.depois,
              case when tg_op = 'INSERT' then 'cadastro' else coalesce(nullif(current_setting('app.metas_origem', true), ''), 'manual') end, auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists metas_historico on public.metas_produtos;
create trigger metas_historico after insert or update on public.metas_produtos for each row execute function public.tg_metas_historico();

-- Importação em lote (CSV lido na tela): atualiza pelo nome (sem diferenciar maiúsculas) ou cria o produto. Tudo ou nada.
create or replace function public.metas_importar(p_rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb; n_novo int := 0; n_atual int := 0; v_id uuid; v_ordem int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr importa metas.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nenhuma linha para importar.'; end if;
  perform set_config('app.metas_origem', 'importacao', true);
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_id from metas_produtos where lower(trim(nome)) = lower(trim(r->>'nome'));
    if v_id is null then
      select coalesce(max(ordem), 0) + 1 into v_ordem from metas_produtos;
      insert into metas_produtos(nome, ordem, habilitados, antes, depois)
        values (trim(r->>'nome'), v_ordem, (r->>'habilitados')::int, coalesce((r->>'antes')::int, 0), (r->>'depois')::int);
      n_novo := n_novo + 1;
    else
      update metas_produtos set habilitados = (r->>'habilitados')::int, antes = coalesce((r->>'antes')::int, antes), depois = (r->>'depois')::int where id = v_id;   -- coluna "antes" é opcional no CSV
      n_atual := n_atual + 1;
    end if;
  end loop;
  return jsonb_build_object('criados', n_novo, 'atualizados', n_atual);
end $$;
grant execute on function public.metas_importar(jsonb) to authenticated;
