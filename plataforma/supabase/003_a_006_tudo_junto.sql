-- MIGRAÇÃO 003 → 006 em um só arquivo (Backlog, etapas/histórico, base de chamados, Atividades futuras e Projetos macro/micro).
-- Para quem executou até a 002 e AINDA NÃO executou 003, 004, 005 nem 006. Execute UMA vez. Não use em instalação nova (use só o 001).
-- MIGRAÇÃO 003 — Backlog de Melhorias. Para quem JÁ tem o banco no ar (001 + 002 já executados). NÃO execute em instalação nova (use só o 001).
-- Cria a tabela backlog_melhorias, auditoria e as políticas de acesso (RLS). Não altera nada existente.
begin;

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

commit;

-- MIGRAÇÃO 004 — Backlog: etapas (COMO?), histórico de status e roll-up. Requer a 003 já executada.
-- Para quem já tem o banco no ar. NÃO execute em instalação nova (use só o 001). Não altera dados existentes.
begin;

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

commit;

-- MIGRAÇÃO 005 — Pareto backlog: tabela de chamados + função de importação. Requer a 001/002 (is_active, is_manager).
-- Para quem já tem o banco no ar. NÃO execute em instalação nova (use só o 001). Não altera dados existentes.
begin;

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

commit;

-- Requer 001/002. NÃO execute em instalação nova (use só o 001). Não apaga dados.
begin;

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

-- ===== Projetos (antigas Microentregas): tipo e "com quem está" =====
alter table public.microdeliveries
  add column tipo_projeto text not null default 'micro' check (tipo_projeto in ('macro','micro')),   -- MacroProjeto / MicroProjeto
  add column com_quem_id uuid references profiles(id);                                                 -- com quem o projeto está agora (MacroProjetos)
create index on microdeliveries(tipo_projeto);

drop view public.v_microdeliveries;
create view public.v_microdeliveries with (security_invoker=true) as
select m.*, p.nome as responsavel_nome, c.nome as com_quem_nome, md_status(a_iniciar,em_andamento,concluido,cancelado,quantidade) as status_geral,
  (data_target < (now() at time zone 'America/Fortaleza')::date and a_iniciar+em_andamento>0) as atrasada,
  case when quantidade-cancelado=0 then null else round(100.0*concluido/(quantidade-cancelado)) end as pct_conclusao
from microdeliveries m join profiles p on p.id=m.responsavel_id left join profiles c on c.id=m.com_quem_id;

drop policy md_ins on microdeliveries;
drop policy md_upd on microdeliveries;
create policy md_ins on microdeliveries for insert to authenticated
  with check (is_active() and criado_por=auth.uid() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));
create policy md_upd on microdeliveries for update to authenticated
  using (is_active()) with check (is_active() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));

create or replace function public.md_before_update() returns trigger language plpgsql security definer set search_path=public as $$
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

commit;
