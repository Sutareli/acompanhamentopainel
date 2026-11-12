-- MIGRAÇÃO 009 — Data de conclusão das atividades do Backlog (filtros de data de início e de finalização). Execute UMA vez, depois da 008.
begin;
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
-- Preenche as já concluídas a partir do histórico (última vez que passaram a Concluído); atividades manuais sem histórico usam a data da última atualização.
update public.backlog_melhorias m set data_conclusao = coalesce(
  (select (max(h.data_hora) at time zone 'America/Sao_Paulo')::date from backlog_historico h where h.melhoria_id=m.id and h.etapa_id is null and h.campo='status' and h.valor_novo='Concluído'),
  case when coalesce(m.origem,'manual')<>'chamado' then (m.atualizado_em at time zone 'America/Sao_Paulo')::date end)
where m.status='Concluído' and m.data_conclusao is null;
commit;
