-- 031 · Gerente: abre todas as telas do Analista Sr, SOMENTE PARA CONSULTA.
-- Escrita continua exclusiva de is_manager() (Analista Sr). Aqui só ampliamos a leitura de Status Rocco e Segurança.
create or replace function public.is_gerente() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil='gerente') $$;

drop policy if exists sem_sel on public.semanais;
create policy sem_sel on public.semanais for select to authenticated
  using (((select is_manager()) and user_id = (select auth.uid())) or (select is_gerente()));
drop policy if exists se_sel on public.seguranca_execucoes; drop policy if exists sa_sel on public.seguranca_achados;
create policy se_sel on public.seguranca_execucoes for select to authenticated using (is_manager() or is_gerente());
create policy sa_sel on public.seguranca_achados for select to authenticated using (is_manager() or is_gerente());
