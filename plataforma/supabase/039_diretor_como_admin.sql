-- 039: o Diretor passa a ter os mesmos poderes de administração do Analista Sr e do Gerente. Idempotente.
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and ativo and perfil in ('analista_sr','gerente','diretor')) $$;
create or replace function public.is_sla_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil in ('analista_sr','gerente','diretor')) $$;
do $$
declare d text; o oid;
begin
  select p.oid into o from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='seguranca_verificar' limit 1;
  if o is not null then
    d := pg_get_functiondef(o);
    if d like '%in (''analista_sr'',''gerente'') and ativo%' then
      d := replace(d, 'in (''analista_sr'',''gerente'') and ativo', 'in (''analista_sr'',''gerente'',''diretor'') and ativo');
      d := replace(d, 'perfil Analista Sr ou Gerente', 'perfil Analista Sr, Gerente ou Diretor');
      execute d;
    end if;
  end if;
end $$;
