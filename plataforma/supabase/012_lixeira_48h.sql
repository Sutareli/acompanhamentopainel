-- MIGRAÇÃO 012 — Lixeira de 48 horas (desfazer exclusões). Execute UMA vez, depois da 011. Não apaga dados.
begin;
-- ===== Lixeira de 48 horas (desfazer exclusões) — migração 012 =====
-- Tudo que é excluído em Projetos, atividades/etapas do Backlog, Ideias, Agenda (reuniões) e Imprevistos vai para a lixeira por 48 h e pode ser restaurado
-- (quem excluiu ou o Analista Sr). Usuários excluídos ficam bloqueados por 48 h (podem ser restaurados) e só depois são removidos de vez.
alter table public.profiles add column excluido_em timestamptz, add column excluido_por uuid;
create table public.lixeira(
  id uuid primary key default gen_random_uuid(),
  tabela text not null, registro_id uuid not null, rotulo text,
  dados jsonb not null, filhos jsonb not null default '{}',          -- cópia da linha e dos registros ligados (histórico do projeto, etapas da atividade)
  excluido_por uuid default auth.uid(), excluido_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '48 hours', restaurado_em timestamptz);
create index on public.lixeira(expira_em);
alter table public.lixeira enable row level security;
create policy lx_sel on public.lixeira for select to authenticated
  using (is_active() and restaurado_em is null and expira_em > now() and (excluido_por = auth.uid() or is_manager()));
create policy lx_del on public.lixeira for delete to authenticated using (is_manager());   -- “Remover definitivamente” (Analista Sr)

create function public.lixeira_captura() returns trigger language plpgsql security definer set search_path=public as $$
declare v_rot text; v_filhos jsonb := '{}';
begin
  if coalesce(current_setting('app.purge', true),'') = '1' then return old; end if;   -- remoção definitiva (expirou) não volta para a lixeira
  if tg_table_name = 'microdeliveries' then
    v_rot := old.demanda;
    v_filhos := jsonb_build_object('microdelivery_history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) from microdelivery_history h where h.microdelivery_id = old.id));
  elsif tg_table_name = 'backlog_melhorias' then
    v_rot := old.melhoria;
    v_filhos := jsonb_build_object('backlog_etapas', (select coalesce(jsonb_agg(to_jsonb(e) order by e.ordem), '[]'::jsonb) from backlog_etapas e where e.melhoria_id = old.id));
  elsif tg_table_name = 'backlog_etapas' then
    if not exists (select 1 from backlog_melhorias m where m.id = old.melhoria_id) then return old; end if;   -- etapa removida junto com a atividade: já está na cópia da atividade
    v_rot := old.como;
  elsif tg_table_name = 'ideas' then v_rot := old.titulo;
  elsif tg_table_name = 'agenda' then v_rot := old.assunto;
  elsif tg_table_name = 'imprevistos' then v_rot := old.descricao;
  end if;
  insert into lixeira(tabela, registro_id, rotulo, dados, filhos) values (tg_table_name, old.id, left(coalesce(v_rot,''), 200), to_jsonb(old), v_filhos);
  return old;
end $$;
do $$ declare t text; begin
  foreach t in array array['microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos'] loop
    execute format('create trigger lixeira_%1$s before delete on public.%1$I for each row execute function lixeira_captura()', t);
  end loop; end $$;

-- Reinsere linha(s) a partir da cópia JSON, ignorando colunas geradas (ex.: mes_referencia). Uso interno.
create function public.lixeira_inserir(p_tab text, p_dados jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_cols text;
begin
  if p_tab not in ('microdeliveries','microdelivery_history','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos') then raise exception 'Tabela não restaurável.'; end if;
  select string_agg(quote_ident(attname), ',' order by attnum) into v_cols from pg_attribute
   where attrelid = ('public.' || quote_ident(p_tab))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  if p_dados is null or jsonb_typeof(p_dados) = 'null' or p_dados = '[]'::jsonb then return; end if;
  execute format('insert into public.%1$I (%2$s) overriding system value select %2$s from %3$s(null::public.%1$I, $1)', p_tab, v_cols,
                 case when jsonb_typeof(p_dados) = 'array' then 'jsonb_populate_recordset' else 'jsonb_populate_record' end) using p_dados;
end $$;

create function public.lixeira_restaurar(p_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare r lixeira%rowtype;
begin
  select * into r from lixeira where id = p_id and restaurado_em is null and expira_em > now() for update;
  if not found then raise exception 'Item não encontrado ou o prazo de 48 horas já terminou.'; end if;
  if not (is_active() and (is_manager() or r.excluido_por = auth.uid())) then raise exception 'Sem permissão para restaurar este item.'; end if;
  if r.tabela not in ('microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos') then raise exception 'Tabela não restaurável.'; end if;
  perform set_config('app.sync', '1', true);   -- preserva origem/chamado_chave do Backlog na restauração
  begin
    perform lixeira_inserir(r.tabela, r.dados);
    if r.tabela = 'microdeliveries' then
      delete from microdelivery_history where microdelivery_id = r.registro_id;   -- remove o registro de “criação” gerado automaticamente; volta o histórico original
      perform lixeira_inserir('microdelivery_history', r.filhos->'microdelivery_history');
    elsif r.tabela = 'backlog_melhorias' then
      perform lixeira_inserir('backlog_etapas', r.filhos->'backlog_etapas');
    end if;
  exception
    when foreign_key_violation then raise exception 'Não foi possível restaurar: um registro ligado (por exemplo, o responsável ou a atividade) não existe mais.';
    when unique_violation then raise exception 'Não foi possível restaurar: já existe um item equivalente (por exemplo, a reimportação de chamados recriou a atividade).';
  end;
  perform set_config('app.sync', '', true);
  update lixeira set restaurado_em = now() where id = p_id;
  return r.rotulo;
end $$;

-- Exclusão de usuário passa a ser REVERSÍVEL por 48 h: o acesso é bloqueado e o usuário some das listas; depois disso é removido de vez (lixeira_purgar).
create or replace function public.usuario_excluir(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int; nm text;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode excluir usuários.'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  select nome into nm from profiles where id = p_id and excluido_em is null;
  if nm is null then raise exception 'Usuário não encontrado.'; end if;
  select count(*) into n from microdeliveries where responsavel_id = p_id or criado_por = p_id or com_quem_id = p_id;
  if n > 0 then raise exception '% ainda está ligado a % projeto(s) (responsável, criador ou “com quem está”). Reatribua ou exclua esses projetos antes de excluir o usuário.', nm, n; end if;
  update profiles set ativo = false, excluido_em = now(), excluido_por = auth.uid() where id = p_id;
  update auth.users set banned_until = 'infinity' where id = p_id;   -- impede novo login enquanto estiver na lixeira
end $$;
create function public.usuario_restaurar(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode restaurar usuários.'; end if;
  update profiles set ativo = true, excluido_em = null, excluido_por = null where id = p_id and excluido_em is not null and excluido_em > now() - interval '48 hours';
  if not found then raise exception 'Usuário não encontrado ou o prazo de 48 horas já terminou.'; end if;
  update auth.users set banned_until = null where id = p_id;
end $$;

-- Limpeza: remove da lixeira o que passou de 48 h e apaga de vez os usuários excluídos há mais de 48 h. Chamada pela verificação semanal e ao abrir a Lixeira.
create function public.lixeira_purgar() returns int language plpgsql security definer set search_path=public as $$
declare r record; n int := 0;
begin
  delete from lixeira where expira_em < now() or restaurado_em < now() - interval '7 days';
  perform set_config('app.purge', '1', true);
  for r in select id from profiles where excluido_em is not null and excluido_em < now() - interval '48 hours' loop
    delete from auth.users where id = r.id; n := n + 1;
  end loop;
  perform set_config('app.purge', '', true);
  return n;
end $$;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb), public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() from public, anon;
grant execute on function public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() to authenticated, service_role;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) from authenticated;
grant execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) to service_role;
commit;
