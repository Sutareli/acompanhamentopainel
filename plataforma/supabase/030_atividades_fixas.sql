-- 030 · Atividades fixas: o Analista Sr define atividades para cada pessoa; no To do diário elas aparecem travadas
-- (a pessoa só marca como feita). Cada atividade vale para os dias da semana escolhidos, dentro da vigência.

create table if not exists public.atividades_fixas(
  id uuid primary key default gen_random_uuid(),
  analista_id uuid not null references public.profiles(id) on delete cascade,
  descricao text not null check (length(trim(descricao)) between 1 and 300),
  bloco_numero int not null check (bloco_numero between 1 and 5),
  dias int[] not null default '{1,2,3,4,5}',                       -- 1 = segunda … 7 = domingo (isodow)
  data_inicio date not null default current_date,
  data_fim date,
  ativa boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now());
create index if not exists atividades_fixas_analista on public.atividades_fixas(analista_id);
alter table public.atividades_fixas enable row level security;
drop policy if exists af2_sel on public.atividades_fixas; drop policy if exists af2_ins on public.atividades_fixas;
drop policy if exists af2_upd on public.atividades_fixas; drop policy if exists af2_del on public.atividades_fixas;
create policy af2_sel on public.atividades_fixas for select to authenticated using (is_active() and (analista_id=auth.uid() or is_viewer_all()));
create policy af2_ins on public.atividades_fixas for insert to authenticated with check (is_manager());
create policy af2_upd on public.atividades_fixas for update to authenticated using (is_manager()) with check (is_manager());
create policy af2_del on public.atividades_fixas for delete to authenticated using (is_manager());

-- tarefa do dia que nasceu de uma atividade fixa (uma por bloco/dia)
alter table public.daily_tasks add column if not exists fixa_id uuid references public.atividades_fixas(id) on delete set null;
create unique index if not exists daily_tasks_fixa_unica on public.daily_tasks(block_id, fixa_id) where fixa_id is not null;

-- Trava: quem não é Analista Sr só pode marcar/desmarcar (concluida). Não edita, não move, não exclui.
-- (sem usuário na sessão — rotinas do banco — a trava não se aplica)
create or replace function public.tg_task_fixa_lock() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.fixa_id is null or auth.uid() is null or is_manager() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'Atividade definida pelo gestor: não pode ser excluída.'; end if;
  if new.descricao is distinct from old.descricao or new.block_id is distinct from old.block_id or new.fixa_id is distinct from old.fixa_id
     or new.grupo is distinct from old.grupo or new.user_id is distinct from old.user_id then
    raise exception 'Atividade definida pelo gestor: só dá para marcar como feita.';
  end if;
  return new;
end $$;
drop trigger if exists task_fixa_lock_upd on public.daily_tasks; drop trigger if exists task_fixa_lock_del on public.daily_tasks;
create trigger task_fixa_lock_upd before update on public.daily_tasks for each row execute function public.tg_task_fixa_lock();
create trigger task_fixa_lock_del before delete on public.daily_tasks for each row execute function public.tg_task_fixa_lock();

-- Coloca na lista do dia p_data (já criado, com seus 5 blocos) as atividades fixas vigentes do usuário logado. Idempotente.
create or replace function public.fixas_incorporar(p_data date) returns int language plpgsql as $$
declare n int;
begin
  if p_data > (now() at time zone 'America/Fortaleza')::date then raise exception 'data no futuro'; end if;
  insert into daily_tasks(user_id, block_id, descricao, ordem, fixa_id)
    select f.analista_id, b.id, f.descricao, -1000 + (row_number() over (partition by b.id order by f.criado_em))::int, f.id
    from atividades_fixas f
    join daily_records r on r.user_id = f.analista_id and r.data = p_data
    join daily_blocks b on b.daily_record_id = r.id and b.numero = f.bloco_numero
    where f.analista_id = auth.uid() and f.ativa and f.data_inicio <= p_data and (f.data_fim is null or f.data_fim >= p_data)
      and extract(isodow from p_data)::int = any(f.dias)
    on conflict (block_id, fixa_id) where fixa_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- "Limpar lista do dia → excluir tudo" não apaga as atividades fixas (só o gestor as remove).
create or replace function public.dia_limpar(p_record uuid, p_modo text) returns int language plpgsql as $$
declare n int;
begin
  if p_modo not in ('desmarcar','excluir') then raise exception 'modo inválido'; end if;
  if not exists(select 1 from daily_records where id=p_record and user_id=auth.uid()) then raise exception 'dia não encontrado'; end if;
  insert into activity_archive(user_id,data,bloco_numero,bloco_nome,descricao,grupo,concluida_em)
    select t.user_id, r.data, b.numero, b.nome, t.descricao, t.grupo, t.concluida_em
    from daily_tasks t join daily_blocks b on b.id=t.block_id join daily_records r on r.id=b.daily_record_id
    where r.id=p_record and t.user_id=auth.uid() and t.concluida;
  get diagnostics n = row_count;
  if p_modo='excluir' then
    delete from daily_tasks t using daily_blocks b where b.id=t.block_id and b.daily_record_id=p_record and t.user_id=auth.uid() and t.fixa_id is null;
  else
    update daily_tasks t set concluida=false from daily_blocks b where b.id=t.block_id and b.daily_record_id=p_record and t.user_id=auth.uid() and t.concluida;
  end if;
  return n;
end $$;
