-- MIGRAÇÃO 013 — Agente de segurança semanal e painel “Segurança”. Execute UMA vez, depois da 012. Não altera dados.
begin;
-- ===== Agente de segurança semanal — migração 013 =====
-- seguranca_verificar() audita o banco e CORRIGE sozinha as falhas de uma lista segura (RLS desligado, funções/tabelas abertas a visitantes,
-- views sem security_invoker, funções sem search_path). O que exige decisão humana fica como “pendente”. Tudo é registrado e aparece, só para o
-- Analista Sr, em “Segurança” (rodapé do menu). A camada de IA (Edge Function agente-seguranca) apenas EXPLICA o relatório — nunca executa comandos.
create table public.seguranca_execucoes(
  id uuid primary key default gen_random_uuid(),
  iniciada_em timestamptz not null default now(), concluida_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual','semanal','ia')),
  executado_por uuid default auth.uid(),
  total int not null default 0, corrigidos int not null default 0, pendentes int not null default 0,
  resumo_ia text, modelo_ia text);
create table public.seguranca_achados(
  id bigint generated always as identity primary key,
  execucao_id uuid not null references public.seguranca_execucoes(id) on delete cascade,
  severidade text not null check (severidade in ('alta','media','baixa')),
  categoria text not null, objeto text, descricao text not null, recomendacao text,
  status text not null check (status in ('corrigido','pendente','informativo')),
  corrigido_em timestamptz);
create index on public.seguranca_achados(execucao_id);
alter table public.seguranca_execucoes enable row level security;
alter table public.seguranca_achados enable row level security;
create policy se_sel on public.seguranca_execucoes for select to authenticated using (is_manager());
create policy sa_sel on public.seguranca_achados for select to authenticated using (is_manager());   -- sem policy de escrita: só a função grava

create function public.seguranca_verificar(p_origem text default 'manual') returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; r record; n int;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'Somente o Analista Sr pode executar a verificação de segurança.'; end if;
  if p_origem not in ('manual','semanal','ia') then p_origem := 'manual'; end if;
  insert into seguranca_execucoes(origem) values (p_origem) returning id into v_id;

  -- 1) tabelas sem RLS → liga o RLS (sem políticas, a tabela fica fechada: é o padrão seguro)
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', r.relname);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','RLS desligado',r.relname,'A tabela estava sem segurança por linha (RLS): qualquer usuário logado poderia ler/alterar tudo.','RLS ligado automaticamente. Crie as políticas de acesso se o app precisar usar esta tabela.','corrigido',now());
  end loop;

  -- 2) views sem security_invoker (ignorariam o RLS das tabelas) → ativa
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'v' and not ('security_invoker=true' = any(coalesce(c.reloptions, '{}'))) loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','View sem security_invoker',r.relname,'A view executava com as permissões do dono e poderia expor dados que o RLS esconde.','security_invoker ativado automaticamente.','corrigido',now());
  end loop;

  -- 3) tabelas/views com privilégio para visitantes sem login (anon) → revoga
  for r in select table_name, string_agg(privilege_type, ', ') as privs from information_schema.role_table_grants
           where grantee = 'anon' and table_schema = 'public' group by table_name loop
    execute format('revoke all on public.%I from anon', r.table_name);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','Acesso de visitante a tabela',r.table_name,'O papel anon (sem login) tinha privilégios: '||r.privs||'.','Privilégios removidos automaticamente.','corrigido',now());
  end loop;

  -- 4) funções executáveis por visitantes (anon/PUBLIC) → revoga
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon', r.f);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'alta','Função aberta a visitantes',r.proname,'A função podia ser chamada pela API sem login.','Execução removida de anon/PUBLIC automaticamente.','corrigido',now());
  end loop;

  -- 5) funções do app sem search_path fixo → fixa
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('alter function %s set search_path = public', r.f);
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'media','Função sem search_path',r.proname,'Função sem search_path fixo (risco de sequestro de nomes).','search_path fixado em public automaticamente.','corrigido',now());
  end loop;

  -- 6) PENDENTES (decisão humana): políticas de escrita abertas, papéis públicos em políticas, excesso de administradores, contas paradas, extensões em public
  for r in select tablename, policyname, cmd from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
           and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true') loop
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'alta','Política de escrita aberta',r.tablename||' · '||r.policyname,'A política de '||r.cmd||' libera para qualquer usuário (condição “true”).','Revisar e restringir a condição da política (não é corrigido automaticamente para não quebrar o app).','pendente');
  end loop;
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and (roles && array['public'::name,'anon'::name]) loop
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'alta','Política para visitantes',r.tablename||' · '||r.policyname,'A política vale também para visitantes sem login.','Restringir a política ao papel authenticated.','pendente');
  end loop;
  select count(*) into n from profiles where perfil = 'analista_sr' and ativo;
  if n > 3 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'media','Muitos administradores','profiles',n||' usuários ativos com perfil Analista Sr (acesso administrativo total).','Manter só quem realmente administra a plataforma.','pendente');
  end if;
  select count(*) into n from profiles p join auth.users u on u.id = p.id where p.ativo and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '90 days';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Contas sem uso','profiles',n||' usuário(s) ativo(s) sem acesso há mais de 90 dias.','Desativar (ou excluir) quem saiu da equipe, em Gestão da equipe → Usuários.','pendente');
  end if;
  select count(*) into n from auth.users where invited_at is not null and last_sign_in_at is null and invited_at < now() - interval '14 days';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Convites não aceitos','auth.users',n||' convite(s) enviado(s) há mais de 14 dias sem aceite.','Reenviar o convite ou excluir o usuário.','pendente');
  end if;
  select count(*) into n from pg_extension e join pg_namespace s on s.oid = e.extnamespace where s.nspname = 'public' and e.extname <> 'plpgsql';
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
      (v_id,'baixa','Extensões no schema public','pg_extension',n||' extensão(ões) instalada(s) no schema public (suas funções ficam expostas na API).','Mover para o schema extensions no painel do Supabase (não é automático para não quebrar dependências).','pendente');
  end if;

  -- 7) manutenção: esvazia a lixeira vencida e apaga de vez os usuários excluídos há mais de 48 h
  n := lixeira_purgar();
  if n > 0 then
    insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status,corrigido_em) values
      (v_id,'baixa','Manutenção','lixeira',n||' usuário(s) excluído(s) há mais de 48 h removido(s) definitivamente.','Rotina automática.','informativo',now());
  end if;

  -- 8) resumo informativo (sempre presente)
  insert into seguranca_achados(execucao_id,severidade,categoria,objeto,descricao,recomendacao,status) values
    (v_id,'baixa','Resumo','banco',
     (select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity)||' tabelas com RLS · '||
     (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prokind='f' and not has_function_privilege('anon',p.oid,'execute'))||' funções fechadas a visitantes.',
     'Estado verificado ao final da execução.','informativo');

  update seguranca_execucoes e set concluida_em = now(),
    corrigidos = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status = 'corrigido'),
    pendentes = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status = 'pendente'),
    total = (select count(*) from seguranca_achados a where a.execucao_id = v_id and a.status in ('corrigido','pendente'))
   where e.id = v_id;
  return v_id;
end $$;
revoke execute on function public.seguranca_verificar(text) from public, anon;
grant execute on function public.seguranca_verificar(text) to authenticated, service_role;

-- Agendamento semanal (segundas, 09:00 UTC) quando a extensão pg_cron estiver ativada no Supabase; senão veja o README (agendar a Edge Function).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('seguranca-semanal'); exception when others then null; end;
    perform cron.schedule('seguranca-semanal', '0 9 * * 1', $c$select public.seguranca_verificar('semanal')$c$);
  else
    raise notice 'pg_cron não está ativado: a verificação semanal precisa ser agendada (veja o README) ou rodada pelo botão Segurança.';
  end if;
end $$;
commit;
