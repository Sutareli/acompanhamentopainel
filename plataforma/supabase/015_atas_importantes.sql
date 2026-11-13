-- 015 · Atas importantes (substitui o registro de reuniões) + suporte da Lixeira de 48 h às atas. Rode depois da 014.
begin;

-- Cada pessoa guarda as atas das reuniões que fez: nome, data, breve resumo e o TEXTO COMPLETO da ata (colado numa caixa de texto, até 50 mil caracteres).
-- Tudo fica na tabela (sem arquivos e sem Storage): ~10 KB por ata. Visível e editável SOMENTE pelo dono (nem gerente/diretor leem as atas dos outros).
create table if not exists public.atas(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  data_reuniao date not null,
  resumo text check (resumo is null or length(resumo) <= 1000),
  texto text not null check (length(trim(texto)) > 0 and length(texto) <= 50000),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index if not exists atas_user_data on public.atas(user_id, data_reuniao desc);
alter table public.atas enable row level security;
drop policy if exists atas_sel on public.atas; drop policy if exists atas_ins on public.atas; drop policy if exists atas_upd on public.atas; drop policy if exists atas_del on public.atas;
create policy atas_sel on public.atas for select to authenticated using ((select is_active()) and user_id = (select auth.uid()));
create policy atas_ins on public.atas for insert to authenticated with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_upd on public.atas for update to authenticated using ((select is_active()) and user_id = (select auth.uid())) with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_del on public.atas for delete to authenticated using ((select is_active()) and user_id = (select auth.uid()));
revoke all on public.atas from anon;
drop trigger if exists touch_atas on public.atas;
create trigger touch_atas before update on public.atas for each row execute function touch_updated();

-- Lixeira: atas passam a ser restauráveis por 48 h (a ata inteira volta).
create or replace function public.lixeira_captura() returns trigger language plpgsql security definer set search_path=public as $$
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
  elsif tg_table_name = 'atas' then v_rot := old.nome;
  end if;
  insert into lixeira(tabela, registro_id, rotulo, dados, filhos) values (tg_table_name, old.id, left(coalesce(v_rot,''), 200), to_jsonb(old), v_filhos);
  return old;
end $$;

create or replace function public.lixeira_inserir(p_tab text, p_dados jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_cols text;
begin
  if p_tab not in ('microdeliveries','microdelivery_history','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
  select string_agg(quote_ident(attname), ',' order by attnum) into v_cols from pg_attribute
   where attrelid = ('public.' || quote_ident(p_tab))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  if p_dados is null or jsonb_typeof(p_dados) = 'null' or p_dados = '[]'::jsonb then return; end if;
  execute format('insert into public.%1$I (%2$s) overriding system value select %2$s from %3$s(null::public.%1$I, $1)', p_tab, v_cols,
                 case when jsonb_typeof(p_dados) = 'array' then 'jsonb_populate_recordset' else 'jsonb_populate_record' end) using p_dados;
end $$;

create or replace function public.lixeira_restaurar(p_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare r lixeira%rowtype;
begin
  select * into r from lixeira where id = p_id and restaurado_em is null and expira_em > now() for update;
  if not found then raise exception 'Item não encontrado ou o prazo de 48 horas já terminou.'; end if;
  if not (is_active() and (is_manager() or r.excluido_por = auth.uid())) then raise exception 'Sem permissão para restaurar este item.'; end if;
  if r.tabela not in ('microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
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

drop trigger if exists lixeira_atas on public.atas;
create trigger lixeira_atas before delete on public.atas for each row execute function lixeira_captura();
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb), public.lixeira_restaurar(uuid) from public, anon;
revoke execute on function public.lixeira_inserir(text, jsonb) from authenticated;

commit;
