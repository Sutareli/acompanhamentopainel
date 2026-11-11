-- MIGRAÇÃO 002 — para quem JÁ executou o 001 antigo (banco em produção). NÃO execute em instalação nova (use só o 001).
-- 1) Renomeia os perfis: chefe_do_chefe → diretor · chefe → gerente · gestor → analista_sr (analista e guardiao não mudam)
-- 2) Atualiza as funções usadas pelo RLS (is_manager / is_viewer_all)
-- 3) Cria o arquivo de atividades concluídas, a view v_atividades e a função dia_limpar
-- Seguro para rodar uma vez, dentro de uma transação. Faça um backup antes (veja o README).
begin;

-- 1) perfis ------------------------------------------------------------------------------------------------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%perfil%' loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;
update public.profiles set perfil = case perfil when 'chefe_do_chefe' then 'diretor' when 'chefe' then 'gerente' when 'gestor' then 'analista_sr' else perfil end;
alter table public.profiles add constraint profiles_perfil_check check (perfil in ('diretor','gerente','analista_sr','analista','guardiao'));

-- 2) funções de permissão (as policies já existentes passam a usá-las automaticamente) ------------------------
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil='analista_sr') $$;
create or replace function public.is_viewer_all() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil in ('diretor','gerente','analista_sr')) $$;

-- 3) arquivo de atividades, view e limpeza do dia -------------------------------------------------------------
-- Quando o usuário "limpa" o dia (dia_limpar), as atividades JÁ CONCLUÍDAS são arquivadas aqui antes de serem
-- desmarcadas/excluídas, para o histórico de atividades nunca perder o que foi realizado.
create table public.activity_archive(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  data date not null, bloco_numero int, bloco_nome text, descricao text not null, grupo text,
  concluida_em timestamptz, arquivada_em timestamptz not null default now());
create index on activity_archive(user_id, data);

-- Histórico de atividades concluídas = tarefas concluídas dos dias + as arquivadas na limpeza.
create view public.v_atividades with (security_invoker=true) as
select t.user_id, r.data, b.numero as bloco_numero, b.nome as bloco_nome, t.descricao, t.grupo, t.concluida_em, 'dia'::text as origem
  from daily_tasks t join daily_blocks b on b.id=t.block_id join daily_records r on r.id=b.daily_record_id where t.concluida
union all
select user_id, data, bloco_numero, bloco_nome, descricao, grupo, concluida_em, 'arquivada'::text from activity_archive;

-- Limpa o dia do usuário logado. p_modo: 'desmarcar' (mantém a lista, remove as marcações) ou 'excluir' (apaga todas as tarefas).
-- Em ambos, as tarefas concluídas são arquivadas antes. Atômico (uma transação).
create function public.dia_limpar(p_record uuid, p_modo text) returns int language plpgsql as $$
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
    delete from daily_tasks t using daily_blocks b where b.id=t.block_id and b.daily_record_id=p_record and t.user_id=auth.uid();
  else
    update daily_tasks t set concluida=false from daily_blocks b where b.id=t.block_id and b.daily_record_id=p_record and t.user_id=auth.uid() and t.concluida;
  end if;
  return n;
end $$;


alter table activity_archive enable row level security;
create policy j_sel on activity_archive for select to authenticated using (is_active() and (user_id=auth.uid() or is_viewer_all()));
create policy j_ins on activity_archive for insert to authenticated with check (user_id=auth.uid() and is_active());
create policy j_upd on activity_archive for update to authenticated using (user_id=auth.uid() and is_active()) with check (user_id=auth.uid() and is_active());
create policy j_del on activity_archive for delete to authenticated using (user_id=auth.uid() and is_active());

commit;
