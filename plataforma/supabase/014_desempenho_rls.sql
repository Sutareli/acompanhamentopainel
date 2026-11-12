-- 014 · Desempenho do RLS: as funções de permissão (is_active, is_viewer_all, is_manager, auth.uid) passam a ser avaliadas UMA vez por consulta
-- ("(select …)" vira InitPlan) em vez de uma vez por linha. O significado das políticas não muda. Idempotente.
do $$
declare r record; q text; w text; n int := 0;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := r.qual; w := r.with_check;
    if coalesce(q,'') ~* 'select (public\.)?(is_active|is_viewer_all|is_manager|auth\.uid)' or coalesce(w,'') ~* 'select (public\.)?(is_active|is_viewer_all|is_manager|auth\.uid)' then continue; end if;
    if coalesce(q,'') !~ '(is_active|is_viewer_all|is_manager|auth\.uid)\(\)' and coalesce(w,'') !~ '(is_active|is_viewer_all|is_manager|auth\.uid)\(\)' then continue; end if;
    if q is not null then q := regexp_replace(q, '(?<![\w.])((?:public\.)?(?:is_active|is_viewer_all|is_manager)|auth\.uid)\(\)', '(select \1())', 'g'); end if;
    if w is not null then w := regexp_replace(w, '(?<![\w.])((?:public\.)?(?:is_active|is_viewer_all|is_manager)|auth\.uid)\(\)', '(select \1())', 'g'); end if;
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when q is not null then ' using (' || q || ')' else '' end,
      case when w is not null then ' with check (' || w || ')' else '' end);
    n := n + 1;
  end loop;
  raise notice '014: % política(s) otimizada(s)', n;
end $$;
