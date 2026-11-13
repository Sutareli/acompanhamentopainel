-- 017 · Atas importantes: ARQUIVO (Word/PDF) opcional + texto de até 60.000 caracteres (também opcional; é preciso ter texto OU arquivo). Rode depois da 015.
-- O arquivo fica no Supabase Storage (bucket privado "atas"); a tabela guarda o caminho. Seguro para repetir.
begin;
alter table public.atas add column if not exists arquivo_path text, add column if not exists arquivo_nome text,
  add column if not exists arquivo_tamanho bigint check (arquivo_tamanho is null or arquivo_tamanho between 0 and 10485760);
alter table public.atas alter column texto drop not null;
alter table public.atas drop constraint if exists atas_texto_check;
alter table public.atas add constraint atas_texto_check check (texto is null or length(texto) <= 60000);
alter table public.atas drop constraint if exists atas_conteudo_check;
alter table public.atas add constraint atas_conteudo_check check (coalesce(length(trim(texto)), 0) > 0 or arquivo_path is not null);
-- Arquivos (migração 017): bucket privado "atas", 10 MB por arquivo, só Word/PDF; cada pessoa só acessa a própria pasta (<id do usuário>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atas', 'atas', false, 10485760, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists atas_arq_sel on storage.objects; drop policy if exists atas_arq_ins on storage.objects;
drop policy if exists atas_arq_upd on storage.objects; drop policy if exists atas_arq_del on storage.objects;
create policy atas_arq_sel on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_upd on storage.objects for update to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_del on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
