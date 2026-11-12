-- MIGRAÇÃO 007 — Chamados: responsável (empresa e pessoa) e fase, para o detalhamento "Quem é responsável" do Pareto backlog.
-- Rode UMA vez no banco que já tem a 005/006. NÃO execute em instalação nova (use só o 001). Depois, reimporte a base de chamados
-- (Importar bases) com o CSV que tem as colunas RESPONSÁVEL, EMPRESA RESPONSÁVEL, RESPONSÁVEL ROCCO e FASE (modelos/chamados_backlog_import.csv).
begin;

alter table public.backlog_chamados
  add column if not exists responsavel text,
  add column if not exists empresa_responsavel text,
  add column if not exists responsavel_rocco text,
  add column if not exists fase text;

create or replace function public.chamados_substituir(p_rows jsonb) returns int language plpgsql security definer set search_path=public as $$
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
  return n;
end $$;

commit;
