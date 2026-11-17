-- 020 · Backlog dividido: Melhorias (novo) e Correção/manutenção (o que já existia). Rode depois da 019.
begin;

-- ===== Backlog dividido em dois módulos — migração 020 =====
-- "Correção/manutenção" = o backlog que já existia (inclui as atividades geradas pelos chamados) → tipo_backlog = 'correcao' (padrão; nada é perdido).
-- "Melhorias" = módulo novo, alimentado pela base de melhorias → tipo_backlog = 'melhoria'. Mesma estrutura (etapas, histórico, prazos, permissões e Lixeira).
alter table public.backlog_melhorias
  add column if not exists tipo_backlog text not null default 'correcao',
  add column if not exists codigo_base int,        -- ID da planilha de melhorias (permite reimportar sem duplicar)
  add column if not exists ordem_top int;          -- posição na lista "10 primeiras" da planilha
alter table public.backlog_melhorias drop constraint if exists backlog_melhorias_tipo_backlog_check;
alter table public.backlog_melhorias add constraint backlog_melhorias_tipo_backlog_check check (tipo_backlog in ('melhoria','correcao'));
create unique index if not exists backlog_melhorias_codigo_base_uq on public.backlog_melhorias(codigo_base);
create index if not exists backlog_melhorias_tipo_idx on public.backlog_melhorias(tipo_backlog);

-- Importação da base de melhorias (somente Analista Sr). Novas entram; existentes (mesmo ID) têm textos, prioridade e posição atualizados.
-- Status só muda quando a atividade NÃO tem etapas (com etapas, status e % são calculados por elas). Prazo, % e responsável nunca são sobrescritos.
create or replace function public.melhorias_importar(p_itens jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; novas int := 0; atualizadas int := 0; v_id uuid; v_old backlog_melhorias; v_st text; v_cod int; v_pr int; v_top int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    v_cod := case when (x->>'codigo') ~ '^[0-9]+$' then (x->>'codigo')::int end;
    if v_cod is null then raise exception 'Item sem ID numérico.'; end if;
    v_st := case when x->>'status' in ('A Iniciar','Em andamento','Concluído') then x->>'status' else 'A Iniciar' end;
    v_pr := greatest(1, case when (x->>'prioridade') ~ '^[0-9]+$' then (x->>'prioridade')::int else 3 end);   -- "-" ou vazio = 3
    v_top := case when (x->>'ordem_top') ~ '^[0-9]+$' then (x->>'ordem_top')::int end;
    select * into v_old from backlog_melhorias where codigo_base = v_cod;
    if not found then
      insert into backlog_melhorias(modulo, melhoria, descricao, descricao_detalhada, objetivo, objetivo_detalhado, as_is, to_be, prioridade, status, percentual_concluido, ordem_top, tipo_backlog, codigo_base, criado_por)
      values (left(trim(x->>'modulo'),200), left(trim(x->>'melhoria'),300), nullif(x->>'descricao',''), nullif(x->>'descricao_detalhada',''), nullif(x->>'objetivo',''), nullif(x->>'objetivo_detalhado',''),
              nullif(x->>'as_is',''), nullif(x->>'to_be',''), v_pr, v_st, case when v_st = 'Concluído' then 100 else 0 end, v_top, 'melhoria', v_cod, auth.uid())
      returning id into v_id;
      if v_st = 'Concluído' then update backlog_melhorias set data_conclusao = null where id = v_id; end if;   -- a planilha não traz a data de conclusão
      novas := novas + 1;
    else
      update backlog_melhorias set modulo = left(trim(x->>'modulo'),200), melhoria = left(trim(x->>'melhoria'),300), descricao = nullif(x->>'descricao',''), descricao_detalhada = nullif(x->>'descricao_detalhada',''),
        objetivo = nullif(x->>'objetivo',''), objetivo_detalhado = nullif(x->>'objetivo_detalhado',''), as_is = nullif(x->>'as_is',''), to_be = nullif(x->>'to_be',''), prioridade = v_pr, ordem_top = v_top,
        status = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then v_old.status else v_st end,
        percentual_concluido = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then v_old.percentual_concluido
                                    when v_st = 'Concluído' then 100 when v_st = 'A Iniciar' then 0 else case when v_old.status = 'Concluído' then 0 else v_old.percentual_concluido end end
      where id = v_old.id;
      atualizadas := atualizadas + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', novas, 'atualizadas', atualizadas);
end $$;
revoke execute on function public.melhorias_importar(jsonb) from public, anon;

commit;
