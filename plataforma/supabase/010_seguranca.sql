-- MIGRAÇÃO 010 — Endurecimento de segurança (permissões de funções, proteção de campos). Execute UMA vez, depois da 009. Não altera dados.
begin;
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
commit;
