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
  criticidade text not null check (criticidade in ('alta','media','baixa','recorrente')),
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
  microdelivery_id uuid not null references microdeliveries(id) on delete cascade,
  usuario_id uuid references profiles(id) on delete set null, campo_alterado text not null, valor_anterior text, valor_novo text,
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
-- DELETE: criador ou Analista Sr (policy md_del, ao final do arquivo); a cópia fica em audit_log

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
  importado_em timestamptz not null default now(),
  responsavel text,                     -- coluna RESPONSÁVEL (quem trata: Almawave, MIS Qualidade, NeoSyx, Beedoo…)
  empresa_responsavel text,             -- coluna Empresa Responsável (Almawave | Almaviva | Outros)
  responsavel_rocco text,               -- coluna RESPONSÁVEL ROCCO (pessoa da equipe)
  fase text);                           -- coluna FASE
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
  insert into backlog_chamados(id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase)
    select id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase
    from jsonb_to_recordset(p_rows) as x(id_chamado text,data_identificacao date,data_ref date,categoria text,subcategoria text,tipo text,item_sintoma text,sistema_ofensor text,cliente text,site text,status text,prazo text,responsavel text,empresa_responsavel text,responsavel_rocco text,fase text);
  get diagnostics n = row_count;
  insert into backlog_chamados_carga(qtd) values (n);
  perform chamados_sincronizar();   -- chamados válidos viram/atualizam atividades do Backlog
  return n;
end $$;
revoke all on function public.chamados_substituir(jsonb) from public, anon;
grant execute on function public.chamados_substituir(jsonb) to authenticated;

-- ===== Chamados da base alimentam o Backlog de Melhorias =====
-- Cada chamado VÁLIDO da base (A iniciar, Em andamento, Suspenso ou Concluído; Cancelado e Improcedente ficam de fora) vira uma atividade
-- do Backlog (origem 'chamado'). Status: A iniciar→A Iniciar · Em andamento→Em andamento · Concluído→Concluído (100%) · Suspenso→Novo Prazo.
-- Ao reimportar a base: chamados novos viram atividades; atividades já existentes só mudam de status se o STATUS DO CHAMADO mudou na base
-- (edições, etapas e histórico feitos no Backlog são preservados); nada é apagado.
alter table public.backlog_melhorias
  add column origem text not null default 'manual' check (origem in ('manual','chamado')),
  add column chamado_chave text,
  add column chamado_status text;
create unique index backlog_melhorias_chamado_chave_uq on backlog_melhorias(chamado_chave);

create function public.chamados_sincronizar() returns void language plpgsql security definer set search_path=public as $$
begin
  perform set_config('app.sync','1',true);   -- libera a gravação de origem/chamado_chave (protegidas contra edição pelos usuários)
  drop table if exists _ch;
  create temp table _ch on commit drop as
  select x.*,
    regexp_replace(x.status,'^\s*\d+\s*-\s*','') as st_norm,
    case when x.status ~* 'conclu' then 'Concluído' when x.status ~* 'andamento' then 'Em andamento'
         when x.status ~* 'suspens' then 'Novo Prazo' else 'A Iniciar' end as st_mel
  from (select c.*, concat_ws('|', coalesce(c.id_chamado,''), c.data_ref::text,
          md5(coalesce(c.item_sintoma,'')||'|'||coalesce(c.cliente,'')||'|'||coalesce(c.subcategoria,'')))
          || '#' || row_number() over (partition by coalesce(c.id_chamado,''), c.data_ref,
               md5(coalesce(c.item_sintoma,'')||'|'||coalesce(c.cliente,'')||'|'||coalesce(c.subcategoria,'')) order by c.id) as chave
        from backlog_chamados c) x
  where x.status is not null and x.status ~* '(a iniciar|andamento|suspens|conclu)' and x.status !~* '(cancel|improced)';

  insert into backlog_melhorias(modulo, melhoria, descricao, prioridade, status, percentual_concluido, responsavel, data_inicio, criado_por, origem, chamado_chave, chamado_status)
  select coalesce(nullif(trim(categoria),''),'Chamados'),
         left(coalesce(nullif(trim(item_sintoma),''), nullif(trim(subcategoria),''), 'Chamado '||coalesce(id_chamado,'s/n')), 200),
         concat_ws(' · ', 'Chamado '||nullif(id_chamado,''), nullif(trim(cliente),''), nullif(trim(site),''), nullif(trim(subcategoria),'')),
         3, st_mel, case when st_mel='Concluído' then 100 else 0 end,
         coalesce(nullif(trim(responsavel_rocco),''), nullif(trim(empresa_responsavel),'')),
         coalesce(data_ref, data_identificacao), auth.uid(), 'chamado', chave, st_norm
  from _ch
  on conflict (chamado_chave) do nothing;

  update backlog_melhorias m
     set status = c.st_mel,
         percentual_concluido = case when c.st_mel='Concluído' then 100 when m.percentual_concluido = 100 then 0 else m.percentual_concluido end,
         chamado_status = c.st_norm
    from _ch c
   where m.chamado_chave = c.chave and m.chamado_status is distinct from c.st_norm;
  perform set_config('app.sync','',true);
  drop table if exists _ch;
end $$;
revoke all on function public.chamados_sincronizar() from public, anon, authenticated;

-- ===== Data de conclusão das atividades (filtro "Data de finalização" do Backlog) — migração 009 =====
-- Preenchida automaticamente quando a atividade passa a Concluído (e limpa se sair de Concluído); também pode ser informada à mão.
-- Chamados da base NÃO recebem data automática: a planilha não traz data de conclusão (informe à mão, se quiser).
alter table public.backlog_melhorias add column data_conclusao date;
create index on public.backlog_melhorias(data_inicio);
create index on public.backlog_melhorias(data_conclusao);
create function public.bl_conclusao() returns trigger language plpgsql as $$
begin
  if new.status = 'Concluído' then
    if tg_op = 'INSERT' or old.status is distinct from 'Concluído' then
      if new.data_conclusao is null and coalesce(new.origem,'manual') <> 'chamado' then new.data_conclusao := (now() at time zone 'America/Sao_Paulo')::date; end if;
    end if;
  else
    new.data_conclusao := null;
  end if;
  return new;
end $$;
create trigger zz_conclusao_backlog_melhorias before insert or update on public.backlog_melhorias for each row execute function bl_conclusao();

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

-- ===== Excluir projetos e usuários — migração 011 =====
create policy md_del on public.microdeliveries for delete to authenticated using (is_active() and (criado_por = auth.uid() or is_manager()));

-- ===== Atas importantes (substitui o registro de reuniões) — migração 015 =====
-- Cada pessoa guarda as atas das reuniões que fez: nome, data, breve resumo, o TEXTO da ata (até 60 mil caracteres) e/ou o ARQUIVO original (Word/PDF, no Storage). Visível e editável SOMENTE pelo dono (nem gerente/diretor leem as atas dos outros).
create table if not exists public.atas(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  data_reuniao date not null,
  resumo text check (resumo is null or length(resumo) <= 1000),
  texto text check (texto is null or length(texto) <= 60000),
  arquivo_path text, arquivo_nome text, arquivo_tamanho bigint check (arquivo_tamanho is null or arquivo_tamanho between 0 and 10485760),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint atas_conteudo_check check (coalesce(length(trim(texto)), 0) > 0 or arquivo_path is not null));
create index if not exists atas_user_data on public.atas(user_id, data_reuniao desc);
alter table public.atas enable row level security;
drop policy if exists atas_sel on public.atas; drop policy if exists atas_ins on public.atas; drop policy if exists atas_upd on public.atas; drop policy if exists atas_del on public.atas;
create policy atas_sel on public.atas for select to authenticated using ((select is_active()) and user_id = (select auth.uid()));
create policy atas_ins on public.atas for insert to authenticated with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_upd on public.atas for update to authenticated using ((select is_active()) and user_id = (select auth.uid())) with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_del on public.atas for delete to authenticated using ((select is_active()) and user_id = (select auth.uid()));
revoke all on public.atas from anon;
drop trigger if exists touch_atas on public.atas;
create trigger touch_atas before update on public.atas for each row execute function touch_updated();

-- Arquivos (migração 017): bucket privado "atas", 10 MB por arquivo, só Word/PDF; cada pessoa só acessa a própria pasta (<id do usuário>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atas', 'atas', false, 10485760, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists atas_arq_sel on storage.objects; drop policy if exists atas_arq_ins on storage.objects;
drop policy if exists atas_arq_upd on storage.objects; drop policy if exists atas_arq_del on storage.objects;
create policy atas_arq_sel on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_upd on storage.objects for update to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_del on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== Capacidade do plano e arquivamento das atas — migração 018 =====
-- O Analista Sr acompanha o uso (banco e Storage) contra os limites do plano; ao chegar no limiar (padrão 95%) a plataforma avisa. Aí ele pode gerar um backup
-- único (ZIP) com TODAS as atas (texto + arquivos) e, depois, excluir exclusivamente as atas para liberar espaço. As atas são privadas de cada pessoa: o acesso do
-- Analista Sr às atas de todos só existe numa "janela de manutenção" de 3 h, aberta apenas quando o limiar foi atingido, e fica registrada na auditoria.
create table if not exists public.capacidade_config(
  id int primary key default 1 check (id = 1),
  banco_limite_mb int not null default 500 check (banco_limite_mb > 0),         -- Free = 500 · Pro = 8192
  storage_limite_mb int not null default 1024 check (storage_limite_mb > 0),    -- Free = 1024 · Pro = 102400
  alerta_pct int not null default 95 check (alerta_pct between 50 and 100),
  atualizado_em timestamptz not null default now(), atualizado_por uuid);
insert into public.capacidade_config(id) values (1) on conflict do nothing;
alter table public.capacidade_config enable row level security;
drop policy if exists cap_sel on public.capacidade_config; drop policy if exists cap_upd on public.capacidade_config;
create policy cap_sel on public.capacidade_config for select to authenticated using ((select is_manager()));
create policy cap_upd on public.capacidade_config for update to authenticated using ((select is_manager())) with check ((select is_manager()));
revoke all on public.capacidade_config from anon;

create table if not exists public.atas_manutencao(
  id int primary key default 1 check (id = 1),
  aberta_em timestamptz, aberta_por uuid, expira_em timestamptz, corte timestamptz, backup_em timestamptz, backup_itens jsonb);
insert into public.atas_manutencao(id) values (1) on conflict do nothing;
alter table public.atas_manutencao enable row level security;      -- sem políticas: ninguém acessa direto; só pelas funções abaixo
revoke all on public.atas_manutencao from anon, authenticated;

create or replace function public.atas_manutencao_aberta() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select expira_em > now() from atas_manutencao where id = 1), false) $$;

create or replace function public.capacidade_status() returns jsonb language plpgsql security definer set search_path=public as $$
declare c capacidade_config; b bigint; s bigint; ac int; tx bigint; ar bigint; pb numeric; ps numeric;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  select * into c from capacidade_config where id = 1;
  b := pg_database_size(current_database());
  s := coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0);
  select count(*), coalesce(sum(octet_length(texto)), 0), coalesce(sum(arquivo_tamanho), 0) into ac, tx, ar from atas;
  pb := round(b * 100.0 / (c.banco_limite_mb * 1048576.0), 1);
  ps := round(s * 100.0 / (c.storage_limite_mb * 1048576.0), 1);
  return jsonb_build_object('banco_bytes', b, 'banco_limite_bytes', c.banco_limite_mb * 1048576::bigint, 'banco_pct', pb,
    'storage_bytes', s, 'storage_limite_bytes', c.storage_limite_mb * 1048576::bigint, 'storage_pct', ps,
    'alerta_pct', c.alerta_pct, 'alerta', greatest(pb, ps) >= c.alerta_pct,
    'atas_qtd', ac, 'atas_texto_bytes', tx, 'atas_arquivo_bytes', ar, 'janela_aberta', atas_manutencao_aberta());
end $$;

-- Abre a janela de manutenção (3 h). Só com o limiar atingido. Devolve o instante de corte (o backup cobre as atas até ele).
create or replace function public.atas_manutencao_abrir() returns timestamptz language plpgsql security definer set search_path=public as $$
declare st jsonb; t timestamptz := now();
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  st := capacidade_status();
  if not (st->>'alerta')::boolean then raise exception 'O uso ainda não chegou a % %% do plano; o arquivamento das atas só é liberado a partir daí.', st->>'alerta_pct'; end if;
  update atas_manutencao set aberta_em = t, aberta_por = auth.uid(), expira_em = t + interval '3 hours', corte = t, backup_em = null, backup_itens = null where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ABRIR', jsonb_build_object('atas', st->'atas_qtd', 'storage_pct', st->'storage_pct', 'banco_pct', st->'banco_pct'));
  return t;
end $$;

-- Registra que o backup foi gerado: lista de {id, u} (id da ata e atualizado_em) que ENTRARAM no arquivo. Só essas, sem alteração depois, poderão ser excluídas.
create or replace function public.atas_backup_registrar(p_itens jsonb) returns int language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  update atas_manutencao set backup_em = now(), backup_itens = p_itens where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'BACKUP', jsonb_build_object('atas', jsonb_array_length(p_itens)));
  return jsonb_array_length(p_itens);
end $$;

-- Exclui EXCLUSIVAMENTE as atas que estão no backup registrado (e que não foram alteradas depois). Não vai para a Lixeira (o backup é a cópia). Devolve os caminhos dos arquivos para a tela removê-los do Storage.
create or replace function public.atas_esvaziar(p_confirmacao text) returns jsonb language plpgsql security definer set search_path=public as $$
declare m atas_manutencao; n int; caminhos jsonb;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_confirmacao is distinct from 'EXCLUIR ATAS' then raise exception 'Confirmação inválida.'; end if;
  select * into m from atas_manutencao where id = 1 for update;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if m.backup_em is null or m.backup_itens is null then raise exception 'Gere e baixe o backup antes de excluir.'; end if;
  perform set_config('app.purge', '1', true);        -- não copia para a Lixeira
  with alvo as (
    select a.id, a.arquivo_path from atas a join jsonb_to_recordset(m.backup_itens) as x(id uuid, u timestamptz) on x.id = a.id and a.atualizado_em = x.u),
  del as (delete from atas where id in (select id from alvo) returning arquivo_path)
  select count(*), coalesce(jsonb_agg(arquivo_path) filter (where arquivo_path is not null), '[]'::jsonb) into n, caminhos from del;
  perform set_config('app.purge', '', true);
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ESVAZIAR', jsonb_build_object('atas_excluidas', n));
  return jsonb_build_object('excluidas', n, 'caminhos', caminhos);
end $$;

create or replace function public.atas_manutencao_fechar() returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  update atas_manutencao set expira_em = now(), backup_itens = null where id = 1;
end $$;
revoke execute on function public.atas_manutencao_aberta(), public.capacidade_status(), public.atas_manutencao_abrir(), public.atas_backup_registrar(jsonb), public.atas_esvaziar(text), public.atas_manutencao_fechar() from public, anon;

-- Janela de manutenção aberta: o Analista Sr lê as atas de todos (para o backup) e lê/remove os arquivos do bucket "atas".
drop policy if exists atas_sel_manut on public.atas;
create policy atas_sel_manut on public.atas for select to authenticated using ((select is_manager()) and (select atas_manutencao_aberta()));
drop policy if exists atas_arq_sel_manut on storage.objects; drop policy if exists atas_arq_del_manut on storage.objects;
create policy atas_arq_sel_manut on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));
create policy atas_arq_del_manut on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));

-- ===== Lixeira de 48 horas (desfazer exclusões) — migração 012 =====
-- Tudo que é excluído em Projetos, atividades/etapas do Backlog, Ideias, Agenda (reuniões) e Imprevistos vai para a lixeira por 48 h e pode ser restaurado
-- (quem excluiu ou o Analista Sr). Usuários excluídos ficam bloqueados por 48 h (podem ser restaurados) e só depois são removidos de vez.
alter table public.profiles add column excluido_em timestamptz, add column excluido_por uuid;
create table public.lixeira(
  id uuid primary key default gen_random_uuid(),
  tabela text not null, registro_id uuid not null, rotulo text,
  dados jsonb not null, filhos jsonb not null default '{}',          -- cópia da linha e dos registros ligados (histórico do projeto, etapas da atividade)
  excluido_por uuid default auth.uid(), excluido_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '48 hours', restaurado_em timestamptz);
create index on public.lixeira(expira_em);
alter table public.lixeira enable row level security;
create policy lx_sel on public.lixeira for select to authenticated
  using (is_active() and restaurado_em is null and expira_em > now() and (excluido_por = auth.uid() or is_manager()));
create policy lx_del on public.lixeira for delete to authenticated using (is_manager());   -- “Remover definitivamente” (Analista Sr)

create function public.lixeira_captura() returns trigger language plpgsql security definer set search_path=public as $$
declare v_rot text; v_filhos jsonb := '{}';
begin
  if coalesce(current_setting('app.purge', true),'') = '1' then return old; end if;   -- remoção definitiva (expirou) não volta para a lixeira
  if tg_table_name = 'microdeliveries' then
    v_rot := old.demanda;
    v_filhos := jsonb_build_object('microdelivery_history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) from microdelivery_history h where h.microdelivery_id = old.id));
  elsif tg_table_name = 'backlog_melhorias' then
    v_rot := old.melhoria;
    v_filhos := jsonb_build_object('backlog_etapas', (select coalesce(jsonb_agg(to_jsonb(e) order by e.ordem), '[]'::jsonb) from backlog_etapas e where e.melhoria_id = old.id));
  elsif tg_table_name = 'backlog_etapas' then
    if not exists (select 1 from backlog_melhorias m where m.id = old.melhoria_id) then return old; end if;   -- etapa removida junto com a atividade: já está na cópia da atividade
    v_rot := old.como;
  elsif tg_table_name = 'ideas' then v_rot := old.titulo;
  elsif tg_table_name = 'agenda' then v_rot := old.assunto;
  elsif tg_table_name = 'imprevistos' then v_rot := old.descricao;
  elsif tg_table_name = 'atas' then v_rot := old.nome;
  end if;
  insert into lixeira(tabela, registro_id, rotulo, dados, filhos) values (tg_table_name, old.id, left(coalesce(v_rot,''), 200), to_jsonb(old), v_filhos);
  return old;
end $$;
do $$ declare t text; begin
  foreach t in array array['microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas'] loop
    execute format('create trigger lixeira_%1$s before delete on public.%1$I for each row execute function lixeira_captura()', t);
  end loop; end $$;

-- Reinsere linha(s) a partir da cópia JSON, ignorando colunas geradas (ex.: mes_referencia). Uso interno.
create function public.lixeira_inserir(p_tab text, p_dados jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_cols text;
begin
  if p_tab not in ('microdeliveries','microdelivery_history','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
  select string_agg(quote_ident(attname), ',' order by attnum) into v_cols from pg_attribute
   where attrelid = ('public.' || quote_ident(p_tab))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  if p_dados is null or jsonb_typeof(p_dados) = 'null' or p_dados = '[]'::jsonb then return; end if;
  execute format('insert into public.%1$I (%2$s) overriding system value select %2$s from %3$s(null::public.%1$I, $1)', p_tab, v_cols,
                 case when jsonb_typeof(p_dados) = 'array' then 'jsonb_populate_recordset' else 'jsonb_populate_record' end) using p_dados;
end $$;

create function public.lixeira_restaurar(p_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare r lixeira%rowtype;
begin
  select * into r from lixeira where id = p_id and restaurado_em is null and expira_em > now() for update;
  if not found then raise exception 'Item não encontrado ou o prazo de 48 horas já terminou.'; end if;
  if not (is_active() and (is_manager() or r.excluido_por = auth.uid())) then raise exception 'Sem permissão para restaurar este item.'; end if;
  if r.tabela not in ('microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
  perform set_config('app.sync', '1', true);   -- preserva origem/chamado_chave do Backlog na restauração
  begin
    perform lixeira_inserir(r.tabela, r.dados);
    if r.tabela = 'microdeliveries' then
      delete from microdelivery_history where microdelivery_id = r.registro_id;   -- remove o registro de “criação” gerado automaticamente; volta o histórico original
      perform lixeira_inserir('microdelivery_history', r.filhos->'microdelivery_history');
    elsif r.tabela = 'backlog_melhorias' then
      perform lixeira_inserir('backlog_etapas', r.filhos->'backlog_etapas');
    end if;
  exception
    when foreign_key_violation then raise exception 'Não foi possível restaurar: um registro ligado (por exemplo, o responsável ou a atividade) não existe mais.';
    when unique_violation then raise exception 'Não foi possível restaurar: já existe um item equivalente (por exemplo, a reimportação de chamados recriou a atividade).';
  end;
  perform set_config('app.sync', '', true);
  update lixeira set restaurado_em = now() where id = p_id;
  return r.rotulo;
end $$;

-- Exclusão de usuário passa a ser REVERSÍVEL por 48 h: o acesso é bloqueado e o usuário some das listas; depois disso é removido de vez (lixeira_purgar).
create or replace function public.usuario_excluir(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int; nm text;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode excluir usuários.'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  select nome into nm from profiles where id = p_id and excluido_em is null;
  if nm is null then raise exception 'Usuário não encontrado.'; end if;
  select count(*) into n from microdeliveries where responsavel_id = p_id or criado_por = p_id or com_quem_id = p_id;
  if n > 0 then raise exception '% ainda está ligado a % projeto(s) (responsável, criador ou “com quem está”). Reatribua ou exclua esses projetos antes de excluir o usuário.', nm, n; end if;
  update profiles set ativo = false, excluido_em = now(), excluido_por = auth.uid() where id = p_id;
  update auth.users set banned_until = 'infinity' where id = p_id;   -- impede novo login enquanto estiver na lixeira
end $$;
create function public.usuario_restaurar(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode restaurar usuários.'; end if;
  update profiles set ativo = true, excluido_em = null, excluido_por = null where id = p_id and excluido_em is not null and excluido_em > now() - interval '48 hours';
  if not found then raise exception 'Usuário não encontrado ou o prazo de 48 horas já terminou.'; end if;
  update auth.users set banned_until = null where id = p_id;
end $$;

-- Limpeza: remove da lixeira o que passou de 48 h e apaga de vez os usuários excluídos há mais de 48 h. Chamada pela verificação semanal e ao abrir a Lixeira.
create function public.lixeira_purgar() returns int language plpgsql security definer set search_path=public as $$
declare r record; n int := 0;
begin
  delete from lixeira where expira_em < now() or restaurado_em < now() - interval '7 days';
  perform set_config('app.purge', '1', true);
  for r in select id from profiles where excluido_em is not null and excluido_em < now() - interval '48 hours' loop
    delete from auth.users where id = r.id; n := n + 1;
  end loop;
  perform set_config('app.purge', '', true);
  return n;
end $$;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb), public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() from public, anon;
grant execute on function public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() to authenticated, service_role;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) from authenticated;
grant execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) to service_role;

-- ===== Agente de segurança semanal — migração 013 =====
-- seguranca_verificar() audita o banco e CORRIGE sozinha as falhas de uma lista segura (RLS desligado, funções/tabelas abertas a visitantes,
-- views sem security_invoker, funções sem search_path). O que exige decisão humana fica como “pendente”. Tudo é registrado e aparece, só para o
-- Analista Sr, em “Segurança” (rodapé do menu). A camada de IA (Edge Function agente-seguranca) apenas EXPLICA o relatório — nunca executa comandos.
create table public.seguranca_execucoes(
  id uuid primary key default gen_random_uuid(),
  iniciada_em timestamptz not null default now(), concluida_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual','semanal','ia')),
  executado_por uuid default auth.uid(),
  total int not null default 0, corrigidos int not null default 0, pendentes int not null default 0,
  resumo_ia text, modelo_ia text);
create table public.seguranca_achados(
  id bigint generated always as identity primary key,
  execucao_id uuid not null references public.seguranca_execucoes(id) on delete cascade,
  severidade text not null check (severidade in ('alta','media','baixa')),
  categoria text not null, objeto text, descricao text not null, recomendacao text,
  status text not null check (status in ('corrigido','pendente','informativo')),
  corrigido_em timestamptz);
create index on public.seguranca_achados(execucao_id);
alter table public.seguranca_execucoes enable row level security;
alter table public.seguranca_achados enable row level security;
create policy se_sel on public.seguranca_execucoes for select to authenticated using (is_manager());
create policy sa_sel on public.seguranca_achados for select to authenticated using (is_manager());   -- sem policy de escrita: só a função grava

create function public.seguranca_verificar(p_origem text default 'manual') returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; r record; n int;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'Somente o Analista Sr pode executar a verificação de segurança.'; end if;
  if p_origem not in ('manual','semanal','ia') then p_origem := 'manual'; end if;
  insert into seguranca_execucoes(origem) values (p_origem) returning id into v_id;

  -- 1) tabelas sem RLS → liga o RLS (sem políticas, a tabela fica fechada: é o padrão seguro)
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', r.relname);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','RLS desligado',r.relname,'A tabela estava sem segurança por linha (RLS): qualquer usuário logado poderia ler/alterar tudo.','RLS ligado automaticamente. Crie as políticas de acesso se o app precisar usar esta tabela.','corrigido',now());
  end loop;

  -- 2) views sem security_invoker (ignorariam o RLS das tabelas) → ativa
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'v' and not ('security_invoker=true' = any(coalesce(c.reloptions, '{}'))) loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','View sem security_invoker',r.relname,'A view executava com as permissões do dono e poderia expor dados que o RLS esconde.','security_invoker ativado automaticamente.','corrigido',now());
  end loop;

  -- 3) tabelas/views com privilégio para visitantes sem login (anon) → revoga
  for r in select table_name, string_agg(privilege_type, ', ') as privs from information_schema.role_table_grants
           where grantee = 'anon' and table_schema = 'public' group by table_name loop
    execute format('revoke all on public.%I from anon', r.table_name);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','Acesso de visitante a tabela',r.table_name,'O papel anon (sem login) tinha privilégios: '||r.privs||'.','Privilégios removidos automaticamente.','corrigido',now());
  end loop;

  -- 4) funções executáveis por visitantes (anon/PUBLIC) → revoga
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon', r.f);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','Função aberta a visitantes',r.proname,'A função podia ser chamada pela API sem login.','Execução removida de anon/PUBLIC automaticamente.','corrigido',now());
  end loop;

  -- 5) funções do app sem search_path fixo → fixa
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('alter function %s set search_path = public', r.f);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'media','Função sem search_path',r.proname,'Função sem search_path fixo (risco de sequestro de nomes).','search_path fixado em public automaticamente.','corrigido',now());
  end loop;

  -- 6) PENDENTES (decisão humana): políticas de escrita abertas, papéis públicos em políticas, excesso de administradores, contas paradas, extensões em public
  for r in select tablename, policyname, cmd from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
           and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true') loop
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'alta','Política de escrita aberta',r.tablename||' · '||r.policyname,'A política de '||r.cmd||' libera para qualquer usuário (condição “true”).','Revisar e restringir a condição da política (não é corrigido automaticamente para não quebrar o app).','pendente');
  end loop;
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and (roles && array['public'::name,'anon'::name]) loop
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'alta','Política para visitantes',r.tablename||' · '||r.policyname,'A política vale também para visitantes sem login.','Restringir a política ao papel authenticated.','pendente');
  end loop;
  select count(*) into n from profiles where perfil = 'analista_sr' and ativo;
  if n > 3 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'media','Muitos administradores','profiles',n||' usuários ativos com perfil Analista Sr (acesso administrativo total).','Manter só quem realmente administra a plataforma.','pendente');
  end if;
  select count(*) into n from profiles p join auth.users u on u.id = p.id where p.ativo and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '90 days';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Contas sem uso','profiles',n||' usuário(s) ativo(s) sem acesso há mais de 90 dias.','Desativar (ou excluir) quem saiu da equipe, em Gestão da equipe → Usuários.','pendente');
  end if;
  select count(*) into n from auth.users where invited_at is not null and last_sign_in_at is null and invited_at < now() - interval '14 days';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Convites não aceitos','auth.users',n||' convite(s) enviado(s) há mais de 14 dias sem aceite.','Reenviar o convite ou excluir o usuário.','pendente');
  end if;
  select count(*) into n from pg_extension e join pg_namespace s on s.oid = e.extnamespace where s.nspname = 'public' and e.extname <> 'plpgsql';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Extensões no schema public','pg_extension',n||' extensão(ões) instalada(s) no schema public (suas funções ficam expostas na API).','Mover para o schema extensions no painel do Supabase (não é automático para não quebrar dependências).','pendente');
  end if;

  -- 7) manutenção: esvazia a lixeira vencida e apaga de vez os usuários excluídos há mais de 48 h
  n := lixeira_purgar();
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'baixa','Manutenção','lixeira',n||' usuário(s) excluído(s) há mais de 48 h removido(s) definitivamente.','Rotina automática.','informativo',now());
  end if;

  -- 8) resumo informativo (sempre presente)
  insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
    (v_id,'baixa','Resumo','banco',
     (select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity)||' tabelas com RLS · '||
     (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prokind='f' and not has_function_privilege('anon',p.oid,'execute'))||' funções fechadas a visitantes.',
     'Estado verificado ao final da execução.','informativo');

  update seguranca_execucoes e set concluida_em = now(),
    corrigidos = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status = 'corrigido'),
    pendentes = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status = 'pendente'),
    total = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status in ('corrigido','pendente'))
   where e.id = v_id;
  return v_id;
end $$;
revoke execute on function public.seguranca_verificar(text) from public, anon;
grant execute on function public.seguranca_verificar(text) to authenticated, service_role;

-- Agendamento semanal (segundas, 09:00 UTC) quando a extensão pg_cron estiver ativada no Supabase; senão veja o README (agendar a Edge Function).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('seguranca-semanal'); exception when others then null; end;
    perform cron.schedule('seguranca-semanal', '0 9 * * 1', $c$select public.seguranca_verificar('semanal')$c$);
  else
    raise notice 'pg_cron não está ativado: a verificação semanal precisa ser agendada (veja o README) ou rodada pelo botão Segurança.';
  end if;
end $$;

-- ===== Endurecimento de segurança — migração 010 =====
-- (1) origem/chamado_chave/chamado_status do Backlog só são gravadas pela sincronização de chamados (usuário não consegue forjar nem alterar);
-- (2) criado_por dos Projetos não pode ser reescrito; (3) funções fixam search_path;
-- (4) NENHUMA função do schema public fica executável por visitantes sem login (anon/PUBLIC); funções internas (gatilhos) também saem da API.
create function public.bl_protege_origem() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(current_setting('app.sync', true),'') <> '1' then
    if tg_op = 'INSERT' then new.origem := 'manual'; new.chamado_chave := null; new.chamado_status := null;
    else new.origem := old.origem; new.chamado_chave := old.chamado_chave; new.chamado_status := old.chamado_status; end if;
  end if;
  return new;
end $$;
create trigger aa_protege_origem before insert or update on public.backlog_melhorias for each row execute function bl_protege_origem();

create function public.md_protege_autor() returns trigger language plpgsql set search_path=public as $$
begin new.criado_por := old.criado_por; return new; end $$;
create trigger md_bu0_autor before update on public.microdeliveries for each row execute function md_protege_autor();

do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prokind='f' and p.proconfig is null
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop execute format('alter function %s set search_path = public', r.f); end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
do $$ declare r record; begin   -- funções de gatilho e a sincronização interna: não são chamáveis pela API
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prokind='f' and (p.prorettype='trigger'::regtype or p.proname='chamados_sincronizar')
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop execute format('revoke execute on function %s from authenticated', r.f); end loop;
end $$;
revoke execute on function public.lixeira_inserir(text, jsonb) from authenticated;   -- uso interno (lixeira_restaurar)

-- 014 · Desempenho do RLS: as funções de permissão (is_active, is_viewer_all, is_manager, auth.uid) passam a ser avaliadas UMA vez por consulta
-- ("(select …)" vira InitPlan) em vez de uma vez por linha. O significado das políticas não muda. Idempotente.
do $$
declare r record; q text; w text; n int := 0;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := r.qual; w := r.with_check;
    if coalesce(q,'') ~* 'select (public\.)?(is_active|is_viewer_all|is_manager|auth\.uid)' or coalesce(w,'') ~* 'select (public\.)?(is_active|is_viewer_all|is_manager|auth\.uid)' then continue; end if;
    if coalesce(q,'') !~ '(is_active|is_viewer_all|is_manager|auth\.uid)\(\)' and coalesce(w,'') !~ '(is_active|is_viewer_all|is_manager|auth\.uid)\(\)' then continue; end if;
    if q is not null then q := regexp_replace(q, '(?<![\w.])((?:public\.)?(?:is_active|is_viewer_all|is_manager)|auth\.uid)\(\)', '(select \1())', 'g'); end if;
    if w is not null then w := regexp_replace(w, '(?<![\w.])((?:public\.)?(?:is_active|is_viewer_all|is_manager)|auth\.uid)\(\)', '(select \1())', 'g'); end if;
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when q is not null then ' using (' || q || ')' else '' end,
      case when w is not null then ' with check (' || w || ')' else '' end);
    n := n + 1;
  end loop;
  raise notice '014: % política(s) otimizada(s)', n;
end $$;
