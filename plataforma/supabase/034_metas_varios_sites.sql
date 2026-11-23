-- Validação de metas: um produto pode ter mais de um site (substitui a coluna "site" por "sites", lista de MCZ/THE/FOR/NSS)
alter table public.metas_produtos add column if not exists sites text[] not null default '{}';
update public.metas_produtos set sites = array[site] where site is not null and sites = '{}';
alter table public.metas_produtos drop constraint if exists metas_produtos_site_chk;
alter table public.metas_produtos drop column if exists site;
alter table public.metas_produtos drop constraint if exists metas_produtos_sites_chk;
alter table public.metas_produtos add constraint metas_produtos_sites_chk check (sites <@ array['MCZ','THE','FOR','NSS']::text[]);
