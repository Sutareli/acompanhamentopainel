-- 028 · Módulo "Semanal Italo": reunião semanal com o diretor, conduzida por blocos (Básico, Implantações, Melhorias e customizações,
-- Atualização das atividades, Próximos passos), com textos, imagens e marcação do que já foi visto. Rode depois da 027.
-- Visível e editável SOMENTE pelo dono (Analista Sr). As imagens ficam dentro do próprio registro (já reduzidas pelo navegador).
begin;
create table if not exists public.semanais(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  titulo text not null default 'Semanal Italo' check (length(trim(titulo)) between 1 and 200),
  data_reuniao date not null default current_date,
  blocos jsonb not null default '[]'::jsonb check (jsonb_typeof(blocos) = 'array' and length(blocos::text) <= 12000000),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index if not exists semanais_user_data on public.semanais(user_id, data_reuniao desc);
alter table public.semanais enable row level security;
drop policy if exists sem_sel on public.semanais; drop policy if exists sem_ins on public.semanais; drop policy if exists sem_upd on public.semanais; drop policy if exists sem_del on public.semanais;
create policy sem_sel on public.semanais for select to authenticated using ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_ins on public.semanais for insert to authenticated with check ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_upd on public.semanais for update to authenticated using ((select is_manager()) and user_id = (select auth.uid())) with check ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_del on public.semanais for delete to authenticated using ((select is_manager()) and user_id = (select auth.uid()));
revoke all on public.semanais from anon;
drop trigger if exists touch_semanais on public.semanais;
create trigger touch_semanais before update on public.semanais for each row execute function touch_updated();
commit;
