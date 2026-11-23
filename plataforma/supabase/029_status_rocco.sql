-- 029 · "Semanal Italo" passa a se chamar "Status Rocco": novo título padrão e renomeia as semanais já criadas com o título antigo.
alter table public.semanais alter column titulo set default 'Status Rocco';
update public.semanais set titulo = 'Status Rocco' where titulo = 'Semanal Italo';
