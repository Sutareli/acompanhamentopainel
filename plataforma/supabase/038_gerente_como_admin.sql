-- 038: o Gerente passa a ter os mesmos poderes de administração do Analista Sr.
-- Idempotente; não apaga dados.
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and ativo and perfil in ('analista_sr','gerente')) $$;

drop policy if exists sem_sel on public.semanais;
drop policy if exists sem_upd on public.semanais;
drop policy if exists sem_del on public.semanais;
create policy sem_sel on public.semanais for select to authenticated using ((select is_manager()) or (select is_gerente()));
create policy sem_upd on public.semanais for update to authenticated using ((select is_manager())) with check ((select is_manager()));
create policy sem_del on public.semanais for delete to authenticated using ((select is_manager()));

-- seguranca_verificar: conta Analista Sr e Gerente como administradores
do $$
declare d text; oid_ oid;
begin
  select p.oid into oid_ from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='seguranca_verificar' limit 1;
  if oid_ is not null then
    d := pg_get_functiondef(oid_);
    if d like '%perfil = ''analista_sr''%' and d not like '%''analista_sr'',''gerente''%' then
      d := replace(d, 'perfil = ''analista_sr''', 'perfil in (''analista_sr'',''gerente'')');
      execute d;
    end if;
  end if;
end $$;
