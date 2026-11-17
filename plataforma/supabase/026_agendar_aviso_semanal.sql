-- 026 — AGENDA O AVISO SEMANAL POR E-MAIL (opcional). Rode UMA vez no SQL Editor, DEPOIS de:
--   1) aplicar a 025;  2) publicar a função `aviso-semanal`;  3) cadastrar os Secrets RESEND_API_KEY e CRON_SECRET (veja AVISOS_POR_EMAIL.md).
-- Troque os dois valores entre < >:
--   <URL_DO_PROJETO>  ex.: https://abcdefghijk.supabase.co     <MESMO_VALOR_DO_CRON_SECRET>  o texto que você cadastrou como Secret CRON_SECRET
create extension if not exists pg_net with schema extensions;
select vault.create_secret('<MESMO_VALOR_DO_CRON_SECRET>', 'cron_secret', 'Segredo do agendamento do aviso semanal');   -- se já existir, apague antes: delete from vault.secrets where name = 'cron_secret';
select cron.schedule('aviso-semanal', '0 11 * * 1',   -- toda segunda, 11:00 UTC = 08:00 em Fortaleza
  $$select net.http_post(
      url := '<URL_DO_PROJETO>/functions/v1/aviso-semanal',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{}'::jsonb)$$);
-- Para desligar:  select cron.unschedule('aviso-semanal');
