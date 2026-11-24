-- 037 · Acesso da equipe (um registro por usuário por dia em que a plataforma foi aberta)
create table if not exists public.acessos (
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  dia date not null,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  pings integer not null default 1,
  origem text not null default 'app' check (origem in ('app','historico')),
  primary key (usuario_id, dia)
);
comment on table public.acessos is 'Um registro por usuário por dia (fuso de São Paulo) em que a plataforma foi aberta. origem=historico: estimado pelas ações do audit_log antes do registro existir.';
create index if not exists acessos_dia_idx on public.acessos (dia);
alter table public.acessos enable row level security;
drop policy if exists acessos_ler on public.acessos;
create policy acessos_ler on public.acessos for select to authenticated using (public.is_viewer_all() or usuario_id = auth.uid());
-- sem política de escrita: somente a função abaixo grava

create or replace function public.registrar_acesso() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if uid is null or not exists (select 1 from profiles where id = uid and ativo) then return; end if;
  insert into acessos (usuario_id, dia, primeiro_em, ultimo_em, pings, origem) values (uid, hoje, now(), now(), 1, 'app')
  on conflict (usuario_id, dia) do update set ultimo_em = now(), pings = acessos.pings + 1, origem = 'app',
    primeiro_em = case when acessos.origem = 'historico' then least(acessos.primeiro_em, now()) else acessos.primeiro_em end;
end $$;
revoke all on function public.registrar_acesso() from public, anon;
grant execute on function public.registrar_acesso() to authenticated;

-- histórico estimado: dias em que o usuário fez alguma ação registrada
insert into public.acessos (usuario_id, dia, primeiro_em, ultimo_em, pings, origem)
select a.usuario_id, (a.em at time zone 'America/Sao_Paulo')::date, min(a.em), max(a.em), count(*), 'historico'
from public.audit_log a join public.profiles p on p.id = a.usuario_id
where a.usuario_id is not null
group by a.usuario_id, (a.em at time zone 'America/Sao_Paulo')::date
on conflict do nothing;
