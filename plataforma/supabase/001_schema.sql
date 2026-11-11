-- Minha Jornada / Microentregas — Fase 1: banco de dados (Supabase / PostgreSQL)
-- Execute no SQL Editor do Supabase. Antes: Authentication > Providers > Email > desativar "Allow new users to sign up" (acesso só por convite).
-- Bootstrap do 1º gestor (após criar o usuário): update public.profiles set perfil='gestor' where email='SEU@EMAIL';

create extension if not exists pgcrypto;

-- ===== Perfis =====
create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null, email text not null,
  perfil text not null default 'analista' check (perfil in ('chefe_do_chefe','chefe','gestor','analista','guardiao')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now());

create function public.is_active() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo) $$;
create function public.is_manager() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil='gestor') $$;
-- Quem pode CONSULTAR as jornadas de todos (somente leitura) e os dados consolidados.
-- Administração (usuários, perfis, configuração global) continua exclusiva de is_manager().
create function public.is_viewer_all() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil in ('chefe_do_chefe','chefe','gestor')) $$;

-- perfil NUNCA vem do metadata do cliente: todo novo usuário nasce analista
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,nome,email) values(new.id,coalesce(new.raw_user_meta_data->>'nome',split_part(new.email,'@',1)),new.email); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== Configurações =====
create table public.app_settings(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,   -- null = configuração global
  atuacao_min int not null default 300 check (atuacao_min>=0),
  pausa_min int not null default 60 check (pausa_min>=0),
  reunioes_min int not null default 120 check (reunioes_min>=0),
  margem_min int not null default 108 check (margem_min>=0),
  jornada_min int generated always as (atuacao_min+pausa_min+reunioes_min+margem_min) stored,
  fuso text not null default 'America/Fortaleza');
create unique index app_settings_user on app_settings(user_id) where user_id is not null;
create unique index app_settings_global on app_settings((user_id is null)) where user_id is null;

-- modelos dos 5 blocos e tarefas (equivalem ao "cfg" do painel antigo)
create table public.block_templates(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  numero int not null check (numero between 1 and 5), nome text not null, cor text not null default '#12295a',
  duracao_min int not null default 60 check (duracao_min>0), objetivo text, unique(user_id,numero));
create table public.task_templates(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  block_template_id uuid not null references block_templates(id) on delete cascade,
  descricao text not null, grupo text, ordem int not null default 0);

-- ===== Jornada diária =====
create table public.daily_records(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  data date not null, config jsonb not null default '{}',          -- snapshot dos parâmetros da jornada no dia
  preparacao_proximo_dia text, criado_em timestamptz not null default now(), unique(user_id,data));
create table public.daily_blocks(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  daily_record_id uuid not null references daily_records(id) on delete cascade,
  numero int not null check (numero between 1 and 5), nome text not null,
  duracao_planejada_min int not null check (duracao_planejada_min>0),
  acumulado_seg int not null default 0,                -- tempo já fechado
  em_execucao_desde timestamptz,                       -- timestamp do cronômetro ativo (sobrevive a recarregar/fechar)
  iniciado_em timestamptz, finalizado_em timestamptz, observacoes text, unique(daily_record_id,numero));
create unique index um_cronometro_por_usuario on daily_blocks(user_id) where em_execucao_desde is not null;
create table public.daily_tasks(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  block_id uuid not null references daily_blocks(id) on delete cascade,
  descricao text not null, grupo text, ordem int not null default 0,
  concluida boolean not null default false, concluida_em timestamptz,
  idea_id uuid);                                       -- vínculo com a ideia de origem (FK abaixo)
create index on daily_tasks(block_id);

create function public.tg_task_done() returns trigger language plpgsql as $$
begin new.concluida_em := case when new.concluida and not old.concluida then now() when not new.concluida then null else old.concluida_em end; return new; end $$;
create trigger task_done before update of concluida on daily_tasks for each row execute function tg_task_done();

-- ===== Agenda, imprevistos, ideias =====
create table public.agenda(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  data date not null, horario time, duracao_min int not null default 0 check (duracao_min>=0), assunto text not null, observacoes text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index on agenda(user_id,data);
create table public.imprevistos(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  data date not null, descricao text not null,
  criticidade text not null check (criticidade in ('critica','alta','media','baixa')),
  estimativa_min int not null default 0 check (estimativa_min>=0),
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluido')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index on imprevistos(user_id,data);
create table public.ideas(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  titulo text not null, descricao text, prioridade text not null default 'media' check (prioridade in ('baixa','media','alta')),
  status text not null default 'nova' check (status in ('nova','aguardando','em_desenvolvimento','concluida','arquivada')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
alter table daily_tasks add constraint daily_tasks_idea_fk foreign key (idea_id) references ideas(id) on delete set null;

-- ===== Microentregas =====
create table public.microdeliveries(
  id uuid primary key default gen_random_uuid(),
  criticidade text not null check (criticidade in ('alta','media','baixa')),
  responsavel_id uuid not null references profiles(id),
  criado_por uuid not null default auth.uid() references profiles(id),
  demanda text not null check (length(trim(demanda))>0), resumo text,
  data_target date not null,
  quantidade int not null check (quantidade>0),
  a_iniciar int not null default 0 check (a_iniciar>=0), em_andamento int not null default 0 check (em_andamento>=0),
  concluido int not null default 0 check (concluido>=0), cancelado int not null default 0 check (cancelado>=0),
  observacoes text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  mes_referencia date generated always as (make_date(extract(year from data_target)::int, extract(month from data_target)::int, 1)) stored,
  constraint soma_confere check (a_iniciar+em_andamento+concluido+cancelado=quantidade));
create index on microdeliveries(responsavel_id); create index on microdeliveries(data_target); create index on microdeliveries(mes_referencia);

-- Status geral derivado (a=a iniciar, e=em andamento, c=concluído, x=cancelado, q=quantidade total).
-- Avaliado em ordem; a distribuição numérica das unidades é sempre preservada nas colunas.
--   cancelado          : TODAS as unidades canceladas (x = q)
--   concluido          : TODAS as unidades concluídas (c = q) — cancelamento parcial NUNCA conclui a entrega
--   concluido_parcial  : nada pendente nem em andamento, mas há concluídas E canceladas (c>0, x>0, a=e=0)
--   a_iniciar          : nenhuma unidade iniciada ou concluída (pode haver canceladas)
--   em_andamento       : qualquer outra combinação (há unidades em andamento, ou conclusão parcial com restantes)
create function public.md_status(a int,e int,c int,x int,q int) returns text language sql immutable as $$
 select case
   when x=q then 'cancelado'
   when c=q then 'concluido'
   when a=0 and e=0 then 'concluido_parcial'
   when e=0 and c=0 then 'a_iniciar'
   else 'em_andamento' end $$;

create view public.v_microdeliveries with (security_invoker=true) as
select m.*, p.nome as responsavel_nome, md_status(a_iniciar,em_andamento,concluido,cancelado,quantidade) as status_geral,
  (data_target < (now() at time zone 'America/Fortaleza')::date and a_iniciar+em_andamento>0) as atrasada,
  case when quantidade-cancelado=0 then null else round(100.0*concluido/(quantidade-cancelado)) end as pct_conclusao
from microdeliveries m join profiles p on p.id=m.responsavel_id;

create table public.microdelivery_history(
  id bigint generated always as identity primary key,
  microdelivery_id uuid not null references microdeliveries(id) on delete restrict,
  usuario_id uuid references profiles(id), campo_alterado text not null, valor_anterior text, valor_novo text,
  data_hora timestamptz not null default now());
create index on microdelivery_history(microdelivery_id, data_hora desc);

create function public.md_before_update() returns trigger language plpgsql security definer set search_path=public as $$
declare k text; o jsonb:=to_jsonb(old); n jsonb:=to_jsonb(new); so text; sn text;
begin
  new.atualizado_em := now();
  foreach k in array array['criticidade','responsavel_id','demanda','resumo','data_target','quantidade','a_iniciar','em_andamento','concluido','cancelado','observacoes'] loop
    if o->k is distinct from n->k then
      insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_anterior,valor_novo) values(old.id,auth.uid(),k,o->>k,n->>k);
    end if;
  end loop;
  so:=md_status(old.a_iniciar,old.em_andamento,old.concluido,old.cancelado,old.quantidade);
  sn:=md_status(new.a_iniciar,new.em_andamento,new.concluido,new.cancelado,new.quantidade);
  if so<>sn then insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_anterior,valor_novo) values(old.id,auth.uid(),'status_geral',so,sn); end if;
  return new;
end $$;
create trigger md_bu before update on microdeliveries for each row execute function md_before_update();
create function public.md_after_insert() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_novo) values(new.id,auth.uid(),'criacao',new.demanda);
  if new.concluido>0 then insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_anterior,valor_novo) values(new.id,auth.uid(),'concluido','0',new.concluido::text); end if;
  return new;
end $$;
create trigger md_ai after insert on microdeliveries for each row execute function md_after_insert();

-- mover unidades entre status de forma atômica (evita perda de atualização com 2 usuários simultâneos)
create function public.md_mover(p_id uuid,p_de text,p_para text,p_qtd int,p_obs text default null) returns microdeliveries language plpgsql as $$
declare r microdeliveries; cols text[]:=array['a_iniciar','em_andamento','concluido','cancelado'];
begin
  if not (p_de=any(cols) and p_para=any(cols)) or p_de=p_para or p_qtd<=0 then raise exception 'parâmetros inválidos'; end if;
  select * into r from microdeliveries where id=p_id for update;
  if not found then raise exception 'microentrega não encontrada'; end if;
  if (to_jsonb(r)->>p_de)::int < p_qtd then raise exception 'unidades insuficientes em %', p_de; end if;
  execute format('update microdeliveries set %I=%I-$1, %I=%I+$1, observacoes=coalesce($2,observacoes) where id=$3 returning *',p_de,p_de,p_para,p_para)
    into r using p_qtd,p_obs,p_id;
  return r;
end $$;

-- ===== Cronômetro por timestamps (um único bloco ativo por usuário) =====
create function public.bloco_iniciar(p uuid) returns void language plpgsql as $$
begin
  update daily_blocks set acumulado_seg=acumulado_seg+extract(epoch from now()-em_execucao_desde)::int, em_execucao_desde=null
    where user_id=auth.uid() and em_execucao_desde is not null;
  update daily_blocks set em_execucao_desde=now(), iniciado_em=coalesce(iniciado_em,now()), finalizado_em=null where id=p and user_id=auth.uid();
  if not found then raise exception 'bloco não encontrado'; end if;
end $$;
create function public.bloco_parar(p uuid, p_finalizar boolean default false) returns void language plpgsql as $$
begin
  update daily_blocks set acumulado_seg=acumulado_seg+coalesce(extract(epoch from now()-em_execucao_desde)::int,0), em_execucao_desde=null,
    finalizado_em=case when p_finalizar then now() else finalizado_em end where id=p and user_id=auth.uid();
  if not found then raise exception 'bloco não encontrado'; end if;
end $$;

-- resumo diário calculado pelas TAREFAS marcadas (não pelos cronômetros). Dia sem registro = sem linha (nunca 0%).
create view public.v_resumo_diario with (security_invoker=true) as
select r.user_id, r.data, x.total, x.concluidas,
  case when x.total=0 then null else round(100.0*x.concluidas/x.total) end as pct_execucao, y.seg as tempo_trabalhado_seg
from daily_records r
cross join lateral (select count(*) total, count(*) filter (where t.concluida) concluidas from daily_tasks t join daily_blocks b on b.id=t.block_id where b.daily_record_id=r.id) x
cross join lateral (select coalesce(sum(acumulado_seg+case when em_execucao_desde is not null then extract(epoch from now()-em_execucao_desde)::int else 0 end),0)::int seg from daily_blocks where daily_record_id=r.id) y;

-- ===== Auditoria geral =====
create table public.audit_log(
  id bigint generated always as identity primary key, tabela text not null, registro_id uuid, usuario_id uuid,
  acao text not null, antes jsonb, depois jsonb, em timestamptz not null default now());
create function public.log_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into audit_log(tabela,registro_id,usuario_id,acao,antes,depois) values(tg_table_name,
    coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id')::uuid, auth.uid(), tg_op,
    case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','app_settings','ideas','agenda','imprevistos','microdeliveries'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function log_audit()',t);
  end loop; end $$;

-- marca de edição (a auditoria completa, com antes/depois, fica em audit_log)
create function public.touch_updated() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create trigger touch_ideas before update on ideas for each row execute function touch_updated();
create trigger touch_agenda before update on agenda for each row execute function touch_updated();
create trigger touch_imprevistos before update on imprevistos for each row execute function touch_updated();

-- ===== RLS =====
alter table profiles enable row level security;
create policy pf_sel on profiles for select to authenticated using (is_active() or id=auth.uid());
create policy pf_upd on profiles for update to authenticated using (is_manager()) with check (is_manager());   -- só gestor altera perfil/ativo

alter table microdeliveries enable row level security;
create policy md_sel on microdeliveries for select to authenticated using (is_active());
create policy md_ins on microdeliveries for insert to authenticated
  with check (is_active() and criado_por=auth.uid() and exists(select 1 from profiles where id=responsavel_id and ativo));
create policy md_upd on microdeliveries for update to authenticated
  using (is_active()) with check (is_active() and exists(select 1 from profiles where id=responsavel_id and ativo));
-- sem policy de DELETE: entregas não são apagadas (use cancelado), preservando o histórico

alter table microdelivery_history enable row level security;
create policy mh_sel on microdelivery_history for select to authenticated using (is_active());   -- gravação só pelos triggers
alter table audit_log enable row level security;
create policy al_sel on audit_log for select to authenticated using (is_manager());

alter table app_settings enable row level security;
create policy st_sel on app_settings for select to authenticated using (is_active() and (user_id is null or user_id=auth.uid()));
create policy st_wr on app_settings for all to authenticated
  using (is_active() and ((user_id is null and is_manager()) or user_id=auth.uid()))
  with check (is_active() and ((user_id is null and is_manager()) or user_id=auth.uid()));

-- Jornada individual (registros, blocos, tarefas, agenda, imprevistos, ideias):
--   LEITURA : o próprio dono, ou chefe_do_chefe / chefe / gestor (is_viewer_all) — consulta de todas as jornadas
--   ESCRITA : SOMENTE o dono. Ninguém (nem gestor) altera a jornada de outra pessoa.
do $$ declare t text; begin
  foreach t in array array['daily_records','daily_blocks','daily_tasks','agenda','imprevistos','ideas','block_templates','task_templates'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy j_sel on %I for select to authenticated using (is_active() and (user_id=auth.uid() or is_viewer_all()))',t);
    execute format('create policy j_ins on %I for insert to authenticated with check (user_id=auth.uid() and is_active())',t);
    execute format('create policy j_upd on %I for update to authenticated using (user_id=auth.uid() and is_active()) with check (user_id=auth.uid() and is_active())',t);
    execute format('create policy j_del on %I for delete to authenticated using (user_id=auth.uid() and is_active())',t);
  end loop; end $$;

-- ===== Realtime =====
alter publication supabase_realtime add table microdeliveries;
alter publication supabase_realtime add table microdelivery_history;
