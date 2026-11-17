-- 026: agenda o aviso semanal por e-mail (segunda 08:00 Fortaleza = 11:00 UTC).
-- O segredo do agendamento é gerado AQUI, dentro do banco (Vault); nenhum valor precisa ser copiado à mão.
-- A função aviso-semanal confere o segredo por cron_secret_ok() (só service_role).
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'cron_secret', 'Segredo do agendamento do aviso semanal');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text) returns boolean
language sql security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

select cron.unschedule('aviso-semanal') where exists (select 1 from cron.job where jobname = 'aviso-semanal');
select cron.schedule('aviso-semanal', '0 11 * * 1', $job$
  select net.http_post(
    url := 'https://hgzubmiwmflfaobnuvdu.supabase.co/functions/v1/aviso-semanal',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$job$);
