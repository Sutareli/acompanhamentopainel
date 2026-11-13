-- 018 · Capacidade do plano + aviso aos 95% + arquivamento das atas (backup em ZIP e exclusão exclusiva das atas). Rode depois da 017.
begin;

-- ===== Capacidade do plano e arquivamento das atas — migração 018 =====
-- O Analista Sr acompanha o uso (banco e Storage) contra os limites do plano; ao chegar no limiar (padrão 95%) a plataforma avisa. Aí ele pode gerar um backup
-- único (ZIP) com TODAS as atas (texto + arquivos) e, depois, excluir exclusivamente as atas para liberar espaço. As atas são privadas de cada pessoa: o acesso do
-- Analista Sr às atas de todos só existe numa "janela de manutenção" de 3 h, aberta apenas quando o limiar foi atingido, e fica registrada na auditoria.
create table if not exists public.capacidade_config(
  id int primary key default 1 check (id = 1),
  banco_limite_mb int not null default 500 check (banco_limite_mb > 0),         -- Free = 500 · Pro = 8192
  storage_limite_mb int not null default 1024 check (storage_limite_mb > 0),    -- Free = 1024 · Pro = 102400
  alerta_pct int not null default 95 check (alerta_pct between 50 and 100),
  atualizado_em timestamptz not null default now(), atualizado_por uuid);
insert into public.capacidade_config(id) values (1) on conflict do nothing;
alter table public.capacidade_config enable row level security;
drop policy if exists cap_sel on public.capacidade_config; drop policy if exists cap_upd on public.capacidade_config;
create policy cap_sel on public.capacidade_config for select to authenticated using ((select is_manager()));
create policy cap_upd on public.capacidade_config for update to authenticated using ((select is_manager())) with check ((select is_manager()));
revoke all on public.capacidade_config from anon;

create table if not exists public.atas_manutencao(
  id int primary key default 1 check (id = 1),
  aberta_em timestamptz, aberta_por uuid, expira_em timestamptz, corte timestamptz, backup_em timestamptz, backup_itens jsonb);
insert into public.atas_manutencao(id) values (1) on conflict do nothing;
alter table public.atas_manutencao enable row level security;      -- sem políticas: ninguém acessa direto; só pelas funções abaixo
revoke all on public.atas_manutencao from anon, authenticated;

create or replace function public.atas_manutencao_aberta() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select expira_em > now() from atas_manutencao where id = 1), false) $$;

create or replace function public.capacidade_status() returns jsonb language plpgsql security definer set search_path=public as $$
declare c capacidade_config; b bigint; s bigint; ac int; tx bigint; ar bigint; pb numeric; ps numeric;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  select * into c from capacidade_config where id = 1;
  b := pg_database_size(current_database());
  s := coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0);
  select count(*), coalesce(sum(octet_length(texto)), 0), coalesce(sum(arquivo_tamanho), 0) into ac, tx, ar from atas;
  pb := round(b * 100.0 / (c.banco_limite_mb * 1048576.0), 1);
  ps := round(s * 100.0 / (c.storage_limite_mb * 1048576.0), 1);
  return jsonb_build_object('banco_bytes', b, 'banco_limite_bytes', c.banco_limite_mb * 1048576::bigint, 'banco_pct', pb,
    'storage_bytes', s, 'storage_limite_bytes', c.storage_limite_mb * 1048576::bigint, 'storage_pct', ps,
    'alerta_pct', c.alerta_pct, 'alerta', greatest(pb, ps) >= c.alerta_pct,
    'atas_qtd', ac, 'atas_texto_bytes', tx, 'atas_arquivo_bytes', ar, 'janela_aberta', atas_manutencao_aberta());
end $$;

-- Abre a janela de manutenção (3 h). Só com o limiar atingido. Devolve o instante de corte (o backup cobre as atas até ele).
create or replace function public.atas_manutencao_abrir() returns timestamptz language plpgsql security definer set search_path=public as $$
declare st jsonb; t timestamptz := now();
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  st := capacidade_status();
  if not (st->>'alerta')::boolean then raise exception 'O uso ainda não chegou a % %% do plano; o arquivamento das atas só é liberado a partir daí.', st->>'alerta_pct'; end if;
  update atas_manutencao set aberta_em = t, aberta_por = auth.uid(), expira_em = t + interval '3 hours', corte = t, backup_em = null, backup_itens = null where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ABRIR', jsonb_build_object('atas', st->'atas_qtd', 'storage_pct', st->'storage_pct', 'banco_pct', st->'banco_pct'));
  return t;
end $$;

-- Registra que o backup foi gerado: lista de {id, u} (id da ata e atualizado_em) que ENTRARAM no arquivo. Só essas, sem alteração depois, poderão ser excluídas.
create or replace function public.atas_backup_registrar(p_itens jsonb) returns int language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  update atas_manutencao set backup_em = now(), backup_itens = p_itens where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'BACKUP', jsonb_build_object('atas', jsonb_array_length(p_itens)));
  return jsonb_array_length(p_itens);
end $$;

-- Exclui EXCLUSIVAMENTE as atas que estão no backup registrado (e que não foram alteradas depois). Não vai para a Lixeira (o backup é a cópia). Devolve os caminhos dos arquivos para a tela removê-los do Storage.
create or replace function public.atas_esvaziar(p_confirmacao text) returns jsonb language plpgsql security definer set search_path=public as $$
declare m atas_manutencao; n int; caminhos jsonb;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_confirmacao is distinct from 'EXCLUIR ATAS' then raise exception 'Confirmação inválida.'; end if;
  select * into m from atas_manutencao where id = 1 for update;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if m.backup_em is null or m.backup_itens is null then raise exception 'Gere e baixe o backup antes de excluir.'; end if;
  perform set_config('app.purge', '1', true);        -- não copia para a Lixeira
  with alvo as (
    select a.id, a.arquivo_path from atas a join jsonb_to_recordset(m.backup_itens) as x(id uuid, u timestamptz) on x.id = a.id and a.atualizado_em = x.u),
  del as (delete from atas where id in (select id from alvo) returning arquivo_path)
  select count(*), coalesce(jsonb_agg(arquivo_path) filter (where arquivo_path is not null), '[]'::jsonb) into n, caminhos from del;
  perform set_config('app.purge', '', true);
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ESVAZIAR', jsonb_build_object('atas_excluidas', n));
  return jsonb_build_object('excluidas', n, 'caminhos', caminhos);
end $$;

create or replace function public.atas_manutencao_fechar() returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  update atas_manutencao set expira_em = now(), backup_itens = null where id = 1;
end $$;
revoke execute on function public.atas_manutencao_aberta(), public.capacidade_status(), public.atas_manutencao_abrir(), public.atas_backup_registrar(jsonb), public.atas_esvaziar(text), public.atas_manutencao_fechar() from public, anon;

-- Janela de manutenção aberta: o Analista Sr lê as atas de todos (para o backup) e lê/remove os arquivos do bucket "atas".
drop policy if exists atas_sel_manut on public.atas;
create policy atas_sel_manut on public.atas for select to authenticated using ((select is_manager()) and (select atas_manutencao_aberta()));
drop policy if exists atas_arq_sel_manut on storage.objects; drop policy if exists atas_arq_del_manut on storage.objects;
create policy atas_arq_sel_manut on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));
create policy atas_arq_del_manut on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));

commit;
