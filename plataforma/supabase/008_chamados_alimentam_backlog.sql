-- MIGRAÇÃO 008 — A base de chamados alimenta o Backlog de Melhorias (painel único).
-- Rode UMA vez, depois da 007. NÃO execute em instalação nova (use só o 001). Depois, reimporte a base de chamados (Importar bases):
-- os chamados válidos viram atividades do Backlog (a primeira importação cria uma atividade por chamado).
begin;

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
  perform chamados_sincronizar();   -- chamados válidos viram/atualizam atividades do Backlog
  return n;
end $$;

commit;
