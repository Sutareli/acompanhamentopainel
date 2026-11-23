-- Validação de metas: site de cada produto (MCZ, THE, FOR ou NSS; opcional)
alter table public.metas_produtos add column if not exists site text;
alter table public.metas_produtos drop constraint if exists metas_produtos_site_chk;
alter table public.metas_produtos add constraint metas_produtos_site_chk check (site is null or site in ('MCZ','THE','FOR','NSS'));
