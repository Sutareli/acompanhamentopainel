-- MIGRAÇÃO 011 — Botões “Excluir” em Projetos e Usuários. Execute UMA vez, depois da 010.
begin;
-- ===== Excluir projetos e usuários — migração 011 =====
-- Projetos: o criador (ou o Analista Sr) pode excluir; o histórico do projeto vai junto e a cópia completa fica na auditoria (audit_log).
alter table public.microdelivery_history drop constraint microdelivery_history_microdelivery_id_fkey;
alter table public.microdelivery_history add constraint microdelivery_history_microdelivery_id_fkey foreign key (microdelivery_id) references public.microdeliveries(id) on delete cascade;
create policy md_del on public.microdeliveries for delete to authenticated using (is_active() and (criado_por = auth.uid() or is_manager()));
-- Usuários: a autoria em históricos deixa de impedir a exclusão (fica em branco).
alter table public.microdelivery_history drop constraint microdelivery_history_usuario_id_fkey;
alter table public.microdelivery_history add constraint microdelivery_history_usuario_id_fkey foreign key (usuario_id) references public.profiles(id) on delete set null;
-- Exclusão de usuário (somente Analista Sr). Remove o acesso (auth.users) e, em cascata, o perfil e os dados pessoais (jornadas, agenda, ideias, modelos…).
-- Bloqueia: excluir a si mesmo; usuário que ainda é responsável/criador de projetos (reatribua ou exclua os projetos antes).
create function public.usuario_excluir(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int; nm text;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode excluir usuários.'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  select nome into nm from profiles where id = p_id;
  if nm is null then raise exception 'Usuário não encontrado.'; end if;
  select count(*) into n from microdeliveries where responsavel_id = p_id or criado_por = p_id or com_quem_id = p_id;
  if n > 0 then raise exception '% ainda está ligado a % projeto(s) (responsável, criador ou “com quem está”). Reatribua ou exclua esses projetos antes de excluir o usuário.', nm, n; end if;
  delete from auth.users where id = p_id;
end $$;
revoke execute on function public.usuario_excluir(uuid) from public, anon;
grant execute on function public.usuario_excluir(uuid) to authenticated, service_role;
commit;
