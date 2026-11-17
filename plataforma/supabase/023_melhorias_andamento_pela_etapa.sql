-- 023 — Melhorias sem etapas (COMO?): o andamento (%) passa a acompanhar a etapa do funil
--   Ideia 0% · Priorização 17% · Especificação 33% · Chamado aberto 50% · Desenvolvimento 67% · Homologação 83% · Produção 100%
-- As etapas "COMO?" antigas das melhorias ficam guardadas no banco, mas deixam de influenciar status e % (a tela não as mostra mais).
-- Correção/manutenção continua com etapas e % calculado por elas. Idempotente.
begin;

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
  -- o andamento (%) acompanha a etapa do funil: 0 · 17 · 33 · 50 · 67 · 83 · 100
  new.percentual_concluido := case new.fase when 'ideia' then 0 when 'priorizada' then 17 when 'especificacao' then 33 when 'chamado_aberto' then 50
                                            when 'em_desenvolvimento' then 67 when 'homologacao' then 83 else 100 end;
  return new;
end $$;

-- O roll-up das etapas não mexe mais nas melhorias do funil (só na Correção/manutenção).
create or replace function public.bl_rollup() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid := coalesce(new.melhoria_id, old.melhoria_id); n int; pct numeric; st text;
begin
  if exists (select 1 from backlog_melhorias where id = mid and tipo_backlog = 'melhoria') then return null; end if;
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

-- O bloqueio "com etapas, status/% não editáveis" também não vale para as melhorias do funil.
create or replace function public.bl_guard() returns trigger language plpgsql as $$
begin
  if new.tipo_backlog is distinct from 'melhoria'
     and coalesce(current_setting('app.bl_rollup', true),'') <> '1' and exists(select 1 from backlog_etapas where melhoria_id=new.id) then
    new.status := old.status; new.percentual_concluido := old.percentual_concluido;
  end if;
  return new;
end $$;

-- Acerta o % das melhorias existentes (sem poluir o histórico de alterações).
alter table public.backlog_melhorias disable trigger hist_backlog_melhorias;
update public.backlog_melhorias set percentual_concluido = case fase when 'ideia' then 0 when 'priorizada' then 17 when 'especificacao' then 33 when 'chamado_aberto' then 50
  when 'em_desenvolvimento' then 67 when 'homologacao' then 83 else 100 end
 where tipo_backlog = 'melhoria';
alter table public.backlog_melhorias enable trigger hist_backlog_melhorias;
commit;
