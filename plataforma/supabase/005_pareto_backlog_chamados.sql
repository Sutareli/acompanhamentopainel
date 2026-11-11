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
