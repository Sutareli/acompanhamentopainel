-- Testes da migração 025. Rode em um Postgres de TESTE (nunca no banco de produção): psql -v ON_ERROR_STOP=1 -f tests/sql/025_testes.sql
-- Exige o esquema completo (001_schema.sql + 025) e o papel "authenticated". Termina com a linha "TODOS OS TESTES PASSARAM".
\set ON_ERROR_STOP 1
begin;   -- tudo é desfeito no final (rollback)
create or replace function pg_temp.ck(nome text, ok boolean) returns void language plpgsql as $$ begin if not ok then raise exception 'FALHOU: %', nome; end if; raise notice 'ok - %', nome; end $$;

-- usuários de teste (um por perfil)
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','sr@t'),('00000000-0000-0000-0000-0000000000a2','ger@t'),('00000000-0000-0000-0000-0000000000a3','an@t'),('00000000-0000-0000-0000-0000000000a4','gu@t') on conflict do nothing;
insert into public.profiles(id,nome,email,perfil,ativo) values
 ('00000000-0000-0000-0000-0000000000a1','Sr','sr@t','analista_sr',true),('00000000-0000-0000-0000-0000000000a2','Ger','ger@t','gerente',true),
 ('00000000-0000-0000-0000-0000000000a3','An','an@t','analista',true),('00000000-0000-0000-0000-0000000000a4','Gu','gu@t','guardiao',true)
 on conflict (id) do update set perfil = excluded.perfil, ativo = true;

-- 1) dias úteis com feriado: sexta 2026-04-03 é Sexta-feira Santa; sair de qui 2026-04-02 +1 dia útil = seg 2026-04-06
select pg_temp.ck('feriado pulado (qui 02/04 + 1 útil = seg 06/04)', public.somar_dias_uteis('2026-04-02', 1) = '2026-04-06');
select pg_temp.ck('sem feriado: seg 06/04 + 3 úteis = qui 09/04', public.somar_dias_uteis('2026-04-06', 3) = '2026-04-09');
select pg_temp.ck('fim de semana: sex 10/04 + 1 útil = seg 13/04', public.somar_dias_uteis('2026-04-10', 1) = '2026-04-13');

-- 2) permissões de feriados / metas
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false) \gset
do $$ begin
  begin insert into public.feriados(data,nome) values ('2026-12-24','Teste'); perform pg_temp.ck('analista NÃO insere feriado', false);
  exception when insufficient_privilege or others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('analista NÃO insere feriado', true); end;
  update public.chamados_metas set meta_total_mes = 10;
  perform pg_temp.ck('analista NÃO altera metas', (select meta_total_mes is distinct from 10 from public.chamados_metas));
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false) \gset
do $$ begin
  insert into public.feriados(data,nome) values ('2026-12-24','Véspera'); perform pg_temp.ck('gerente insere feriado', exists(select 1 from public.feriados where data='2026-12-24'));
  update public.chamados_metas set meta_total_mes = 120, meta_pct_prazo = 90;
  perform pg_temp.ck('gerente altera metas', (select meta_total_mes = 120 and meta_pct_prazo = 90 and atualizado_por = auth.uid() from public.chamados_metas));
  begin update public.chamados_metas set meta_pct_prazo = 120; perform pg_temp.ck('meta > 100% rejeitada', false);
  exception when check_violation then perform pg_temp.ck('meta > 100% rejeitada', true); end;
end $$;
reset role;

-- 3) comentários
insert into public.backlog_melhorias(modulo,melhoria,criado_por,tipo_backlog) values ('M','Ideia de teste','00000000-0000-0000-0000-0000000000a3','melhoria');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false) \gset
do $$ declare mid uuid := (select id from public.backlog_melhorias where melhoria='Ideia de teste'); begin
  insert into public.comentarios(entidade, entidade_id, texto, mencoes) values ('melhoria', mid, 'oi @Sr', array['00000000-0000-0000-0000-0000000000a1']::uuid[]);
  perform pg_temp.ck('analista comenta', (select count(*) = 1 from public.comentarios));
  begin insert into public.comentarios(entidade, entidade_id, texto) values ('melhoria', gen_random_uuid(), 'x'); perform pg_temp.ck('comentário em item inexistente barrado', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('comentário em item inexistente barrado', true); end;
  begin insert into public.comentarios(entidade, entidade_id, texto, autor_id) values ('melhoria', mid, 'x', '00000000-0000-0000-0000-0000000000a1'); perform pg_temp.ck('não comenta em nome de outro', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('não comenta em nome de outro', true); end;
  begin insert into public.comentarios(entidade, entidade_id, texto) values ('melhoria', mid, '   '); perform pg_temp.ck('comentário vazio barrado', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('comentário vazio barrado', true); end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',false) \gset
do $$ begin
  delete from public.comentarios;
  perform pg_temp.ck('guardião não apaga comentário alheio', (select count(*) = 1 from public.comentarios));
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
do $$ begin
  delete from public.comentarios;
  perform pg_temp.ck('Analista Sr apaga qualquer comentário', (select count(*) = 0 from public.comentarios));
end $$;
reset role;

-- 4) backup
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false) \gset
do $$ begin
  begin perform public.backup_gerar_manual(); perform pg_temp.ck('analista NÃO gera backup', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('analista NÃO gera backup', true); end;
  begin perform public.backup_gerar('semanal'); perform pg_temp.ck('ninguém chama backup_gerar direto', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('ninguém chama backup_gerar direto', true); end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
do $$ declare i int; begin
  perform public.backup_gerar_manual();
  perform pg_temp.ck('Sr gera backup e lê', (select count(*) = 1 and max(qtd_linhas) > 0 from public.backup_snapshots));
  perform pg_temp.ck('exportação traz melhorias', jsonb_array_length(public.backup_exportar()->'backlog_melhorias') >= 1);
  perform pg_temp.ck('backup não inclui jornadas/atas', not (public.backup_exportar() ? 'daily_records') and not (public.backup_exportar() ? 'atas'));
  for i in 1..10 loop perform public.backup_gerar_manual(); end loop;
  perform pg_temp.ck('retenção: no máximo 8 manuais', (select count(*) = 8 from public.backup_snapshots where origem='manual'));
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false) \gset
do $$ begin perform pg_temp.ck('gerente NÃO lê backups', (select count(*) = 0 from public.backup_snapshots)); end $$;
reset role;

-- 5) desfazer carga de chamados
insert into public.backlog_chamados(id_chamado,data_ref,subcategoria,tipo,status) values ('1','2026-10-01','A','Correção','1 - A iniciar'),('2','2026-10-02','B','Correção','1 - A iniciar');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
do $$ begin
  perform public.chamados_substituir('[{"id_chamado":"9","data_ref":"2026-11-01","subcategoria":"Z","tipo":"Correção","status":"1 - A iniciar"}]'::jsonb);
  perform pg_temp.ck('carga substitui a base (1 linha)', (select count(*) = 1 from public.backlog_chamados));
  perform pg_temp.ck('base anterior foi guardada (2 linhas)', (select qtd = 2 from public.backlog_chamados_anterior));
  perform pg_temp.ck('desfazer devolve 2', public.chamados_desfazer_carga() = 2);
  perform pg_temp.ck('base voltou com os ids 1 e 2', (select array_agg(id_chamado order by id_chamado) = array['1','2'] from public.backlog_chamados));
  perform pg_temp.ck('desfazer o desfazer devolve a carga errada (1)', public.chamados_desfazer_carga() = 1);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false) \gset
do $$ begin
  begin perform public.chamados_desfazer_carga(); perform pg_temp.ck('analista NÃO desfaz carga', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('analista NÃO desfaz carga', true); end;
end $$;
reset role;

-- 6) avisos: só o serviço executa; números corretos
insert into public.backlog_melhorias(modulo,melhoria,criado_por,tipo_backlog,fase,data_termino,data_abertura) values
 ('M','Atrasada A','00000000-0000-0000-0000-0000000000a3','melhoria','em_desenvolvimento', current_date - 5, null),
 ('M','Chamado antigo','00000000-0000-0000-0000-0000000000a3','melhoria','chamado_aberto', null, current_date - 30);
do $$ declare d jsonb; begin
  d := public.avisos_dados();
  perform pg_temp.ck('prazo vencido conta a atrasada', (d->'melhorias_prazo_vencido'->>'total')::int >= 1);
  perform pg_temp.ck('SLA vencido conta o chamado de 30 dias', (d->'melhorias_sla_vencido'->>'total')::int >= 1);
  perform pg_temp.ck('sem responsável conta as duas', (d->'melhorias_sem_responsavel'->>'total')::int >= 2);
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
do $$ begin
  begin perform public.avisos_dados(); perform pg_temp.ck('usuário logado NÃO chama avisos_dados', false);
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; perform pg_temp.ck('usuário logado NÃO chama avisos_dados', true); end;
  perform pg_temp.ck('Sr lê config de avisos', (select count(*) = 1 from public.avisos_config));
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false) \gset
do $$ begin perform pg_temp.ck('gerente NÃO lê config de avisos', (select count(*) = 0 from public.avisos_config)); end $$;
reset role;
rollback;
\echo TODOS OS TESTES PASSARAM
