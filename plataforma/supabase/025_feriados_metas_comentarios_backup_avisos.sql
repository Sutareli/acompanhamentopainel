-- 025 — Feriados no SLA · metas de chamados · comentários/menções · backup semanal · desfazer carga de chamados · base dos avisos semanais.
-- Idempotente (pode rodar de novo). Pré-requisitos: migrações até a 023 (usa is_active(), is_manager(), is_sla_admin()).
begin;

-- ===== 1) Feriados (descontados do SLA em "dias úteis") =====
create table if not exists public.feriados(
  data date primary key,
  nome text not null check (length(trim(nome)) between 1 and 80),
  criado_por uuid default auth.uid());
alter table public.feriados enable row level security;
drop policy if exists fer_sel on public.feriados; drop policy if exists fer_ins on public.feriados; drop policy if exists fer_upd on public.feriados; drop policy if exists fer_del on public.feriados;
create policy fer_sel on public.feriados for select to authenticated using (public.is_active());
create policy fer_ins on public.feriados for insert to authenticated with check (public.is_sla_admin());
create policy fer_upd on public.feriados for update to authenticated using (public.is_sla_admin()) with check (public.is_sla_admin());
create policy fer_del on public.feriados for delete to authenticated using (public.is_sla_admin());
grant select, insert, update, delete on public.feriados to authenticated;
insert into public.feriados(data, nome) values
 ('2026-01-01','Confraternização Universal'),('2026-04-03','Sexta-feira Santa'),('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),('2026-06-04','Corpus Christi'),
 ('2026-09-07','Independência'),('2026-10-12','Nossa Sra. Aparecida'),('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Consciência Negra'),('2026-12-25','Natal'),
 ('2027-01-01','Confraternização Universal'),('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),('2027-05-27','Corpus Christi'),
 ('2027-09-07','Independência'),('2027-10-12','Nossa Sra. Aparecida'),('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Consciência Negra'),('2027-12-25','Natal'),
 ('2028-01-01','Confraternização Universal'),('2028-04-14','Sexta-feira Santa'),('2028-04-21','Tiradentes'),('2028-05-01','Dia do Trabalho'),('2028-06-15','Corpus Christi'),
 ('2028-09-07','Independência'),('2028-10-12','Nossa Sra. Aparecida'),('2028-11-02','Finados'),('2028-11-15','Proclamação da República'),('2028-11-20','Consciência Negra'),('2028-12-25','Natal')
on conflict (data) do nothing;

-- soma N dias úteis (segunda a sexta, sem feriados); a data inicial não conta. Espelha src/lib/sla.ts
create or replace function public.somar_dias_uteis(p_ini date, p_n int) returns date language plpgsql stable set search_path=public as $$
declare d date := p_ini; k int := 0;
begin
  while k < coalesce(p_n,0) loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists(select 1 from public.feriados f where f.data = d) then k := k + 1; end if;
  end loop;
  return d;
end $$;
grant execute on function public.somar_dias_uteis(date,int) to authenticated;

-- ===== 2) Metas da análise de chamados (linha única) =====
create table if not exists public.chamados_metas(
  id int primary key default 1 check (id = 1),
  meta_total_mes int check (meta_total_mes is null or meta_total_mes >= 0),
  meta_pct_prazo numeric(5,2) check (meta_pct_prazo is null or (meta_pct_prazo between 0 and 100)),
  atualizado_por uuid, atualizado_em timestamptz not null default now());
insert into public.chamados_metas(id) values (1) on conflict (id) do nothing;
alter table public.chamados_metas enable row level security;
drop policy if exists cm_sel on public.chamados_metas; drop policy if exists cm_upd on public.chamados_metas;
create policy cm_sel on public.chamados_metas for select to authenticated using (public.is_active());
create policy cm_upd on public.chamados_metas for update to authenticated using (public.is_sla_admin()) with check (public.is_sla_admin());
grant select, update on public.chamados_metas to authenticated;
create or replace function public.cm_carimbo() returns trigger language plpgsql as $$ begin new.atualizado_por := auth.uid(); new.atualizado_em := now(); return new; end $$;
drop trigger if exists cm_carimbo on public.chamados_metas;
create trigger cm_carimbo before update on public.chamados_metas for each row execute function public.cm_carimbo();

-- ===== 3) Comentários e menções (ideias/melhorias/correções e atividades/projetos) =====
create table if not exists public.comentarios(
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('melhoria','atividade')),
  entidade_id uuid not null,
  autor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  texto text not null check (length(trim(texto)) between 1 and 2000),
  mencoes uuid[] not null default '{}',
  criado_em timestamptz not null default now());
create index if not exists comentarios_ent_idx on public.comentarios(entidade, entidade_id, criado_em);
create index if not exists comentarios_menc_idx on public.comentarios using gin(mencoes);
alter table public.comentarios enable row level security;
drop policy if exists com_sel on public.comentarios; drop policy if exists com_ins on public.comentarios; drop policy if exists com_del on public.comentarios;
create policy com_sel on public.comentarios for select to authenticated using (public.is_active());
create policy com_ins on public.comentarios for insert to authenticated with check (
  public.is_active() and autor_id = auth.uid()
  and ((entidade = 'melhoria' and exists(select 1 from public.backlog_melhorias b where b.id = entidade_id))
    or (entidade = 'atividade' and exists(select 1 from public.microdeliveries m where m.id = entidade_id))));
create policy com_del on public.comentarios for delete to authenticated using (public.is_active() and (autor_id = auth.uid() or public.is_manager()));
grant select, insert, delete on public.comentarios to authenticated;

-- ===== 4) Backup semanal (cópia interna) + exportação manual =====
-- Não inclui jornadas pessoais nem atas (são privadas por usuário). Só o Analista Sr lê.
create table if not exists public.backup_snapshots(
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem text not null check (origem in ('semanal','manual')),
  qtd_linhas int not null default 0,
  dados jsonb not null);
alter table public.backup_snapshots enable row level security;
drop policy if exists bk_sel on public.backup_snapshots;
create policy bk_sel on public.backup_snapshots for select to authenticated using (public.is_manager());
grant select on public.backup_snapshots to authenticated;

create or replace function public.backup_dados() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'microdeliveries', coalesce((select jsonb_agg(to_jsonb(t)) from public.microdeliveries t), '[]'::jsonb),
    'backlog_melhorias', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_melhorias t), '[]'::jsonb),
    'backlog_etapas', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_etapas t), '[]'::jsonb),
    'backlog_chamados', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_chamados t), '[]'::jsonb),
    'atividades_futuras', coalesce((select jsonb_agg(to_jsonb(t)) from public.atividades_futuras t), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(to_jsonb(t)) from public.feriados t), '[]'::jsonb),
    'chamados_metas', coalesce((select jsonb_agg(to_jsonb(t)) from public.chamados_metas t), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(to_jsonb(t)) from public.comentarios t), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'perfil', p.perfil, 'ativo', p.ativo)) from public.profiles p), '[]'::jsonb))
$$;
revoke all on function public.backup_dados() from public, anon, authenticated;

create or replace function public.backup_gerar(p_origem text default 'semanal') returns bigint language plpgsql security definer set search_path=public as $$
declare d jsonb; n int; novo bigint;
begin
  if p_origem not in ('semanal','manual') then raise exception 'origem inválida'; end if;
  d := public.backup_dados();
  n := (select coalesce(sum(jsonb_array_length(v)),0) from jsonb_each(d) e(k,v) where jsonb_typeof(v) = 'array');
  insert into public.backup_snapshots(origem, qtd_linhas, dados) values (p_origem, n, d) returning id into novo;
  delete from public.backup_snapshots s where s.origem = p_origem
    and s.id not in (select id from public.backup_snapshots where origem = p_origem order by id desc limit 8);   -- guarda os 8 mais recentes de cada origem
  return novo;
end $$;
revoke all on function public.backup_gerar(text) from public, anon, authenticated;

create or replace function public.backup_gerar_manual() returns bigint language plpgsql security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode gerar backup.'; end if;
  return public.backup_gerar('manual');
end $$;
revoke all on function public.backup_gerar_manual() from public, anon;
grant execute on function public.backup_gerar_manual() to authenticated;

create or replace function public.backup_exportar() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode exportar o backup.'; end if;
  return public.backup_dados();
end $$;
revoke all on function public.backup_exportar() from public, anon;
grant execute on function public.backup_exportar() to authenticated;

-- agenda o backup toda segunda, 06:00 UTC (03:00 em Fortaleza), se o pg_cron estiver ativo
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('backup-semanal', '0 6 * * 1', $c$select public.backup_gerar('semanal')$c$);
  end if;
end $$;

-- ===== 5) Desfazer a última carga da base de chamados =====
-- Antes de a base ser substituída (delete em backlog_chamados), guarda uma cópia. "Desfazer" devolve a base anterior (e guarda a atual: dá para desfazer o desfazer).
-- Atenção: atividades do Backlog já geradas pela carga errada NÃO são apagadas (a sincronização nunca apaga nada).
create table if not exists public.backlog_chamados_anterior(
  id int primary key default 1 check (id = 1),
  salvo_em timestamptz not null default now(),
  qtd int not null, dados jsonb not null);
alter table public.backlog_chamados_anterior enable row level security;
drop policy if exists bca_sel on public.backlog_chamados_anterior;
create policy bca_sel on public.backlog_chamados_anterior for select to authenticated using (public.is_manager());
grant select on public.backlog_chamados_anterior to authenticated;

create or replace function public.chamados_guardar_anterior() returns trigger language plpgsql security definer set search_path=public as $$
declare n int; d jsonb;
begin
  select count(*), coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into n, d from public.backlog_chamados c;
  if n > 0 then
    insert into public.backlog_chamados_anterior(id, salvo_em, qtd, dados) values (1, now(), n, d)
    on conflict (id) do update set salvo_em = excluded.salvo_em, qtd = excluded.qtd, dados = excluded.dados;
  end if;
  return null;
end $$;
drop trigger if exists bc_guardar_anterior on public.backlog_chamados;
create trigger bc_guardar_anterior before delete on public.backlog_chamados for each statement execute function public.chamados_guardar_anterior();

create or replace function public.chamados_desfazer_carga() returns int language plpgsql security definer set search_path=public as $$
declare d jsonb; n int;
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode desfazer a carga.'; end if;
  select dados, qtd into d, n from public.backlog_chamados_anterior where id = 1;
  if d is null then raise exception 'Não há carga anterior guardada.'; end if;
  delete from public.backlog_chamados where true;            -- o gatilho guarda a base atual no lugar da anterior
  insert into public.backlog_chamados select * from jsonb_populate_recordset(null::public.backlog_chamados, d);
  insert into public.backlog_chamados_carga(qtd) values (n);
  return n;
end $$;
revoke all on function public.chamados_desfazer_carga() from public, anon;
grant execute on function public.chamados_desfazer_carga() to authenticated;

-- ===== 6) Avisos semanais por e-mail (dados + destinatários) =====
create table if not exists public.avisos_config(
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  emails text[] not null default '{}',
  ultimo_envio timestamptz,
  ultimo_resultado text);
insert into public.avisos_config(id, emails) values (1, array['jsilas@almavivadobrasil.com.br']) on conflict (id) do nothing;
alter table public.avisos_config enable row level security;
drop policy if exists av_sel on public.avisos_config; drop policy if exists av_upd on public.avisos_config;
create policy av_sel on public.avisos_config for select to authenticated using (public.is_manager());
create policy av_upd on public.avisos_config for update to authenticated using (public.is_manager()) with check (public.is_manager());
grant select, update(ativo, emails) on public.avisos_config to authenticated;

-- Números do aviso. Só a chave de serviço (Edge Function) executa.
create or replace function public.avisos_dados() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare hoje date := (now() at time zone 'America/Fortaleza')::date; r jsonb;
begin
  with m as (
    select b.*, 
      case when b.fase = 'chamado_aberto' and b.data_abertura is not null then public.somar_dias_uteis(b.data_abertura, coalesce(b.sla_chamado_dias_uteis,3))
           when b.fase = 'em_desenvolvimento' and b.data_inicio is not null then b.data_inicio + coalesce(b.sla_dev_dias_corridos,15) end as sla_venc
    from public.backlog_melhorias b where b.tipo_backlog = 'melhoria'),
  pv as (select melhoria as titulo, modulo, responsavel, hoje - data_termino as dias from m where data_termino < hoje and fase <> 'producao' order by dias desc),
  sv as (select melhoria as titulo, modulo, responsavel, hoje - sla_venc as dias from m where sla_venc is not null and sla_venc < hoje and fase in ('chamado_aberto','em_desenvolvimento') order by dias desc),
  sr as (select melhoria as titulo, modulo, null::text as responsavel, hoje - criado_em::date as dias from m where responsavel_id is null and fase <> 'producao' order by dias desc),
  cv as (select melhoria as titulo, modulo, responsavel, hoje - data_termino as dias from public.backlog_melhorias where tipo_backlog = 'correcao' and data_termino < hoje and status <> 'Concluído' order by dias desc),
  av as (select demanda as titulo, tipo_projeto as modulo, (select nome from public.profiles p where p.id = d.responsavel_id) as responsavel, hoje - data_target as dias
           from public.microdeliveries d where data_target < hoje and quantidade - concluido - cancelado > 0 order by dias desc)
  select jsonb_build_object('hoje', hoje,
    'melhorias_prazo_vencido', jsonb_build_object('total', (select count(*) from pv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pv limit 10) x), '[]'::jsonb)),
    'melhorias_sla_vencido',   jsonb_build_object('total', (select count(*) from sv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sv limit 10) x), '[]'::jsonb)),
    'melhorias_sem_responsavel', jsonb_build_object('total', (select count(*) from sr), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sr limit 10) x), '[]'::jsonb)),
    'correcoes_prazo_vencido', jsonb_build_object('total', (select count(*) from cv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from cv limit 10) x), '[]'::jsonb)),
    'atividades_prazo_vencido', jsonb_build_object('total', (select count(*) from av), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from av limit 10) x), '[]'::jsonb)))
  into r;
  return r;
end $$;
revoke all on function public.avisos_dados() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.avisos_dados() to service_role; end if; end $$;

commit;
