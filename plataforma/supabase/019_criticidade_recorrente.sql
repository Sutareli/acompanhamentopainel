-- 019 · Criticidade "Recorrente" em Projetos (microdeliveries). Rode depois da 018.
begin;
alter table public.microdeliveries drop constraint if exists microdeliveries_criticidade_check;
alter table public.microdeliveries add constraint microdeliveries_criticidade_check check (criticidade in ('alta','media','baixa','recorrente'));
commit;
