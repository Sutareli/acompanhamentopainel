-- 022 — SLA POR MELHORIA (cada ideia tem o seu SLA; só Analista Sr e Gerente alteram)
--   Chamado aberto → Desenvolvimento : sla_chamado_dias_uteis   (padrão 3 dias ÚTEIS, contados da abertura do chamado)
--   Desenvolvimento → Homologação    : sla_dev_dias_corridos    (padrão 15 dias CORRIDOS, contados do início do desenvolvimento)
-- Idempotente. O vencimento/atraso é calculado na tela; aqui ficam os parâmetros e a trava de permissão.
begin;

create or replace function public.is_sla_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and ativo and perfil in ('analista_sr','gerente')) $$;

drop table if exists public.melhorias_sla;   -- versão anterior (SLA único para todos), descartada

alter table public.backlog_melhorias add column if not exists sla_chamado_dias_uteis int not null default 3;
alter table public.backlog_melhorias add column if not exists sla_dev_dias_corridos int not null default 15;
alter table public.backlog_melhorias drop constraint if exists bl_sla_chk;
alter table public.backlog_melhorias add constraint bl_sla_chk check (sla_chamado_dias_uteis between 1 and 60 and sla_dev_dias_corridos between 1 and 365);

-- Quem não é Analista Sr/Gerente não cria nem altera o SLA (na criação vale o padrão).
create or replace function public.bl_sla_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.is_sla_admin() then return new; end if;   -- SQL Editor/serviço e perfis autorizados
  if tg_op = 'INSERT' then
    new.sla_chamado_dias_uteis := 3; new.sla_dev_dias_corridos := 15;
  elsif new.sla_chamado_dias_uteis is distinct from old.sla_chamado_dias_uteis or new.sla_dev_dias_corridos is distinct from old.sla_dev_dias_corridos then
    raise exception 'Somente Analista Sr e Gerente podem alterar o SLA de uma melhoria.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists a0_sla_guard on public.backlog_melhorias;
create trigger a0_sla_guard before insert or update on public.backlog_melhorias for each row execute function public.bl_sla_guard();
commit;
