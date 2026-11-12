-- MIGRAÇÃO 008 → 013 em um só arquivo — (008) chamados alimentam o Backlog · (009) data de conclusão/filtros · (010) segurança · (011) excluir projetos/usuários · (012) lixeira de 48 h · (013) agente de segurança.
-- Para quem executou até a 007 e AINDA NÃO executou a 008 em diante. Execute UMA vez. NÃO use em instalação nova (use só o 001). Depois, reimporte a base de chamados.
begin;
-- ===== Chamados da base alimentam o Backlog de Melhorias =====
-- Cada chamado VÁLIDO da base (A iniciar, Em andamento, Suspenso ou Concluído; Cancelado e Improcedente ficam de fora) vira uma atividade
-- do Backlog (origem 'chamado'). Status: A iniciar→A Iniciar · Em andamento→Em andamento · Concluído→Concluído (100%) · Suspenso→Novo Prazo.
-- Ao reimportar a base: chamados novos viram atividades; atividades já existentes só mudam de status se o STATUS DO CHAMADO mudou na base
-- (edições, etapas e histórico feitos no Backlog são preservados); nada é apagado.
alter table public.backlog_melhorias
  add column origem text not null default 'manual' check (origem in ('manual','chamado')),
  add column chamado_chave text,
  add column chamado_status text;
create unique index backlog_melhorias_chamado_chave_uq on backlog_melhorias(chamado_chave);

create function public.chamados_sincronizar() returns void language plpgsql security definer set search_path=public as $$
begin
  perform set_config('app.sync','1',true);   -- libera a gravação de origem/chamado_chave (protegidas contra edição pelos usuários)
  drop table if exists _ch;
  create temp table _ch on commit drop as
  select x.*,
    regexp_replace(x.status,'^\s*\d+\s*-\s*','') as st_norm,
    case when x.status ~* 'conclu' then 'Concluído' when x.status ~* 'andamento' then 'Em andamento'
         when x.status ~* 'suspens' then 'Novo Prazo' else 'A Iniciar' end as st_mel
  from (select c.*, concat_ws('|', coalesce(c.id_chamado,''), c.data_ref::text,
          md5(coalesce(c.item_sintoma,'')||'|'||coalesce(c.cliente,'')||'|'||coalesce(c.subcategoria,'')))
          || '#' || row_number() over (partition by coalesce(c.id_chamado,''), c.data_ref,
               md5(coalesce(c.item_sintoma,'')||'|'||coalesce(c.cliente,'')||'|'||coalesce(c.subcategoria,'')) order by c.id) as chave
        from backlog_chamados c) x
  where x.status is not null and x.status ~* '(a iniciar|andamento|suspens|conclu)' and x.status !~* '(cancel|improced)';

  insert into backlog_melhorias(modulo, melhoria, descricao, prioridade, status, percentual_concluido, responsavel, data_inicio, criado_por, origem, chamado_chave, chamado_status)
  select coalesce(nullif(trim(categoria),''),'Chamados'),
         left(coalesce(nullif(trim(item_sintoma),''), nullif(trim(subcategoria),''), 'Chamado '||coalesce(id_chamado,'s/n')), 200),
         concat_ws(' · ', 'Chamado '||nullif(id_chamado,''), nullif(trim(cliente),''), nullif(trim(site),''), nullif(trim(subcategoria),'')),
         3, st_mel, case when st_mel='Concluído' then 100 else 0 end,
         coalesce(nullif(trim(responsavel_rocco),''), nullif(trim(empresa_responsavel),'')),
         coalesce(data_ref, data_identificacao), auth.uid(), 'chamado', chave, st_norm
  from _ch
  on conflict (chamado_chave) do nothing;

  update backlog_melhorias m
     set status = c.st_mel,
         percentual_concluido = case when c.st_mel='Concluído' then 100 when m.percentual_concluido = 100 then 0 else m.percentual_concluido end,
         chamado_status = c.st_norm
    from _ch c
   where m.chamado_chave = c.chave and m.chamado_status is distinct from c.st_norm;
  perform set_config('app.sync','',true);
  drop table if exists _ch;
end $$;
revoke all on function public.chamados_sincronizar() from public, anon, authenticated;

create or replace function public.chamados_substituir(p_rows jsonb) returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode importar a base de chamados.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nenhuma linha para importar.'; end if;
  delete from backlog_chamados where true;
  insert into backlog_chamados(id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase)
    select id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase
    from jsonb_to_recordset(p_rows) as x(id_chamado text,data_identificacao date,data_ref date,categoria text,subcategoria text,tipo text,item_sintoma text,sistema_ofensor text,cliente text,site text,status text,prazo text,responsavel text,empresa_responsavel text,responsavel_rocco text,fase text);
  get diagnostics n = row_count;
  insert into backlog_chamados_carga(qtd) values (n);
  perform chamados_sincronizar();   -- chamados válidos viram/atualizam atividades do Backlog
  return n;
end $$;

-- ===== Data de conclusão das atividades (filtro "Data de finalização" do Backlog) — migração 009 =====
-- Preenchida automaticamente quando a atividade passa a Concluído (e limpa se sair de Concluído); também pode ser informada à mão.
-- Chamados da base NÃO recebem data automática: a planilha não traz data de conclusão (informe à mão, se quiser).
alter table public.backlog_melhorias add column data_conclusao date;
create index on public.backlog_melhorias(data_inicio);
create index on public.backlog_melhorias(data_conclusao);
create function public.bl_conclusao() returns trigger language plpgsql as $$
begin
  if new.status = 'Concluído' then
    if tg_op = 'INSERT' or old.status is distinct from 'Concluído' then
      if new.data_conclusao is null and coalesce(new.origem,'manual') <> 'chamado' then new.data_conclusao := (now() at time zone 'America/Sao_Paulo')::date; end if;
    end if;
  else
    new.data_conclusao := null;
  end if;
  return new;
end $$;
create trigger zz_conclusao_backlog_melhorias before insert or update on public.backlog_melhorias for each row execute function bl_conclusao();
-- Preenche as já concluídas a partir do histórico (última vez que passaram a Concluído); atividades manuais sem histórico usam a data da última atualização.
update public.backlog_melhorias m set data_conclusao = coalesce(
  (select (max(h.data_hora) at time zone 'America/Sao_Paulo')::date from backlog_historico h where h.melhoria_id=m.id and h.etapa_id is null and h.campo='status' and h.valor_novo='Concluído'),
  case when coalesce(m.origem,'manual')<>'chamado' then (m.atualizado_em at time zone 'America/Sao_Paulo')::date end)
where m.status='Concluído' and m.data_conclusao is null;

-- ===== Endurecimento de segurança — migração 010 =====
-- (1) origem/chamado_chave/chamado_status do Backlog só são gravadas pela sincronização de chamados (usuário não consegue forjar nem alterar);
-- (2) criado_por dos Projetos não pode ser reescrito; (3) funções fixam search_path;
-- (4) NENHUMA função do schema public fica executável por visitantes sem login (anon/PUBLIC); funções internas (gatilhos) também saem da API.
create function public.bl_protege_origem() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(current_setting('app.sync', true),'') <> '1' then
    if tg_op = 'INSERT' then new.origem := 'manual'; new.chamado_chave := null; new.chamado_status := null;
    else new.origem := old.origem; new.chamado_chave := old.chamado_chave; new.chamado_status := old.chamado_status; end if;
  end if;
  return new;
end $$;
create trigger aa_protege_origem before insert or update on public.backlog_melhorias for each row execute function bl_protege_origem();

create function public.md_protege_autor() returns trigger language plpgsql set search_path=public as $$
begin new.criado_por := old.criado_por; return new; end $$;
create trigger md_bu0_autor before update on public.microdeliveries for each row execute function md_protege_autor();

do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prokind='f' and p.proconfig is null
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop execute format('alter function %s set search_path = public', r.f); end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
do $$ declare r record; begin   -- funções de gatilho e a sincronização interna: não são chamáveis pela API
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prokind='f' and (p.prorettype='trigger'::regtype or p.proname='chamados_sincronizar')
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop execute format('revoke execute on function %s from authenticated', r.f); end loop;
end $$;

-- ===== Excluir projetos e usuários — migração 011 =====
-- Projetos: o criador (ou o Analista Sr) pode excluir; o histórico do projeto vai junto e a cópia completa fica na auditoria (audit_log).
alter table public.microdelivery_history drop constraint microdelivery_history_microdelivery_id_fkey;
alter table public.microdelivery_history add constraint microdelivery_history_microdelivery_id_fkey foreign key (microdelivery_id) references public.microdeliveries(id) on delete cascade;
create policy md_del on public.microdeliveries for delete to authenticated using (is_active() and (criado_por = auth.uid() or is_manager()));
-- Usuários: a autoria em históricos deixa de impedir a exclusão (fica em branco).
alter table public.microdelivery_history drop constraint microdelivery_history_usuario_id_fkey;
alter table public.microdelivery_history add constraint microdelivery_history_usuario_id_fkey foreign key (usuario_id) references public.profiles(id) on delete set null;
-- Exclusão de usuário (somente Analista Sr). Remove o acesso (auth.users) e, em cascata, o perfil e os dados pessoais (jornadas, agenda, ideias, modelos…).
-- Bloqueia: excluir a si mesmo; usuário que ainda é responsável/criador de projetos (reatribua ou exclua os projetos antes).
create function public.usuario_excluir(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int; nm text;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode excluir usuários.'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  select nome into nm from profiles where id = p_id;
  if nm is null then raise exception 'Usuário não encontrado.'; end if;
  select count(*) into n from microdeliveries where responsavel_id = p_id or criado_por = p_id or com_quem_id = p_id;
  if n > 0 then raise exception '% ainda está ligado a % projeto(s) (responsável, criador ou “com quem está”). Reatribua ou exclua esses projetos antes de excluir o usuário.', nm, n; end if;
  delete from auth.users where id = p_id;
end $$;
revoke execute on function public.usuario_excluir(uuid) from public, anon;
grant execute on function public.usuario_excluir(uuid) to authenticated, service_role;

-- ===== Lixeira de 48 horas (desfazer exclusões) — migração 012 =====
-- Tudo que é excluído em Projetos, atividades/etapas do Backlog, Ideias, Agenda (reuniões) e Imprevistos vai para a lixeira por 48 h e pode ser restaurado
-- (quem excluiu ou o Analista Sr). Usuários excluídos ficam bloqueados por 48 h (podem ser restaurados) e só depois são removidos de vez.
alter table public.profiles add column excluido_em timestamptz, add column excluido_por uuid;
create table public.lixeira(
  id uuid primary key default gen_random_uuid(),
  tabela text not null, registro_id uuid not null, rotulo text,
  dados jsonb not null, filhos jsonb not null default '{}',          -- cópia da linha e dos registros ligados (histórico do projeto, etapas da atividade)
  excluido_por uuid default auth.uid(), excluido_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '48 hours', restaurado_em timestamptz);
create index on public.lixeira(expira_em);
alter table public.lixeira enable row level security;
create policy lx_sel on public.lixeira for select to authenticated
  using (is_active() and restaurado_em is null and expira_em > now() and (excluido_por = auth.uid() or is_manager()));
create policy lx_del on public.lixeira for delete to authenticated using (is_manager());   -- “Remover definitivamente” (Analista Sr)

create function public.lixeira_captura() returns trigger language plpgsql security definer set search_path=public as $$
declare v_rot text; v_filhos jsonb := '{}';
begin
  if coalesce(current_setting('app.purge', true),'') = '1' then return old; end if;   -- remoção definitiva (expirou) não volta para a lixeira
  if tg_table_name = 'microdeliveries' then
    v_rot := old.demanda;
    v_filhos := jsonb_build_object('microdelivery_history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) from microdelivery_history h where h.microdelivery_id = old.id));
  elsif tg_table_name = 'backlog_melhorias' then
    v_rot := old.melhoria;
    v_filhos := jsonb_build_object('backlog_etapas', (select coalesce(jsonb_agg(to_jsonb(e) order by e.ordem), '[]'::jsonb) from backlog_etapas e where e.melhoria_id = old.id));
  elsif tg_table_name = 'backlog_etapas' then
    if not exists (select 1 from backlog_melhorias m where m.id = old.melhoria_id) then return old; end if;   -- etapa removida junto com a atividade: já está na cópia da atividade
    v_rot := old.como;
  elsif tg_table_name = 'ideas' then v_rot := old.titulo;
  elsif tg_table_name = 'agenda' then v_rot := old.assunto;
  elsif tg_table_name = 'imprevistos' then v_rot := old.descricao;
  end if;
  insert into lixeira(tabela, registro_id, rotulo, dados, filhos) values (tg_table_name, old.id, left(coalesce(v_rot,''), 200), to_jsonb(old), v_filhos);
  return old;
end $$;
do $$ declare t text; begin
  foreach t in array array['microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos'] loop
    execute format('create trigger lixeira_%1$s before delete on public.%1$I for each row execute function lixeira_captura()', t);
  end loop; end $$;

-- Reinsere linha(s) a partir da cópia JSON, ignorando colunas geradas (ex.: mes_referencia). Uso interno.
create function public.lixeira_inserir(p_tab text, p_dados jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_cols text;
begin
  if p_tab not in ('microdeliveries','microdelivery_history','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos') then raise exception 'Tabela não restaurável.'; end if;
  select string_agg(quote_ident(attname), ',' order by attnum) into v_cols from pg_attribute
   where attrelid = ('public.' || quote_ident(p_tab))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  if p_dados is null or jsonb_typeof(p_dados) = 'null' or p_dados = '[]'::jsonb then return; end if;
  execute format('insert into public.%1$I (%2$s) overriding system value select %2$s from %3$s(null::public.%1$I, $1)', p_tab, v_cols,
                 case when jsonb_typeof(p_dados) = 'array' then 'jsonb_populate_recordset' else 'jsonb_populate_record' end) using p_dados;
end $$;

create function public.lixeira_restaurar(p_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare r lixeira%rowtype;
begin
  select * into r from lixeira where id = p_id and restaurado_em is null and expira_em > now() for update;
  if not found then raise exception 'Item não encontrado ou o prazo de 48 horas já terminou.'; end if;
  if not (is_active() and (is_manager() or r.excluido_por = auth.uid())) then raise exception 'Sem permissão para restaurar este item.'; end if;
  if r.tabela not in ('microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos') then raise exception 'Tabela não restaurável.'; end if;
  perform set_config('app.sync', '1', true);   -- preserva origem/chamado_chave do Backlog na restauração
  begin
    perform lixeira_inserir(r.tabela, r.dados);
    if r.tabela = 'microdeliveries' then
      delete from microdelivery_history where microdelivery_id = r.registro_id;   -- remove o registro de “criação” gerado automaticamente; volta o histórico original
      perform lixeira_inserir('microdelivery_history', r.filhos->'microdelivery_history');
    elsif r.tabela = 'backlog_melhorias' then
      perform lixeira_inserir('backlog_etapas', r.filhos->'backlog_etapas');
    end if;
  exception
    when foreign_key_violation then raise exception 'Não foi possível restaurar: um registro ligado (por exemplo, o responsável ou a atividade) não existe mais.';
    when unique_violation then raise exception 'Não foi possível restaurar: já existe um item equivalente (por exemplo, a reimportação de chamados recriou a atividade).';
  end;
  perform set_config('app.sync', '', true);
  update lixeira set restaurado_em = now() where id = p_id;
  return r.rotulo;
end $$;

-- Exclusão de usuário passa a ser REVERSÍVEL por 48 h: o acesso é bloqueado e o usuário some das listas; depois disso é removido de vez (lixeira_purgar).
create or replace function public.usuario_excluir(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare n int; nm text;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode excluir usuários.'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode excluir o seu próprio usuário.'; end if;
  select nome into nm from profiles where id = p_id and excluido_em is null;
  if nm is null then raise exception 'Usuário não encontrado.'; end if;
  select count(*) into n from microdeliveries where responsavel_id = p_id or criado_por = p_id or com_quem_id = p_id;
  if n > 0 then raise exception '% ainda está ligado a % projeto(s) (responsável, criador ou “com quem está”). Reatribua ou exclua esses projetos antes de excluir o usuário.', nm, n; end if;
  update profiles set ativo = false, excluido_em = now(), excluido_por = auth.uid() where id = p_id;
  update auth.users set banned_until = 'infinity' where id = p_id;   -- impede novo login enquanto estiver na lixeira
end $$;
create function public.usuario_restaurar(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode restaurar usuários.'; end if;
  update profiles set ativo = true, excluido_em = null, excluido_por = null where id = p_id and excluido_em is not null and excluido_em > now() - interval '48 hours';
  if not found then raise exception 'Usuário não encontrado ou o prazo de 48 horas já terminou.'; end if;
  update auth.users set banned_until = null where id = p_id;
end $$;

-- Limpeza: remove da lixeira o que passou de 48 h e apaga de vez os usuários excluídos há mais de 48 h. Chamada pela verificação semanal e ao abrir a Lixeira.
create function public.lixeira_purgar() returns int language plpgsql security definer set search_path=public as $$
declare r record; n int := 0;
begin
  delete from lixeira where expira_em < now() or restaurado_em < now() - interval '7 days';
  perform set_config('app.purge', '1', true);
  for r in select id from profiles where excluido_em is not null and excluido_em < now() - interval '48 hours' loop
    delete from auth.users where id = r.id; n := n + 1;
  end loop;
  perform set_config('app.purge', '', true);
  return n;
end $$;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb), public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() from public, anon;
grant execute on function public.lixeira_restaurar(uuid), public.usuario_restaurar(uuid), public.lixeira_purgar() to authenticated, service_role;
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) from authenticated;
grant execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb) to service_role;

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


-- ===== 014_desempenho_rls.sql =====
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
