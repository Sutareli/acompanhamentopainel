-- Gestão de atividades — banco de dados (Supabase / PostgreSQL). Instalação nova: execute só este arquivo.
-- Execute no SQL Editor do Supabase. Antes: Authentication > Providers > Email > desativar "Allow new users to sign up" (acesso só por convite).
-- Bootstrap do 1º administrador (após criar o usuário): update public.profiles set perfil='analista_sr' where email='SEU@EMAIL';
-- Perfis: diretor, gerente, analista_sr (consulta a todas as jornadas; só analista_sr administra), analista, guardiao.

create extension if not exists pgcrypto;

-- ===== Perfis =====
create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null, email text not null,
  perfil text not null default 'analista' check (perfil in ('diretor','gerente','analista_sr','analista','guardiao')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now());

create function public.is_active() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo) $$;
create function public.is_manager() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil='analista_sr') $$;
-- Quem pode CONSULTAR as jornadas de todos (somente leitura) e os dados consolidados.
-- Administração (usuários, perfis, configuração global) continua exclusiva de is_manager().
create function public.is_viewer_all() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil in ('diretor','gerente','analista_sr')) $$;

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
  tipo_projeto text not null default 'micro' check (tipo_projeto in ('macro','micro')),   -- MacroProjeto / MicroProjeto
  com_quem_id uuid references profiles(id),                                                 -- com quem o projeto está agora (MacroProjetos)
  constraint soma_confere check (a_iniciar+em_andamento+concluido+cancelado=quantidade));
create index on microdeliveries(tipo_projeto); create index on microdeliveries(responsavel_id); create index on microdeliveries(data_target); create index on microdeliveries(mes_referencia);

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
select m.*, p.nome as responsavel_nome, c.nome as com_quem_nome, md_status(a_iniciar,em_andamento,concluido,cancelado,quantidade) as status_geral,
  (data_target < (now() at time zone 'America/Fortaleza')::date and a_iniciar+em_andamento>0) as atrasada,
  case when quantidade-cancelado=0 then null else round(100.0*concluido/(quantidade-cancelado)) end as pct_conclusao
from microdeliveries m join profiles p on p.id=m.responsavel_id left join profiles c on c.id=m.com_quem_id;

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
  foreach k in array array['criticidade','responsavel_id','demanda','resumo','data_target','quantidade','a_iniciar','em_andamento','concluido','cancelado','observacoes','tipo_projeto','com_quem_id'] loop
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

-- ===== Arquivo de atividades concluídas =====
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
create policy pf_upd on profiles for update to authenticated using (is_manager()) with check (is_manager());   -- só analista_sr altera perfil/ativo

alter table microdeliveries enable row level security;
create policy md_sel on microdeliveries for select to authenticated using (is_active());
create policy md_ins on microdeliveries for insert to authenticated
  with check (is_active() and criado_por=auth.uid() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));
create policy md_upd on microdeliveries for update to authenticated
  using (is_active()) with check (is_active() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));
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
--   LEITURA : o próprio dono, ou diretor / gerente / analista_sr (is_viewer_all) — consulta de todas as jornadas
--   ESCRITA : SOMENTE o dono. Ninguém (nem analista_sr) altera a jornada de outra pessoa.
do $$ declare t text; begin
  foreach t in array array['daily_records','daily_blocks','daily_tasks','agenda','imprevistos','ideas','block_templates','task_templates','activity_archive'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy j_sel on %I for select to authenticated using (is_active() and (user_id=auth.uid() or is_viewer_all()))',t);
    execute format('create policy j_ins on %I for insert to authenticated with check (user_id=auth.uid() and is_active())',t);
    execute format('create policy j_upd on %I for update to authenticated using (user_id=auth.uid() and is_active()) with check (user_id=auth.uid() and is_active())',t);
    execute format('create policy j_del on %I for delete to authenticated using (user_id=auth.uid() and is_active())',t);
  end loop; end $$;

-- ===== Backlog de Melhorias (ideias, correções e melhorias solicitadas pelo time) =====
-- Leitura: todos os usuários ativos. Criar: qualquer usuário ativo. Editar: quem criou OU diretor/gerente/analista_sr.
-- Excluir: somente analista_sr (administração). Toda alteração é registrada em audit_log (antes/depois).
create table public.backlog_melhorias(
  id uuid primary key default gen_random_uuid(),
  modulo text not null check (length(trim(modulo)) > 0),          -- ex.: Gestão Executiva, Tabelas, Meus Feedback, Todos os módulos
  melhoria text not null check (length(trim(melhoria)) > 0),       -- nome curto
  descricao text, descricao_detalhada text,                        -- o que é / explicação aprofundada
  objetivo text, objetivo_detalhado text,                          -- benefício esperado / impacto operacional
  as_is text, to_be text,                                          -- cenário atual / cenário futuro
  prioridade int not null default 3 check (prioridade >= 1),       -- 1 = mais alta
  status text not null default 'A Iniciar' check (status in ('A Iniciar','Em andamento','Concluído','Atrasado','Novo Prazo')),
  percentual_concluido numeric(5,2) not null default 0 check (percentual_concluido between 0 and 100),
  responsavel text,
  data_inicio date, data_termino date,
  observacoes text,
  criado_por uuid default auth.uid() references profiles(id) on delete set null,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint bl_datas check (data_inicio is null or data_termino is null or data_termino >= data_inicio),
  constraint bl_concluido_100 check (status <> 'Concluído' or percentual_concluido = 100));
create index on backlog_melhorias(status);
create index on backlog_melhorias(modulo);
create trigger touch_backlog before update on backlog_melhorias for each row execute function touch_updated();
create trigger audit_backlog_melhorias after insert or update or delete on backlog_melhorias for each row execute function log_audit();

alter table backlog_melhorias enable row level security;
create policy bl_sel on backlog_melhorias for select to authenticated using (is_active());
create policy bl_ins on backlog_melhorias for insert to authenticated with check (is_active() and criado_por = auth.uid());
create policy bl_upd on backlog_melhorias for update to authenticated
  using (is_active() and (criado_por = auth.uid() or is_viewer_all()))
  with check (is_active() and (criado_por = auth.uid() or is_viewer_all()));
create policy bl_del on backlog_melhorias for delete to authenticated using (is_manager());

-- ===== Backlog: ETAPAS (o "COMO?" de cada atividade) e HISTÓRICO de mudanças =====
-- Cada melhoria (O QUE?) pode ter várias etapas (COMO?), cada uma com responsável, início, término, novo prazo,
-- prazo realizado, % concluído, status e observações — como na planilha de plano de ação.
-- Quando a melhoria TEM etapas, o status e o % da melhoria passam a ser CALCULADOS a partir das etapas (bl_rollup).
create table public.backlog_etapas(
  id uuid primary key default gen_random_uuid(),
  melhoria_id uuid not null references backlog_melhorias(id) on delete cascade,
  ordem int not null default 0,
  como text not null check (length(trim(como)) > 0),
  responsavel text,
  data_inicio date, data_termino date, novo_prazo date, prazo_realizado date,
  percentual_concluido numeric(5,2) not null default 0 check (percentual_concluido between 0 and 100),
  status text not null default 'A Iniciar' check (status in ('A Iniciar','Em andamento','Concluído','Atrasado','Novo Prazo')),
  observacoes text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint be_datas check (data_inicio is null or data_termino is null or data_termino >= data_inicio),
  constraint be_novo_prazo check (novo_prazo is null or data_termino is null or novo_prazo >= data_termino),
  constraint be_concluido_100 check (status <> 'Concluído' or percentual_concluido = 100));
create index on backlog_etapas(melhoria_id);
create trigger touch_backlog_etapas before update on backlog_etapas for each row execute function touch_updated();
create trigger audit_backlog_etapas after insert or update or delete on backlog_etapas for each row execute function log_audit();

-- Histórico: uma linha por mudança relevante (status, %, prazos, responsável, criação/exclusão). Gravado só por triggers.
create table public.backlog_historico(
  id bigint generated always as identity primary key,
  melhoria_id uuid not null,            -- sem FK de propósito: o histórico sobrevive à exclusão (a cópia completa também fica em audit_log)
  etapa_id uuid, etapa_nome text,       -- nulo = mudança na atividade inteira
  usuario_id uuid default auth.uid(),
  campo text not null,                  -- status | percentual_concluido | prioridade | responsavel | data_inicio | data_termino | novo_prazo | prazo_realizado | criacao | exclusao
  valor_anterior text, valor_novo text,
  data_hora timestamptz not null default now());
create index on backlog_historico(melhoria_id, data_hora desc);

create function public.bl_hist() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid; eid uuid; enome text; cols text[]; c text; o jsonb; n jsonb;
begin
  o := case when tg_op<>'INSERT' then to_jsonb(old) end; n := case when tg_op<>'DELETE' then to_jsonb(new) end;
  if tg_table_name='backlog_melhorias' then
    mid := coalesce(new.id, old.id); eid := null;
    cols := array['status','percentual_concluido','prioridade','responsavel','data_inicio','data_termino'];
    enome := null;
    if tg_op='DELETE' then return null; end if;    -- a exclusão da atividade fica no audit_log
  else
    mid := coalesce(new.melhoria_id, old.melhoria_id); eid := coalesce(new.id, old.id);
    cols := array['status','percentual_concluido','responsavel','data_inicio','data_termino','novo_prazo','prazo_realizado'];
    enome := coalesce(n->>'como', o->>'como');
    if tg_op='DELETE' and not exists(select 1 from backlog_melhorias where id=mid) then return null; end if;   -- exclusão em cascata
  end if;
  if tg_op='INSERT' then
    insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_novo) values (mid,eid,enome,'criacao',coalesce(n->>'melhoria',n->>'como'));
  elsif tg_op='DELETE' then
    insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_anterior) values (mid,eid,enome,'exclusao',enome);
  else
    foreach c in array cols loop
      if o->>c is distinct from n->>c then
        insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_anterior,valor_novo) values (mid,eid,enome,c,o->>c,n->>c);
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger hist_backlog_melhorias after insert or update or delete on backlog_melhorias for each row execute function bl_hist();
create trigger hist_backlog_etapas after insert or update or delete on backlog_etapas for each row execute function bl_hist();

-- Roll-up: com etapas, a melhoria reflete o conjunto delas.
--   Concluído = todas concluídas · Atrasado = alguma atrasada · Novo Prazo = alguma com novo prazo
--   Em andamento = alguma em andamento/concluída ou % > 0 · senão A Iniciar.  % = média dos % das etapas.
create function public.bl_rollup() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid := coalesce(new.melhoria_id, old.melhoria_id); n int; pct numeric; st text;
begin
  select count(*), round(avg(percentual_concluido),2),
    case when bool_and(status='Concluído') then 'Concluído'
         when bool_or(status='Atrasado') then 'Atrasado'
         when bool_or(status='Novo Prazo') then 'Novo Prazo'
         when bool_or(status in ('Em andamento','Concluído')) or avg(percentual_concluido) > 0 then 'Em andamento'
         else 'A Iniciar' end
    into n, pct, st from backlog_etapas where melhoria_id=mid;
  if n = 0 then return null; end if;   -- sem etapas: valores manuais
  if st = 'Concluído' then pct := 100; end if;
  perform set_config('app.bl_rollup','1',true);
  update backlog_melhorias set status=st, percentual_concluido=pct where id=mid and (status, percentual_concluido) is distinct from (st, pct);
  perform set_config('app.bl_rollup','',true);
  return null;
end $$;
create trigger rollup_backlog_etapas after insert or update or delete on backlog_etapas for each row execute function bl_rollup();

-- Proteção: com etapas, status/% da melhoria NÃO podem ser alterados à mão (só pelo roll-up).
create function public.bl_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.bl_rollup', true),'') <> '1' and exists(select 1 from backlog_etapas where melhoria_id=new.id) then
    new.status := old.status; new.percentual_concluido := old.percentual_concluido;
  end if;
  return new;
end $$;
create trigger guard_backlog_melhorias before update on backlog_melhorias for each row execute function bl_guard();

alter table backlog_etapas enable row level security;
create policy be_sel on backlog_etapas for select to authenticated using (is_active());
create policy be_ins on backlog_etapas for insert to authenticated with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or is_viewer_all())));
create policy be_upd on backlog_etapas for update to authenticated
  using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or is_viewer_all())))
  with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or is_viewer_all())));
create policy be_del on backlog_etapas for delete to authenticated using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or is_viewer_all())));
alter table backlog_historico enable row level security;
create policy bh_sel on backlog_historico for select to authenticated using (is_active());   -- gravação só pelos triggers

-- ===== Pareto backlog: base de CHAMADOS (importada da planilha "base") =====
-- Somente leitura para todos os usuários ativos; a carga (substituição completa da base) é exclusiva do Analista Sr, via função.
create table public.backlog_chamados(
  id uuid primary key default gen_random_uuid(),
  id_chamado text,                      -- coluna "ID" da planilha (pode repetir; não é chave)
  data_identificacao date,
  data_ref date not null,               -- data de referência (ANO_REF + MÊS_REF + DIA da planilha); define mês e dia nos painéis
  categoria text, subcategoria text, tipo text,
  item_sintoma text, sistema_ofensor text, cliente text, site text, status text,
  prazo text,                           -- "Dentro do prazo" | "Fora do prazo" | nulo (coluna TRATADO DENTRO DO PRAZO?)
  importado_em timestamptz not null default now());
create index on backlog_chamados(data_ref);
create table public.backlog_chamados_carga(
  id bigint generated always as identity primary key,
  usuario_id uuid default auth.uid(), qtd int not null, em timestamptz not null default now());

alter table backlog_chamados enable row level security;
create policy bc_sel on backlog_chamados for select to authenticated using (is_active());   -- sem policy de escrita: só a função abaixo grava
alter table backlog_chamados_carga enable row level security;
create policy bcc_sel on backlog_chamados_carga for select to authenticated using (is_active());

create function public.chamados_substituir(p_rows jsonb) returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode importar a base de chamados.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nenhuma linha para importar.'; end if;
  delete from backlog_chamados where true;
  insert into backlog_chamados(id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo)
    select id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo
    from jsonb_to_recordset(p_rows) as x(id_chamado text,data_identificacao date,data_ref date,categoria text,subcategoria text,tipo text,item_sintoma text,sistema_ofensor text,cliente text,site text,status text,prazo text);
  get diagnostics n = row_count;
  insert into backlog_chamados_carga(qtd) values (n);
  return n;
end $$;
revoke all on function public.chamados_substituir(jsonb) from public, anon;
grant execute on function public.chamados_substituir(jsonb) to authenticated;

-- ===== Atividades futuras: agendadas por bloco para outras datas =====
-- Ficam em tabela própria: "Limpar lista do dia" NÃO as remove. Na data alvo, futuras_incorporar() as coloca na lista do dia (uma única vez).
create table public.atividades_futuras(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  bloco_numero int not null check (bloco_numero between 1 and 5),
  data_alvo date not null,
  descricao text not null check (length(trim(descricao))>0),
  incorporada_em timestamptz,
  criado_em timestamptz not null default now());
create index on atividades_futuras(user_id, data_alvo);
alter table public.daily_tasks add column futura_id uuid references atividades_futuras(id) on delete set null;   -- origem (não é copiada para o dia seguinte)

alter table atividades_futuras enable row level security;
create policy af_sel on atividades_futuras for select to authenticated using (is_active() and (user_id=auth.uid() or is_viewer_all()));
create policy af_ins on atividades_futuras for insert to authenticated with check (user_id=auth.uid() and is_active());
create policy af_upd on atividades_futuras for update to authenticated using (user_id=auth.uid() and is_active()) with check (user_id=auth.uid() and is_active());
create policy af_del on atividades_futuras for delete to authenticated using (user_id=auth.uid() and is_active());

-- Coloca na lista do dia p_data (já criado, com seus 5 blocos) as futuras com data alvo <= p_data. Atômica: duas abas não duplicam.
create function public.futuras_incorporar(p_data date) returns int language plpgsql as $$
declare n int;
begin
  if p_data > (now() at time zone 'America/Fortaleza')::date then raise exception 'data no futuro'; end if;
  with mov as (
    update atividades_futuras f set incorporada_em=now()
     where f.user_id=auth.uid() and f.incorporada_em is null and f.data_alvo<=p_data
       and exists(select 1 from daily_records r join daily_blocks b on b.daily_record_id=r.id where r.user_id=f.user_id and r.data=p_data and b.numero=f.bloco_numero)
    returning f.id, f.user_id, f.bloco_numero, f.descricao, f.data_alvo, f.criado_em)
  insert into daily_tasks(user_id,block_id,descricao,ordem,futura_id)
    select m.user_id, b.id, m.descricao,
           coalesce((select max(t.ordem)+1 from daily_tasks t where t.block_id=b.id),0) + row_number() over (partition by b.id order by m.data_alvo, m.criado_em) - 1, m.id
    from mov m join daily_records r on r.user_id=m.user_id and r.data=p_data join daily_blocks b on b.daily_record_id=r.id and b.numero=m.bloco_numero;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===== Realtime =====
alter publication supabase_realtime add table microdeliveries;
alter publication supabase_realtime add table microdelivery_history;
