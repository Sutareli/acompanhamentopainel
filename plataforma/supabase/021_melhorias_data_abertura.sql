-- 021 · Melhorias como funil do processo (7 etapas) + responsável da plataforma desde a ideia. Rode depois da 020.
-- Pode ser executada de novo sem problema (inclusive se uma versão anterior da 021 já foi aplicada).
begin;

-- Funil do processo de melhoria (módulo Melhorias), 7 etapas:
--   ideia → priorizada (priorização) → especificacao → chamado_aberto → em_desenvolvimento → homologacao → producao
-- Datas: data_ideia, data_priorizacao, data_especificacao, data_abertura (+ numero_chamado), data_inicio (início do desenvolvimento), data_homologacao, data_conclusao (entrada em produção).
-- Responsável: usuário da plataforma dono da melhoria desde a ideia (responsavel_id). O desenvolvimento é sempre da mesma empresa, por isso não há responsável de desenvolvimento.
alter table public.backlog_melhorias
  add column if not exists data_ideia date,
  add column if not exists data_priorizacao date,
  add column if not exists data_especificacao date,
  add column if not exists data_abertura date,
  add column if not exists data_homologacao date,
  add column if not exists numero_chamado text,
  add column if not exists responsavel_id uuid references public.profiles(id) on delete set null;

-- Primeira execução: cria a coluna "fase" e posiciona as melhorias já existentes pelo status atual.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'backlog_melhorias' and column_name = 'fase') then
    alter table public.backlog_melhorias add column fase text not null default 'ideia';
    update public.backlog_melhorias set fase = case
        when status = 'Concluído' then 'producao'
        when status in ('Em andamento','Atrasado','Novo Prazo') then 'em_desenvolvimento'
        when data_abertura is not null then 'chamado_aberto' when ordem_top is not null then 'priorizada' else 'ideia' end
      where tipo_backlog = 'melhoria';
  end if;
end $$;
alter table public.backlog_melhorias drop constraint if exists backlog_melhorias_fase_check;
update public.backlog_melhorias set fase = 'producao' where fase = 'aplicada';   -- nome antigo da última etapa
alter table public.backlog_melhorias add constraint backlog_melhorias_fase_check
  check (fase in ('ideia','priorizada','especificacao','chamado_aberto','em_desenvolvimento','homologacao','producao'));
create index if not exists backlog_melhorias_fase_idx on public.backlog_melhorias(tipo_backlog, fase);
create index if not exists backlog_melhorias_data_abertura_idx on public.backlog_melhorias(data_abertura);
create index if not exists backlog_melhorias_responsavel_idx on public.backlog_melhorias(responsavel_id);

-- A etapa manda no status: Ideia→Chamado = A Iniciar · Desenvolvimento/Homologação = em andamento (ou Atrasado/Novo Prazo) · Produção = Concluído.
-- Quando o status muda sozinho (etapas concluídas = desenvolvimento pronto → vai para Homologação).
create or replace function public.bl_fase() returns trigger language plpgsql as $$
declare roll boolean := coalesce(current_setting('app.bl_rollup', true), '') = '1';
begin
  if new.tipo_backlog is distinct from 'melhoria' then return new; end if;
  if tg_op = 'UPDATE' and new.fase is distinct from old.fase and not roll then
    -- mudança manual de etapa: a etapa define o status
    if new.fase = 'producao' then new.status := 'Concluído'; new.percentual_concluido := 100;
    elsif new.fase in ('em_desenvolvimento','homologacao') then if new.status in ('A Iniciar','Concluído') then new.status := 'Em andamento'; end if;
    else new.status := 'A Iniciar'; new.percentual_concluido := 0; end if;
  else
    -- o status mudou (ou é um registro novo): ajusta a etapa
    if new.status = 'Concluído' then
      if new.fase not in ('homologacao','producao') then new.fase := case when roll then 'homologacao' else 'producao' end; end if;
    elsif new.status in ('Em andamento','Atrasado','Novo Prazo') then
      if new.fase not in ('em_desenvolvimento','homologacao') then new.fase := 'em_desenvolvimento'; end if;
    elsif new.fase in ('em_desenvolvimento','homologacao','producao') then
      new.fase := case when new.data_abertura is not null then 'chamado_aberto' when new.data_especificacao is not null then 'especificacao'
                       when new.data_priorizacao is not null or new.ordem_top is not null then 'priorizada' else 'ideia' end;
    end if;
  end if;
  if new.fase <> 'producao' then new.data_conclusao := null; end if;   -- a data de conclusão é a de entrada em produção
  return new;
end $$;
drop trigger if exists zy_fase_backlog_melhorias on public.backlog_melhorias;
drop trigger if exists zzz_fase_backlog_melhorias on public.backlog_melhorias;
create trigger zy_fase_backlog_melhorias before insert or update on public.backlog_melhorias for each row execute function bl_fase();

-- Data de conclusão: nas melhorias é a de ENTRADA EM PRODUÇÃO (Concluído por etapas em Homologação não conta).
create or replace function public.bl_conclusao() returns trigger language plpgsql as $$
declare em_producao boolean := new.tipo_backlog is distinct from 'melhoria' or new.fase = 'producao';
begin
  if new.status = 'Concluído' and em_producao then
    if tg_op = 'INSERT' or old.status is distinct from 'Concluído' or (new.tipo_backlog = 'melhoria' and old.fase is distinct from 'producao') then
      if new.data_conclusao is null and coalesce(new.origem,'manual') <> 'chamado' then new.data_conclusao := (now() at time zone 'America/Sao_Paulo')::date; end if;
    end if;
  else
    new.data_conclusao := null;
  end if;
  return new;
end $$;

-- O responsável (usuário da plataforma) também pode editar a melhoria e suas etapas.
drop policy if exists bl_upd on public.backlog_melhorias;
create policy bl_upd on public.backlog_melhorias for update to authenticated
  using (is_active() and (criado_por = auth.uid() or responsavel_id = auth.uid() or is_viewer_all()))
  with check (is_active() and (criado_por = auth.uid() or responsavel_id = auth.uid() or is_viewer_all()));
drop policy if exists be_ins on public.backlog_etapas;
drop policy if exists be_upd on public.backlog_etapas;
drop policy if exists be_del on public.backlog_etapas;
create policy be_ins on public.backlog_etapas for insert to authenticated with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));
create policy be_upd on public.backlog_etapas for update to authenticated
  using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())))
  with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));
create policy be_del on public.backlog_etapas for delete to authenticated using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));

-- Histórico: passa a registrar a etapa do processo, as datas das etapas e o nº do chamado.
create or replace function public.bl_hist() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid; eid uuid; enome text; cols text[]; c text; o jsonb; n jsonb;
begin
  o := case when tg_op<>'INSERT' then to_jsonb(old) end; n := case when tg_op<>'DELETE' then to_jsonb(new) end;
  if tg_table_name='backlog_melhorias' then
    mid := coalesce(new.id, old.id); eid := null;
    cols := array['status','percentual_concluido','prioridade','responsavel','data_inicio','data_termino','fase','data_ideia','data_priorizacao','data_especificacao','data_abertura','numero_chamado','data_homologacao'];
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
create or replace function public.melhorias_importar(p_itens jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; novas int := 0; atualizadas int := 0; sem_resp int := 0; v_id uuid; v_old backlog_melhorias; v_st text; v_cod int; v_pr int; v_top int;
        v_ab date; v_id_ date; v_nc text; v_fase text; v_rn int; v_ro int; v_resp uuid; v_resp_nome text;
        fases text[] := array['ideia','priorizada','especificacao','chamado_aberto','em_desenvolvimento','homologacao','producao'];
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    v_cod := case when (x->>'codigo') ~ '^[0-9]+$' then (x->>'codigo')::int end;
    if v_cod is null then raise exception 'Item sem ID numérico.'; end if;
    v_st := case when x->>'status' in ('A Iniciar','Em andamento','Concluído') then x->>'status' else 'A Iniciar' end;
    v_pr := greatest(1, case when (x->>'prioridade') ~ '^[0-9]+$' then (x->>'prioridade')::int else 3 end);   -- "-" ou vazio = 3
    v_top := case when (x->>'ordem_top') ~ '^[0-9]+$' then (x->>'ordem_top')::int end;
    v_ab := case when (x->>'data_abertura') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x->>'data_abertura')::date end;
    v_id_ := case when (x->>'data_ideia') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x->>'data_ideia')::date end;
    v_nc := left(nullif(trim(x->>'numero_chamado'),''),60);
    -- responsável: nome de um usuário ativo da plataforma (opcional na base; sem correspondência fica em branco para definir na tela)
    v_resp := null; v_resp_nome := nullif(trim(x->>'responsavel_nome'),'');
    if v_resp_nome is not null then
      select id, nome into v_resp, v_resp_nome from profiles where ativo and lower(trim(nome)) = lower(v_resp_nome) order by criado_em limit 1;
      if v_resp is null then sem_resp := sem_resp + 1; end if;
    end if;
    v_fase := case when v_st = 'Concluído' then 'producao' when v_st = 'Em andamento' then 'em_desenvolvimento'
                   when v_ab is not null or v_nc is not null then 'chamado_aberto' when v_top is not null then 'priorizada' else 'ideia' end;
    select * into v_old from backlog_melhorias where codigo_base = v_cod;
    if not found then
      insert into backlog_melhorias(modulo, melhoria, descricao, descricao_detalhada, objetivo, objetivo_detalhado, as_is, to_be, prioridade, status, percentual_concluido, ordem_top, tipo_backlog, codigo_base,
                                    fase, data_ideia, data_abertura, numero_chamado, responsavel_id, responsavel, criado_por)
      values (left(trim(x->>'modulo'),200), left(trim(x->>'melhoria'),300), nullif(x->>'descricao',''), nullif(x->>'descricao_detalhada',''), nullif(x->>'objetivo',''), nullif(x->>'objetivo_detalhado',''),
              nullif(x->>'as_is',''), nullif(x->>'to_be',''), v_pr, v_st, case when v_st = 'Concluído' then 100 else 0 end, v_top, 'melhoria', v_cod,
              v_fase, v_id_, v_ab, v_nc, v_resp, case when v_resp is not null then v_resp_nome end, auth.uid())
      returning id into v_id;
      if v_st = 'Concluído' then update backlog_melhorias set data_conclusao = null where id = v_id; end if;   -- a planilha não traz a data de entrada em produção
      novas := novas + 1;
    else
      -- a base só FAZ AVANÇAR o status; o que foi andado no sistema (etapa, datas, prazo, %, responsável) não é desfeito.
      v_rn := case v_st when 'A Iniciar' then 0 when 'Concluído' then 2 else 1 end;
      v_ro := case v_old.status when 'A Iniciar' then 0 when 'Concluído' then 2 else 1 end;
      update backlog_melhorias set modulo = left(trim(x->>'modulo'),200), melhoria = left(trim(x->>'melhoria'),300), descricao = nullif(x->>'descricao',''), descricao_detalhada = nullif(x->>'descricao_detalhada',''),
        objetivo = nullif(x->>'objetivo',''), objetivo_detalhado = nullif(x->>'objetivo_detalhado',''), as_is = nullif(x->>'as_is',''), to_be = nullif(x->>'to_be',''), prioridade = v_pr, ordem_top = v_top,
        data_ideia = coalesce(v_id_, v_old.data_ideia), data_abertura = coalesce(v_ab, v_old.data_abertura), numero_chamado = coalesce(v_nc, v_old.numero_chamado),
        responsavel_id = coalesce(v_old.responsavel_id, v_resp), responsavel = case when v_old.responsavel_id is null and v_resp is not null then v_resp_nome else v_old.responsavel end,
        status = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) or v_rn <= v_ro then v_old.status else v_st end,
        percentual_concluido = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) or v_rn <= v_ro then v_old.percentual_concluido when v_st = 'Concluído' then 100 else v_old.percentual_concluido end,
        fase = case when array_position(fases, v_fase) > array_position(fases, v_old.fase) then v_fase else v_old.fase end
      where id = v_old.id;
      if v_rn > v_ro and v_st = 'Concluído' and not exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then update backlog_melhorias set data_conclusao = null where id = v_old.id; end if;
      atualizadas := atualizadas + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', novas, 'atualizadas', atualizadas, 'sem_responsavel', sem_resp);
end $$;
revoke execute on function public.melhorias_importar(jsonb) from public, anon;

commit;
