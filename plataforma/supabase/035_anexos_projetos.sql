-- Projetos e atividades: anexos de documentação (PDF, DOC ou DOCX, até 10 MB cada)
-- Arquivos ficam em um bucket PRIVADO do Storage; a tabela guarda nome, tamanho e autor. Quem pode ver/anexar segue a regra dos comentários
-- (qualquer usuário ativo); remover: quem anexou ou o Analista Sr.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos-projetos', 'anexos-projetos', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.anexos_projetos(
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.microdeliveries(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  tamanho integer not null check (tamanho between 1 and 10485760),
  tipo text not null,
  caminho text not null unique,
  criado_por uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  criado_em timestamptz not null default now());
create index if not exists anexos_projetos_proj_idx on public.anexos_projetos(projeto_id, criado_em);
alter table public.anexos_projetos enable row level security;
drop policy if exists anx_sel on public.anexos_projetos; drop policy if exists anx_ins on public.anexos_projetos; drop policy if exists anx_del on public.anexos_projetos;
create policy anx_sel on public.anexos_projetos for select to authenticated using (public.is_active());
create policy anx_ins on public.anexos_projetos for insert to authenticated with check (
  public.is_active() and criado_por = auth.uid() and caminho like projeto_id::text || '/%'
  and (select count(*) from public.anexos_projetos a where a.projeto_id = anexos_projetos.projeto_id) < 30);
create policy anx_del on public.anexos_projetos for delete to authenticated using (public.is_active() and (criado_por = auth.uid() or public.is_manager()));
grant select, insert, delete on public.anexos_projetos to authenticated;

-- Storage: a pasta de cada arquivo é o id do projeto
drop policy if exists anx_obj_sel on storage.objects; drop policy if exists anx_obj_ins on storage.objects; drop policy if exists anx_obj_del on storage.objects;
create policy anx_obj_sel on storage.objects for select to authenticated using (bucket_id = 'anexos-projetos' and public.is_active());
create policy anx_obj_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'anexos-projetos' and public.is_active()
  and exists (select 1 from public.microdeliveries m where m.id::text = (storage.foldername(name))[1]));
create policy anx_obj_del on storage.objects for delete to authenticated using (
  bucket_id = 'anexos-projetos' and public.is_active()
  and (exists (select 1 from public.anexos_projetos a where a.caminho = name and (a.criado_por = auth.uid() or public.is_manager()))
    or not exists (select 1 from public.anexos_projetos a where a.caminho = name)));   -- arquivo sem registro (envio que falhou) pode ser limpo
