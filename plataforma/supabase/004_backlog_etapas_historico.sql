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
