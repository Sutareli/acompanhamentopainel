-- MIGRAÇÃO 008 → 025 em um só arquivo (chamados no Backlog, data de conclusão, segurança, lixeira, agente de segurança, desempenho do RLS, atas, capacidade, criticidade Recorrente, melhorias × correção, funil, SLA, andamento pela etapa, feriados/metas/comentários/backup/avisos).
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


-- ===== 015_atas_importantes.sql =====
-- 015 · Atas importantes (substitui o registro de reuniões) + suporte da Lixeira de 48 h às atas. Rode depois da 014.
begin;

-- Cada pessoa guarda as atas das reuniões que fez: nome, data, breve resumo e o TEXTO COMPLETO da ata (colado numa caixa de texto, até 50 mil caracteres).
-- Tudo fica na tabela (sem arquivos e sem Storage): ~10 KB por ata. Visível e editável SOMENTE pelo dono (nem gerente/diretor leem as atas dos outros).
create table if not exists public.atas(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  data_reuniao date not null,
  resumo text check (resumo is null or length(resumo) <= 1000),
  texto text not null check (length(trim(texto)) > 0 and length(texto) <= 50000),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index if not exists atas_user_data on public.atas(user_id, data_reuniao desc);
alter table public.atas enable row level security;
drop policy if exists atas_sel on public.atas; drop policy if exists atas_ins on public.atas; drop policy if exists atas_upd on public.atas; drop policy if exists atas_del on public.atas;
create policy atas_sel on public.atas for select to authenticated using ((select is_active()) and user_id = (select auth.uid()));
create policy atas_ins on public.atas for insert to authenticated with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_upd on public.atas for update to authenticated using ((select is_active()) and user_id = (select auth.uid())) with check ((select is_active()) and user_id = (select auth.uid()));
create policy atas_del on public.atas for delete to authenticated using ((select is_active()) and user_id = (select auth.uid()));
revoke all on public.atas from anon;
drop trigger if exists touch_atas on public.atas;
create trigger touch_atas before update on public.atas for each row execute function touch_updated();

-- Lixeira: atas passam a ser restauráveis por 48 h (a ata inteira volta).
create or replace function public.lixeira_captura() returns trigger language plpgsql security definer set search_path=public as $$
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
  elsif tg_table_name = 'atas' then v_rot := old.nome;
  end if;
  insert into lixeira(tabela, registro_id, rotulo, dados, filhos) values (tg_table_name, old.id, left(coalesce(v_rot,''), 200), to_jsonb(old), v_filhos);
  return old;
end $$;

create or replace function public.lixeira_inserir(p_tab text, p_dados jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_cols text;
begin
  if p_tab not in ('microdeliveries','microdelivery_history','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
  select string_agg(quote_ident(attname), ',' order by attnum) into v_cols from pg_attribute
   where attrelid = ('public.' || quote_ident(p_tab))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  if p_dados is null or jsonb_typeof(p_dados) = 'null' or p_dados = '[]'::jsonb then return; end if;
  execute format('insert into public.%1$I (%2$s) overriding system value select %2$s from %3$s(null::public.%1$I, $1)', p_tab, v_cols,
                 case when jsonb_typeof(p_dados) = 'array' then 'jsonb_populate_recordset' else 'jsonb_populate_record' end) using p_dados;
end $$;

create or replace function public.lixeira_restaurar(p_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare r lixeira%rowtype;
begin
  select * into r from lixeira where id = p_id and restaurado_em is null and expira_em > now() for update;
  if not found then raise exception 'Item não encontrado ou o prazo de 48 horas já terminou.'; end if;
  if not (is_active() and (is_manager() or r.excluido_por = auth.uid())) then raise exception 'Sem permissão para restaurar este item.'; end if;
  if r.tabela not in ('microdeliveries','backlog_melhorias','backlog_etapas','ideas','agenda','imprevistos','atas') then raise exception 'Tabela não restaurável.'; end if;
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

drop trigger if exists lixeira_atas on public.atas;
create trigger lixeira_atas before delete on public.atas for each row execute function lixeira_captura();
revoke execute on function public.lixeira_captura(), public.lixeira_inserir(text, jsonb), public.lixeira_restaurar(uuid) from public, anon;
revoke execute on function public.lixeira_inserir(text, jsonb) from authenticated;

commit;


-- ===== 017_atas_arquivo.sql =====
-- 017 · Atas importantes: ARQUIVO (Word/PDF) opcional + texto de até 60.000 caracteres (também opcional; é preciso ter texto OU arquivo). Rode depois da 015.
-- O arquivo fica no Supabase Storage (bucket privado "atas"); a tabela guarda o caminho. Seguro para repetir.
begin;
alter table public.atas add column if not exists arquivo_path text, add column if not exists arquivo_nome text,
  add column if not exists arquivo_tamanho bigint check (arquivo_tamanho is null or arquivo_tamanho between 0 and 10485760);
alter table public.atas alter column texto drop not null;
alter table public.atas drop constraint if exists atas_texto_check;
alter table public.atas add constraint atas_texto_check check (texto is null or length(texto) <= 60000);
alter table public.atas drop constraint if exists atas_conteudo_check;
alter table public.atas add constraint atas_conteudo_check check (coalesce(length(trim(texto)), 0) > 0 or arquivo_path is not null);
-- Arquivos (migração 017): bucket privado "atas", 10 MB por arquivo, só Word/PDF; cada pessoa só acessa a própria pasta (<id do usuário>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atas', 'atas', false, 10485760, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists atas_arq_sel on storage.objects; drop policy if exists atas_arq_ins on storage.objects;
drop policy if exists atas_arq_upd on storage.objects; drop policy if exists atas_arq_del on storage.objects;
create policy atas_arq_sel on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_upd on storage.objects for update to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy atas_arq_del on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_active()) and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;


-- ===== 018_capacidade_e_arquivamento_atas.sql =====
-- 018 · Capacidade do plano + aviso aos 95% + arquivamento das atas (backup em ZIP e exclusão exclusiva das atas). Rode depois da 017.
begin;

-- ===== Capacidade do plano e arquivamento das atas — migração 018 =====
-- O Analista Sr acompanha o uso (banco e Storage) contra os limites do plano; ao chegar no limiar (padrão 95%) a plataforma avisa. Aí ele pode gerar um backup
-- único (ZIP) com TODAS as atas (texto + arquivos) e, depois, excluir exclusivamente as atas para liberar espaço. As atas são privadas de cada pessoa: o acesso do
-- Analista Sr às atas de todos só existe numa "janela de manutenção" de 3 h, aberta apenas quando o limiar foi atingido, e fica registrada na auditoria.
create table if not exists public.capacidade_config(
  id int primary key default 1 check (id = 1),
  banco_limite_mb int not null default 500 check (banco_limite_mb > 0),         -- Free = 500 · Pro = 8192
  storage_limite_mb int not null default 1024 check (storage_limite_mb > 0),    -- Free = 1024 · Pro = 102400
  alerta_pct int not null default 95 check (alerta_pct between 50 and 100),
  atualizado_em timestamptz not null default now(), atualizado_por uuid);
insert into public.capacidade_config(id) values (1) on conflict do nothing;
alter table public.capacidade_config enable row level security;
drop policy if exists cap_sel on public.capacidade_config; drop policy if exists cap_upd on public.capacidade_config;
create policy cap_sel on public.capacidade_config for select to authenticated using ((select is_manager()));
create policy cap_upd on public.capacidade_config for update to authenticated using ((select is_manager())) with check ((select is_manager()));
revoke all on public.capacidade_config from anon;

create table if not exists public.atas_manutencao(
  id int primary key default 1 check (id = 1),
  aberta_em timestamptz, aberta_por uuid, expira_em timestamptz, corte timestamptz, backup_em timestamptz, backup_itens jsonb);
insert into public.atas_manutencao(id) values (1) on conflict do nothing;
alter table public.atas_manutencao enable row level security;      -- sem políticas: ninguém acessa direto; só pelas funções abaixo
revoke all on public.atas_manutencao from anon, authenticated;

create or replace function public.atas_manutencao_aberta() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select expira_em > now() from atas_manutencao where id = 1), false) $$;

create or replace function public.capacidade_status() returns jsonb language plpgsql security definer set search_path=public as $$
declare c capacidade_config; b bigint; s bigint; ac int; tx bigint; ar bigint; pb numeric; ps numeric;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  select * into c from capacidade_config where id = 1;
  b := pg_database_size(current_database());
  s := coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0);
  select count(*), coalesce(sum(octet_length(texto)), 0), coalesce(sum(arquivo_tamanho), 0) into ac, tx, ar from atas;
  pb := round(b * 100.0 / (c.banco_limite_mb * 1048576.0), 1);
  ps := round(s * 100.0 / (c.storage_limite_mb * 1048576.0), 1);
  return jsonb_build_object('banco_bytes', b, 'banco_limite_bytes', c.banco_limite_mb * 1048576::bigint, 'banco_pct', pb,
    'storage_bytes', s, 'storage_limite_bytes', c.storage_limite_mb * 1048576::bigint, 'storage_pct', ps,
    'alerta_pct', c.alerta_pct, 'alerta', greatest(pb, ps) >= c.alerta_pct,
    'atas_qtd', ac, 'atas_texto_bytes', tx, 'atas_arquivo_bytes', ar, 'janela_aberta', atas_manutencao_aberta());
end $$;

-- Abre a janela de manutenção (3 h). Só com o limiar atingido. Devolve o instante de corte (o backup cobre as atas até ele).
create or replace function public.atas_manutencao_abrir() returns timestamptz language plpgsql security definer set search_path=public as $$
declare st jsonb; t timestamptz := now();
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  st := capacidade_status();
  if not (st->>'alerta')::boolean then raise exception 'O uso ainda não chegou a % %% do plano; o arquivamento das atas só é liberado a partir daí.', st->>'alerta_pct'; end if;
  update atas_manutencao set aberta_em = t, aberta_por = auth.uid(), expira_em = t + interval '3 hours', corte = t, backup_em = null, backup_itens = null where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ABRIR', jsonb_build_object('atas', st->'atas_qtd', 'storage_pct', st->'storage_pct', 'banco_pct', st->'banco_pct'));
  return t;
end $$;

-- Registra que o backup foi gerado: lista de {id, u} (id da ata e atualizado_em) que ENTRARAM no arquivo. Só essas, sem alteração depois, poderão ser excluídas.
create or replace function public.atas_backup_registrar(p_itens jsonb) returns int language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  update atas_manutencao set backup_em = now(), backup_itens = p_itens where id = 1;
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'BACKUP', jsonb_build_object('atas', jsonb_array_length(p_itens)));
  return jsonb_array_length(p_itens);
end $$;

-- Exclui EXCLUSIVAMENTE as atas que estão no backup registrado (e que não foram alteradas depois). Não vai para a Lixeira (o backup é a cópia). Devolve os caminhos dos arquivos para a tela removê-los do Storage.
create or replace function public.atas_esvaziar(p_confirmacao text) returns jsonb language plpgsql security definer set search_path=public as $$
declare m atas_manutencao; n int; caminhos jsonb;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_confirmacao is distinct from 'EXCLUIR ATAS' then raise exception 'Confirmação inválida.'; end if;
  select * into m from atas_manutencao where id = 1 for update;
  if not atas_manutencao_aberta() then raise exception 'A janela de manutenção não está aberta (ou expirou). Reinicie o processo.'; end if;
  if m.backup_em is null or m.backup_itens is null then raise exception 'Gere e baixe o backup antes de excluir.'; end if;
  perform set_config('app.purge', '1', true);        -- não copia para a Lixeira
  with alvo as (
    select a.id, a.arquivo_path from atas a join jsonb_to_recordset(m.backup_itens) as x(id uuid, u timestamptz) on x.id = a.id and a.atualizado_em = x.u),
  del as (delete from atas where id in (select id from alvo) returning arquivo_path)
  select count(*), coalesce(jsonb_agg(arquivo_path) filter (where arquivo_path is not null), '[]'::jsonb) into n, caminhos from del;
  perform set_config('app.purge', '', true);
  insert into audit_log(tabela, usuario_id, acao, depois) values ('atas_manutencao', auth.uid(), 'ESVAZIAR', jsonb_build_object('atas_excluidas', n));
  return jsonb_build_object('excluidas', n, 'caminhos', caminhos);
end $$;

create or replace function public.atas_manutencao_fechar() returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  update atas_manutencao set expira_em = now(), backup_itens = null where id = 1;
end $$;
revoke execute on function public.atas_manutencao_aberta(), public.capacidade_status(), public.atas_manutencao_abrir(), public.atas_backup_registrar(jsonb), public.atas_esvaziar(text), public.atas_manutencao_fechar() from public, anon;

-- Janela de manutenção aberta: o Analista Sr lê as atas de todos (para o backup) e lê/remove os arquivos do bucket "atas".
drop policy if exists atas_sel_manut on public.atas;
create policy atas_sel_manut on public.atas for select to authenticated using ((select is_manager()) and (select atas_manutencao_aberta()));
drop policy if exists atas_arq_sel_manut on storage.objects; drop policy if exists atas_arq_del_manut on storage.objects;
create policy atas_arq_sel_manut on storage.objects for select to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));
create policy atas_arq_del_manut on storage.objects for delete to authenticated using (bucket_id = 'atas' and (select is_manager()) and (select atas_manutencao_aberta()));

commit;


-- ===== 019_criticidade_recorrente.sql =====
-- 019 · Criticidade "Recorrente" em Projetos (microdeliveries). Rode depois da 018.
begin;
alter table public.microdeliveries drop constraint if exists microdeliveries_criticidade_check;
alter table public.microdeliveries add constraint microdeliveries_criticidade_check check (criticidade in ('alta','media','baixa','recorrente'));
commit;


-- ===== 020_melhorias_e_correcao.sql =====
-- 020 · Backlog dividido: Melhorias (novo) e Correção/manutenção (o que já existia). Rode depois da 019.
begin;

-- ===== Backlog dividido em dois módulos — migração 020 =====
-- "Correção/manutenção" = o backlog que já existia (inclui as atividades geradas pelos chamados) → tipo_backlog = 'correcao' (padrão; nada é perdido).
-- "Melhorias" = módulo novo, alimentado pela base de melhorias → tipo_backlog = 'melhoria'. Mesma estrutura (etapas, histórico, prazos, permissões e Lixeira).
alter table public.backlog_melhorias
  add column if not exists tipo_backlog text not null default 'correcao',
  add column if not exists codigo_base int,        -- ID da planilha de melhorias (permite reimportar sem duplicar)
  add column if not exists ordem_top int;          -- posição na lista "10 primeiras" da planilha
alter table public.backlog_melhorias drop constraint if exists backlog_melhorias_tipo_backlog_check;
alter table public.backlog_melhorias add constraint backlog_melhorias_tipo_backlog_check check (tipo_backlog in ('melhoria','correcao'));
create unique index if not exists backlog_melhorias_codigo_base_uq on public.backlog_melhorias(codigo_base);
create index if not exists backlog_melhorias_tipo_idx on public.backlog_melhorias(tipo_backlog);

-- Importação da base de melhorias (somente Analista Sr). Novas entram; existentes (mesmo ID) têm textos, prioridade e posição atualizados.
-- Status só muda quando a atividade NÃO tem etapas (com etapas, status e % são calculados por elas). Prazo, % e responsável nunca são sobrescritos.
create or replace function public.melhorias_importar(p_itens jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; novas int := 0; atualizadas int := 0; v_id uuid; v_old backlog_melhorias; v_st text; v_cod int; v_pr int; v_top int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    v_cod := case when (x->>'codigo') ~ '^[0-9]+$' then (x->>'codigo')::int end;
    if v_cod is null then raise exception 'Item sem ID numérico.'; end if;
    v_st := case when x->>'status' in ('A Iniciar','Em andamento','Concluído') then x->>'status' else 'A Iniciar' end;
    v_pr := greatest(1, case when (x->>'prioridade') ~ '^[0-9]+$' then (x->>'prioridade')::int else 3 end);   -- "-" ou vazio = 3
    v_top := case when (x->>'ordem_top') ~ '^[0-9]+$' then (x->>'ordem_top')::int end;
    select * into v_old from backlog_melhorias where codigo_base = v_cod;
    if not found then
      insert into backlog_melhorias(modulo, melhoria, descricao, descricao_detalhada, objetivo, objetivo_detalhado, as_is, to_be, prioridade, status, percentual_concluido, ordem_top, tipo_backlog, codigo_base, criado_por)
      values (left(trim(x->>'modulo'),200), left(trim(x->>'melhoria'),300), nullif(x->>'descricao',''), nullif(x->>'descricao_detalhada',''), nullif(x->>'objetivo',''), nullif(x->>'objetivo_detalhado',''),
              nullif(x->>'as_is',''), nullif(x->>'to_be',''), v_pr, v_st, case when v_st = 'Concluído' then 100 else 0 end, v_top, 'melhoria', v_cod, auth.uid())
      returning id into v_id;
      if v_st = 'Concluído' then update backlog_melhorias set data_conclusao = null where id = v_id; end if;   -- a planilha não traz a data de conclusão
      novas := novas + 1;
    else
      update backlog_melhorias set modulo = left(trim(x->>'modulo'),200), melhoria = left(trim(x->>'melhoria'),300), descricao = nullif(x->>'descricao',''), descricao_detalhada = nullif(x->>'descricao_detalhada',''),
        objetivo = nullif(x->>'objetivo',''), objetivo_detalhado = nullif(x->>'objetivo_detalhado',''), as_is = nullif(x->>'as_is',''), to_be = nullif(x->>'to_be',''), prioridade = v_pr, ordem_top = v_top,
        status = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then v_old.status else v_st end,
        percentual_concluido = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then v_old.percentual_concluido
                                    when v_st = 'Concluído' then 100 when v_st = 'A Iniciar' then 0 else case when v_old.status = 'Concluído' then 0 else v_old.percentual_concluido end end
      where id = v_old.id;
      atualizadas := atualizadas + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', novas, 'atualizadas', atualizadas);
end $$;
revoke execute on function public.melhorias_importar(jsonb) from public, anon;

commit;

-- ===== 021_melhorias_data_abertura.sql =====
begin;

-- Funil do processo de melhoria (módulo Melhorias), 7 etapas:
--   ideia → priorizada (priorização) → especificacao → chamado_aberto → em_desenvolvimento → homologacao → producao
-- Datas: data_ideia, data_priorizacao, data_especificacao, data_abertura (+ numero_chamado), data_inicio (início do desenvolvimento), data_homologacao, data_conclusao (entrada em produção).
-- Responsável: usuário da plataforma dono da melhoria desde a ideia (responsavel_id). O desenvolvimento é sempre da mesma empresa, por isso não há responsável de desenvolvimento.
alter table public.backlog_melhorias
  add column if not exists data_ideia date,
  add column if not exists data_priorizacao date,
  add column if not exists data_especificacao date,
  add column if not exists data_abertura date,
  add column if not exists data_homologacao date,
  add column if not exists numero_chamado text,
  add column if not exists responsavel_id uuid references public.profiles(id) on delete set null;

-- Primeira execução: cria a coluna "fase" e posiciona as melhorias já existentes pelo status atual.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'backlog_melhorias' and column_name = 'fase') then
    alter table public.backlog_melhorias add column fase text not null default 'ideia';
    update public.backlog_melhorias set fase = case
        when status = 'Concluído' then 'producao'
        when status in ('Em andamento','Atrasado','Novo Prazo') then 'em_desenvolvimento'
        when data_abertura is not null then 'chamado_aberto' when ordem_top is not null then 'priorizada' else 'ideia' end
      where tipo_backlog = 'melhoria';
  end if;
end $$;
alter table public.backlog_melhorias drop constraint if exists backlog_melhorias_fase_check;
update public.backlog_melhorias set fase = 'producao' where fase = 'aplicada';   -- nome antigo da última etapa
alter table public.backlog_melhorias add constraint backlog_melhorias_fase_check
  check (fase in ('ideia','priorizada','especificacao','chamado_aberto','em_desenvolvimento','homologacao','producao'));
create index if not exists backlog_melhorias_fase_idx on public.backlog_melhorias(tipo_backlog, fase);
create index if not exists backlog_melhorias_data_abertura_idx on public.backlog_melhorias(data_abertura);
create index if not exists backlog_melhorias_responsavel_idx on public.backlog_melhorias(responsavel_id);

-- A etapa manda no status: Ideia→Chamado = A Iniciar · Desenvolvimento/Homologação = em andamento (ou Atrasado/Novo Prazo) · Produção = Concluído.
-- Quando o status muda sozinho (etapas concluídas = desenvolvimento pronto → vai para Homologação).
create or replace function public.bl_fase() returns trigger language plpgsql as $$
declare roll boolean := coalesce(current_setting('app.bl_rollup', true), '') = '1';
begin
  if new.tipo_backlog is distinct from 'melhoria' then return new; end if;
  if tg_op = 'UPDATE' and new.fase is distinct from old.fase and not roll then
    -- mudança manual de etapa: a etapa define o status
    if new.fase = 'producao' then new.status := 'Concluído'; new.percentual_concluido := 100;
    elsif new.fase in ('em_desenvolvimento','homologacao') then if new.status in ('A Iniciar','Concluído') then new.status := 'Em andamento'; end if;
    else new.status := 'A Iniciar'; new.percentual_concluido := 0; end if;
  else
    -- o status mudou (ou é um registro novo): ajusta a etapa
    if new.status = 'Concluído' then
      if new.fase not in ('homologacao','producao') then new.fase := case when roll then 'homologacao' else 'producao' end; end if;
    elsif new.status in ('Em andamento','Atrasado','Novo Prazo') then
      if new.fase not in ('em_desenvolvimento','homologacao') then new.fase := 'em_desenvolvimento'; end if;
    elsif new.fase in ('em_desenvolvimento','homologacao','producao') then
      new.fase := case when new.data_abertura is not null then 'chamado_aberto' when new.data_especificacao is not null then 'especificacao'
                       when new.data_priorizacao is not null or new.ordem_top is not null then 'priorizada' else 'ideia' end;
    end if;
  end if;
  if new.fase <> 'producao' then new.data_conclusao := null; end if;   -- a data de conclusão é a de entrada em produção
  return new;
end $$;
drop trigger if exists zy_fase_backlog_melhorias on public.backlog_melhorias;
drop trigger if exists zzz_fase_backlog_melhorias on public.backlog_melhorias;
create trigger zy_fase_backlog_melhorias before insert or update on public.backlog_melhorias for each row execute function bl_fase();

-- Data de conclusão: nas melhorias é a de ENTRADA EM PRODUÇÃO (Concluído por etapas em Homologação não conta).
create or replace function public.bl_conclusao() returns trigger language plpgsql as $$
declare em_producao boolean := new.tipo_backlog is distinct from 'melhoria' or new.fase = 'producao';
begin
  if new.status = 'Concluído' and em_producao then
    if tg_op = 'INSERT' or old.status is distinct from 'Concluído' or (new.tipo_backlog = 'melhoria' and old.fase is distinct from 'producao') then
      if new.data_conclusao is null and coalesce(new.origem,'manual') <> 'chamado' then new.data_conclusao := (now() at time zone 'America/Sao_Paulo')::date; end if;
    end if;
  else
    new.data_conclusao := null;
  end if;
  return new;
end $$;

-- O responsável (usuário da plataforma) também pode editar a melhoria e suas etapas.
drop policy if exists bl_upd on public.backlog_melhorias;
create policy bl_upd on public.backlog_melhorias for update to authenticated
  using (is_active() and (criado_por = auth.uid() or responsavel_id = auth.uid() or is_viewer_all()))
  with check (is_active() and (criado_por = auth.uid() or responsavel_id = auth.uid() or is_viewer_all()));
drop policy if exists be_ins on public.backlog_etapas;
drop policy if exists be_upd on public.backlog_etapas;
drop policy if exists be_del on public.backlog_etapas;
create policy be_ins on public.backlog_etapas for insert to authenticated with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));
create policy be_upd on public.backlog_etapas for update to authenticated
  using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())))
  with check (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));
create policy be_del on public.backlog_etapas for delete to authenticated using (is_active() and exists(select 1 from backlog_melhorias m where m.id=melhoria_id and (m.criado_por=auth.uid() or m.responsavel_id=auth.uid() or is_viewer_all())));

-- Histórico: passa a registrar a etapa do processo, as datas das etapas e o nº do chamado.
create or replace function public.bl_hist() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid; eid uuid; enome text; cols text[]; c text; o jsonb; n jsonb;
begin
  o := case when tg_op<>'INSERT' then to_jsonb(old) end; n := case when tg_op<>'DELETE' then to_jsonb(new) end;
  if tg_table_name='backlog_melhorias' then
    mid := coalesce(new.id, old.id); eid := null;
    cols := array['status','percentual_concluido','prioridade','responsavel','data_inicio','data_termino','fase','data_ideia','data_priorizacao','data_especificacao','data_abertura','numero_chamado','data_homologacao'];
    enome := null;
    if tg_op='DELETE' then return null; end if;    -- a exclusão da atividade fica no audit_log
  else
    mid := coalesce(new.melhoria_id, old.melhoria_id); eid := coalesce(new.id, old.id);
    cols := array['status','percentual_concluido','responsavel','data_inicio','data_termino','novo_prazo','prazo_realizado'];
    enome := coalesce(n->>'como', o->>'como');
    if tg_op='DELETE' and not exists(select 1 from backlog_melhorias where id=mid) then return null; end if;   -- exclusão em cascata
  end if;
  if tg_op='INSERT' then
    insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_novo) values (mid,eid,enome,'criacao',coalesce(n->>'melhoria',n->>'como'));
  elsif tg_op='DELETE' then
    insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_anterior) values (mid,eid,enome,'exclusao',enome);
  else
    foreach c in array cols loop
      if o->>c is distinct from n->>c then
        insert into backlog_historico(melhoria_id,etapa_id,etapa_nome,campo,valor_anterior,valor_novo) values (mid,eid,enome,c,o->>c,n->>c);
      end if;
    end loop;
  end if;
  return null;
end $$;
create or replace function public.melhorias_importar(p_itens jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; novas int := 0; atualizadas int := 0; sem_resp int := 0; v_id uuid; v_old backlog_melhorias; v_st text; v_cod int; v_pr int; v_top int;
        v_ab date; v_id_ date; v_nc text; v_fase text; v_rn int; v_ro int; v_resp uuid; v_resp_nome text;
        fases text[] := array['ideia','priorizada','especificacao','chamado_aberto','em_desenvolvimento','homologacao','producao'];
begin
  if not is_manager() then raise exception 'Somente o Analista Sr.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Lista inválida.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    v_cod := case when (x->>'codigo') ~ '^[0-9]+$' then (x->>'codigo')::int end;
    if v_cod is null then raise exception 'Item sem ID numérico.'; end if;
    v_st := case when x->>'status' in ('A Iniciar','Em andamento','Concluído') then x->>'status' else 'A Iniciar' end;
    v_pr := greatest(1, case when (x->>'prioridade') ~ '^[0-9]+$' then (x->>'prioridade')::int else 3 end);   -- "-" ou vazio = 3
    v_top := case when (x->>'ordem_top') ~ '^[0-9]+$' then (x->>'ordem_top')::int end;
    v_ab := case when (x->>'data_abertura') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x->>'data_abertura')::date end;
    v_id_ := case when (x->>'data_ideia') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x->>'data_ideia')::date end;
    v_nc := left(nullif(trim(x->>'numero_chamado'),''),60);
    -- responsável: nome de um usuário ativo da plataforma (opcional na base; sem correspondência fica em branco para definir na tela)
    v_resp := null; v_resp_nome := nullif(trim(x->>'responsavel_nome'),'');
    if v_resp_nome is not null then
      select id, nome into v_resp, v_resp_nome from profiles where ativo and lower(trim(nome)) = lower(v_resp_nome) order by criado_em limit 1;
      if v_resp is null then sem_resp := sem_resp + 1; end if;
    end if;
    v_fase := case when v_st = 'Concluído' then 'producao' when v_st = 'Em andamento' then 'em_desenvolvimento'
                   when v_ab is not null or v_nc is not null then 'chamado_aberto' when v_top is not null then 'priorizada' else 'ideia' end;
    select * into v_old from backlog_melhorias where codigo_base = v_cod;
    if not found then
      insert into backlog_melhorias(modulo, melhoria, descricao, descricao_detalhada, objetivo, objetivo_detalhado, as_is, to_be, prioridade, status, percentual_concluido, ordem_top, tipo_backlog, codigo_base,
                                    fase, data_ideia, data_abertura, numero_chamado, responsavel_id, responsavel, criado_por)
      values (left(trim(x->>'modulo'),200), left(trim(x->>'melhoria'),300), nullif(x->>'descricao',''), nullif(x->>'descricao_detalhada',''), nullif(x->>'objetivo',''), nullif(x->>'objetivo_detalhado',''),
              nullif(x->>'as_is',''), nullif(x->>'to_be',''), v_pr, v_st, case when v_st = 'Concluído' then 100 else 0 end, v_top, 'melhoria', v_cod,
              v_fase, v_id_, v_ab, v_nc, v_resp, case when v_resp is not null then v_resp_nome end, auth.uid())
      returning id into v_id;
      if v_st = 'Concluído' then update backlog_melhorias set data_conclusao = null where id = v_id; end if;   -- a planilha não traz a data de entrada em produção
      novas := novas + 1;
    else
      -- a base só FAZ AVANÇAR o status; o que foi andado no sistema (etapa, datas, prazo, %, responsável) não é desfeito.
      v_rn := case v_st when 'A Iniciar' then 0 when 'Concluído' then 2 else 1 end;
      v_ro := case v_old.status when 'A Iniciar' then 0 when 'Concluído' then 2 else 1 end;
      update backlog_melhorias set modulo = left(trim(x->>'modulo'),200), melhoria = left(trim(x->>'melhoria'),300), descricao = nullif(x->>'descricao',''), descricao_detalhada = nullif(x->>'descricao_detalhada',''),
        objetivo = nullif(x->>'objetivo',''), objetivo_detalhado = nullif(x->>'objetivo_detalhado',''), as_is = nullif(x->>'as_is',''), to_be = nullif(x->>'to_be',''), prioridade = v_pr, ordem_top = v_top,
        data_ideia = coalesce(v_id_, v_old.data_ideia), data_abertura = coalesce(v_ab, v_old.data_abertura), numero_chamado = coalesce(v_nc, v_old.numero_chamado),
        responsavel_id = coalesce(v_old.responsavel_id, v_resp), responsavel = case when v_old.responsavel_id is null and v_resp is not null then v_resp_nome else v_old.responsavel end,
        status = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) or v_rn <= v_ro then v_old.status else v_st end,
        percentual_concluido = case when exists(select 1 from backlog_etapas where melhoria_id = v_old.id) or v_rn <= v_ro then v_old.percentual_concluido when v_st = 'Concluído' then 100 else v_old.percentual_concluido end,
        fase = case when array_position(fases, v_fase) > array_position(fases, v_old.fase) then v_fase else v_old.fase end
      where id = v_old.id;
      if v_rn > v_ro and v_st = 'Concluído' and not exists(select 1 from backlog_etapas where melhoria_id = v_old.id) then update backlog_melhorias set data_conclusao = null where id = v_old.id; end if;
      atualizadas := atualizadas + 1;
    end if;
  end loop;
  return jsonb_build_object('novas', novas, 'atualizadas', atualizadas, 'sem_responsavel', sem_resp);
end $$;
revoke execute on function public.melhorias_importar(jsonb) from public, anon;

commit;

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

-- 023 — Melhorias sem etapas (COMO?): o andamento (%) passa a acompanhar a etapa do funil
--   Ideia 0% · Priorização 17% · Especificação 33% · Chamado aberto 50% · Desenvolvimento 67% · Homologação 83% · Produção 100%
-- As etapas "COMO?" antigas das melhorias ficam guardadas no banco, mas deixam de influenciar status e % (a tela não as mostra mais).
-- Correção/manutenção continua com etapas e % calculado por elas. Idempotente.
begin;

create or replace function public.bl_fase() returns trigger language plpgsql as $$
declare roll boolean := coalesce(current_setting('app.bl_rollup', true), '') = '1';
begin
  if new.tipo_backlog is distinct from 'melhoria' then return new; end if;
  if tg_op = 'UPDATE' and new.fase is distinct from old.fase and not roll then
    -- mudança manual de etapa: a etapa define o status
    if new.fase = 'producao' then new.status := 'Concluído'; new.percentual_concluido := 100;
    elsif new.fase in ('em_desenvolvimento','homologacao') then if new.status in ('A Iniciar','Concluído') then new.status := 'Em andamento'; end if;
    else new.status := 'A Iniciar'; new.percentual_concluido := 0; end if;
  else
    -- o status mudou (ou é um registro novo): ajusta a etapa
    if new.status = 'Concluído' then
      if new.fase not in ('homologacao','producao') then new.fase := case when roll then 'homologacao' else 'producao' end; end if;
    elsif new.status in ('Em andamento','Atrasado','Novo Prazo') then
      if new.fase not in ('em_desenvolvimento','homologacao') then new.fase := 'em_desenvolvimento'; end if;
    elsif new.fase in ('em_desenvolvimento','homologacao','producao') then
      new.fase := case when new.data_abertura is not null then 'chamado_aberto' when new.data_especificacao is not null then 'especificacao'
                       when new.data_priorizacao is not null or new.ordem_top is not null then 'priorizada' else 'ideia' end;
    end if;
  end if;
  if new.fase <> 'producao' then new.data_conclusao := null; end if;   -- a data de conclusão é a de entrada em produção
  -- o andamento (%) acompanha a etapa do funil: 0 · 17 · 33 · 50 · 67 · 83 · 100
  new.percentual_concluido := case new.fase when 'ideia' then 0 when 'priorizada' then 17 when 'especificacao' then 33 when 'chamado_aberto' then 50
                                            when 'em_desenvolvimento' then 67 when 'homologacao' then 83 else 100 end;
  return new;
end $$;

-- O roll-up das etapas não mexe mais nas melhorias do funil (só na Correção/manutenção).
create or replace function public.bl_rollup() returns trigger language plpgsql security definer set search_path=public as $$
declare mid uuid := coalesce(new.melhoria_id, old.melhoria_id); n int; pct numeric; st text;
begin
  if exists (select 1 from backlog_melhorias where id = mid and tipo_backlog = 'melhoria') then return null; end if;
  select count(*), round(avg(percentual_concluido),2),
    case when bool_and(status='Concluído') then 'Concluído'
         when bool_or(status='Atrasado') then 'Atrasado'
         when bool_or(status='Novo Prazo') then 'Novo Prazo'
         when bool_or(status in ('Em andamento','Concluído')) or avg(percentual_concluido) > 0 then 'Em andamento'
         else 'A Iniciar' end
    into n, pct, st from backlog_etapas where melhoria_id=mid;
  if n = 0 then return null; end if;   -- sem etapas: valores manuais
  if st = 'Concluído' then pct := 100; end if;
  perform set_config('app.bl_rollup','1',true);
  update backlog_melhorias set status=st, percentual_concluido=pct where id=mid and (status, percentual_concluido) is distinct from (st, pct);
  perform set_config('app.bl_rollup','',true);
  return null;
end $$;

-- O bloqueio "com etapas, status/% não editáveis" também não vale para as melhorias do funil.
create or replace function public.bl_guard() returns trigger language plpgsql as $$
begin
  if new.tipo_backlog is distinct from 'melhoria'
     and coalesce(current_setting('app.bl_rollup', true),'') <> '1' and exists(select 1 from backlog_etapas where melhoria_id=new.id) then
    new.status := old.status; new.percentual_concluido := old.percentual_concluido;
  end if;
  return new;
end $$;

-- Acerta o % das melhorias existentes (sem poluir o histórico de alterações).
alter table public.backlog_melhorias disable trigger hist_backlog_melhorias;
update public.backlog_melhorias set percentual_concluido = case fase when 'ideia' then 0 when 'priorizada' then 17 when 'especificacao' then 33 when 'chamado_aberto' then 50
  when 'em_desenvolvimento' then 67 when 'homologacao' then 83 else 100 end
 where tipo_backlog = 'melhoria';
alter table public.backlog_melhorias enable trigger hist_backlog_melhorias;
commit;

-- 025 — feriados, metas, comentários, backup, desfazer carga e avisos
begin;

-- ===== 1) Feriados (descontados do SLA em "dias úteis") =====
create table if not exists public.feriados(
  data date primary key,
  nome text not null check (length(trim(nome)) between 1 and 80),
  criado_por uuid default auth.uid());
alter table public.feriados enable row level security;
drop policy if exists fer_sel on public.feriados; drop policy if exists fer_ins on public.feriados; drop policy if exists fer_upd on public.feriados; drop policy if exists fer_del on public.feriados;
create policy fer_sel on public.feriados for select to authenticated using (public.is_active());
create policy fer_ins on public.feriados for insert to authenticated with check (public.is_sla_admin());
create policy fer_upd on public.feriados for update to authenticated using (public.is_sla_admin()) with check (public.is_sla_admin());
create policy fer_del on public.feriados for delete to authenticated using (public.is_sla_admin());
grant select, insert, update, delete on public.feriados to authenticated;
insert into public.feriados(data, nome) values
 ('2026-01-01','Confraternização Universal'),('2026-04-03','Sexta-feira Santa'),('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),('2026-06-04','Corpus Christi'),
 ('2026-09-07','Independência'),('2026-10-12','Nossa Sra. Aparecida'),('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Consciência Negra'),('2026-12-25','Natal'),
 ('2027-01-01','Confraternização Universal'),('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),('2027-05-27','Corpus Christi'),
 ('2027-09-07','Independência'),('2027-10-12','Nossa Sra. Aparecida'),('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Consciência Negra'),('2027-12-25','Natal'),
 ('2028-01-01','Confraternização Universal'),('2028-04-14','Sexta-feira Santa'),('2028-04-21','Tiradentes'),('2028-05-01','Dia do Trabalho'),('2028-06-15','Corpus Christi'),
 ('2028-09-07','Independência'),('2028-10-12','Nossa Sra. Aparecida'),('2028-11-02','Finados'),('2028-11-15','Proclamação da República'),('2028-11-20','Consciência Negra'),('2028-12-25','Natal')
on conflict (data) do nothing;

-- soma N dias úteis (segunda a sexta, sem feriados); a data inicial não conta. Espelha src/lib/sla.ts
create or replace function public.somar_dias_uteis(p_ini date, p_n int) returns date language plpgsql stable set search_path=public as $$
declare d date := p_ini; k int := 0;
begin
  while k < coalesce(p_n,0) loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists(select 1 from public.feriados f where f.data = d) then k := k + 1; end if;
  end loop;
  return d;
end $$;
grant execute on function public.somar_dias_uteis(date,int) to authenticated;

-- ===== 2) Metas da análise de chamados (linha única) =====
create table if not exists public.chamados_metas(
  id int primary key default 1 check (id = 1),
  meta_total_mes int check (meta_total_mes is null or meta_total_mes >= 0),
  meta_pct_prazo numeric(5,2) check (meta_pct_prazo is null or (meta_pct_prazo between 0 and 100)),
  atualizado_por uuid, atualizado_em timestamptz not null default now());
insert into public.chamados_metas(id) values (1) on conflict (id) do nothing;
alter table public.chamados_metas enable row level security;
drop policy if exists cm_sel on public.chamados_metas; drop policy if exists cm_upd on public.chamados_metas;
create policy cm_sel on public.chamados_metas for select to authenticated using (public.is_active());
create policy cm_upd on public.chamados_metas for update to authenticated using (public.is_sla_admin()) with check (public.is_sla_admin());
grant select, update on public.chamados_metas to authenticated;
create or replace function public.cm_carimbo() returns trigger language plpgsql as $$ begin new.atualizado_por := auth.uid(); new.atualizado_em := now(); return new; end $$;
drop trigger if exists cm_carimbo on public.chamados_metas;
create trigger cm_carimbo before update on public.chamados_metas for each row execute function public.cm_carimbo();

-- ===== 3) Comentários e menções (ideias/melhorias/correções e atividades/projetos) =====
create table if not exists public.comentarios(
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('melhoria','atividade')),
  entidade_id uuid not null,
  autor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  texto text not null check (length(trim(texto)) between 1 and 2000),
  mencoes uuid[] not null default '{}',
  criado_em timestamptz not null default now());
create index if not exists comentarios_ent_idx on public.comentarios(entidade, entidade_id, criado_em);
create index if not exists comentarios_menc_idx on public.comentarios using gin(mencoes);
alter table public.comentarios enable row level security;
drop policy if exists com_sel on public.comentarios; drop policy if exists com_ins on public.comentarios; drop policy if exists com_del on public.comentarios;
create policy com_sel on public.comentarios for select to authenticated using (public.is_active());
create policy com_ins on public.comentarios for insert to authenticated with check (
  public.is_active() and autor_id = auth.uid()
  and ((entidade = 'melhoria' and exists(select 1 from public.backlog_melhorias b where b.id = entidade_id))
    or (entidade = 'atividade' and exists(select 1 from public.microdeliveries m where m.id = entidade_id))));
create policy com_del on public.comentarios for delete to authenticated using (public.is_active() and (autor_id = auth.uid() or public.is_manager()));
grant select, insert, delete on public.comentarios to authenticated;

-- ===== 4) Backup semanal (cópia interna) + exportação manual =====
-- Não inclui jornadas pessoais nem atas (são privadas por usuário). Só o Analista Sr lê.
create table if not exists public.backup_snapshots(
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem text not null check (origem in ('semanal','manual')),
  qtd_linhas int not null default 0,
  dados jsonb not null);
alter table public.backup_snapshots enable row level security;
drop policy if exists bk_sel on public.backup_snapshots;
create policy bk_sel on public.backup_snapshots for select to authenticated using (public.is_manager());
grant select on public.backup_snapshots to authenticated;

create or replace function public.backup_dados() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'microdeliveries', coalesce((select jsonb_agg(to_jsonb(t)) from public.microdeliveries t), '[]'::jsonb),
    'backlog_melhorias', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_melhorias t), '[]'::jsonb),
    'backlog_etapas', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_etapas t), '[]'::jsonb),
    'backlog_chamados', coalesce((select jsonb_agg(to_jsonb(t)) from public.backlog_chamados t), '[]'::jsonb),
    'atividades_futuras', coalesce((select jsonb_agg(to_jsonb(t)) from public.atividades_futuras t), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(to_jsonb(t)) from public.feriados t), '[]'::jsonb),
    'chamados_metas', coalesce((select jsonb_agg(to_jsonb(t)) from public.chamados_metas t), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(to_jsonb(t)) from public.comentarios t), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'perfil', p.perfil, 'ativo', p.ativo)) from public.profiles p), '[]'::jsonb))
$$;
revoke all on function public.backup_dados() from public, anon, authenticated;

create or replace function public.backup_gerar(p_origem text default 'semanal') returns bigint language plpgsql security definer set search_path=public as $$
declare d jsonb; n int; novo bigint;
begin
  if p_origem not in ('semanal','manual') then raise exception 'origem inválida'; end if;
  d := public.backup_dados();
  n := (select coalesce(sum(jsonb_array_length(v)),0) from jsonb_each(d) e(k,v) where jsonb_typeof(v) = 'array');
  insert into public.backup_snapshots(origem, qtd_linhas, dados) values (p_origem, n, d) returning id into novo;
  delete from public.backup_snapshots s where s.origem = p_origem
    and s.id not in (select id from public.backup_snapshots where origem = p_origem order by id desc limit 8);   -- guarda os 8 mais recentes de cada origem
  return novo;
end $$;
revoke all on function public.backup_gerar(text) from public, anon, authenticated;

create or replace function public.backup_gerar_manual() returns bigint language plpgsql security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode gerar backup.'; end if;
  return public.backup_gerar('manual');
end $$;
revoke all on function public.backup_gerar_manual() from public, anon;
grant execute on function public.backup_gerar_manual() to authenticated;

create or replace function public.backup_exportar() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode exportar o backup.'; end if;
  return public.backup_dados();
end $$;
revoke all on function public.backup_exportar() from public, anon;
grant execute on function public.backup_exportar() to authenticated;

-- agenda o backup toda segunda, 06:00 UTC (03:00 em Fortaleza), se o pg_cron estiver ativo
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('backup-semanal', '0 6 * * 1', $c$select public.backup_gerar('semanal')$c$);
  end if;
end $$;

-- ===== 5) Desfazer a última carga da base de chamados =====
-- Antes de a base ser substituída (delete em backlog_chamados), guarda uma cópia. "Desfazer" devolve a base anterior (e guarda a atual: dá para desfazer o desfazer).
-- Atenção: atividades do Backlog já geradas pela carga errada NÃO são apagadas (a sincronização nunca apaga nada).
create table if not exists public.backlog_chamados_anterior(
  id int primary key default 1 check (id = 1),
  salvo_em timestamptz not null default now(),
  qtd int not null, dados jsonb not null);
alter table public.backlog_chamados_anterior enable row level security;
drop policy if exists bca_sel on public.backlog_chamados_anterior;
create policy bca_sel on public.backlog_chamados_anterior for select to authenticated using (public.is_manager());
grant select on public.backlog_chamados_anterior to authenticated;

create or replace function public.chamados_guardar_anterior() returns trigger language plpgsql security definer set search_path=public as $$
declare n int; d jsonb;
begin
  select count(*), coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into n, d from public.backlog_chamados c;
  if n > 0 then
    insert into public.backlog_chamados_anterior(id, salvo_em, qtd, dados) values (1, now(), n, d)
    on conflict (id) do update set salvo_em = excluded.salvo_em, qtd = excluded.qtd, dados = excluded.dados;
  end if;
  return null;
end $$;
drop trigger if exists bc_guardar_anterior on public.backlog_chamados;
create trigger bc_guardar_anterior before delete on public.backlog_chamados for each statement execute function public.chamados_guardar_anterior();

create or replace function public.chamados_desfazer_carga() returns int language plpgsql security definer set search_path=public as $$
declare d jsonb; n int;
begin
  if not public.is_manager() then raise exception 'Somente o Analista Sr pode desfazer a carga.'; end if;
  select dados, qtd into d, n from public.backlog_chamados_anterior where id = 1;
  if d is null then raise exception 'Não há carga anterior guardada.'; end if;
  delete from public.backlog_chamados where true;            -- o gatilho guarda a base atual no lugar da anterior
  insert into public.backlog_chamados select * from jsonb_populate_recordset(null::public.backlog_chamados, d);
  insert into public.backlog_chamados_carga(qtd) values (n);
  return n;
end $$;
revoke all on function public.chamados_desfazer_carga() from public, anon;
grant execute on function public.chamados_desfazer_carga() to authenticated;

-- ===== 6) Avisos semanais por e-mail (dados + destinatários) =====
create table if not exists public.avisos_config(
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  emails text[] not null default '{}',
  ultimo_envio timestamptz,
  ultimo_resultado text);
insert into public.avisos_config(id, emails) values (1, array['jsilas@almavivadobrasil.com.br']) on conflict (id) do nothing;
alter table public.avisos_config enable row level security;
drop policy if exists av_sel on public.avisos_config; drop policy if exists av_upd on public.avisos_config;
create policy av_sel on public.avisos_config for select to authenticated using (public.is_manager());
create policy av_upd on public.avisos_config for update to authenticated using (public.is_manager()) with check (public.is_manager());
grant select, update(ativo, emails) on public.avisos_config to authenticated;

-- Números do aviso. Só a chave de serviço (Edge Function) executa.
create or replace function public.avisos_dados() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare hoje date := (now() at time zone 'America/Fortaleza')::date; r jsonb;
begin
  with m as (
    select b.*, 
      case when b.fase = 'chamado_aberto' and b.data_abertura is not null then public.somar_dias_uteis(b.data_abertura, coalesce(b.sla_chamado_dias_uteis,3))
           when b.fase = 'em_desenvolvimento' and b.data_inicio is not null then b.data_inicio + coalesce(b.sla_dev_dias_corridos,15) end as sla_venc
    from public.backlog_melhorias b where b.tipo_backlog = 'melhoria'),
  pv as (select melhoria as titulo, modulo, responsavel, hoje - data_termino as dias from m where data_termino < hoje and fase <> 'producao' order by dias desc),
  sv as (select melhoria as titulo, modulo, responsavel, hoje - sla_venc as dias from m where sla_venc is not null and sla_venc < hoje and fase in ('chamado_aberto','em_desenvolvimento') order by dias desc),
  sr as (select melhoria as titulo, modulo, null::text as responsavel, hoje - criado_em::date as dias from m where responsavel_id is null and fase <> 'producao' order by dias desc),
  cv as (select melhoria as titulo, modulo, responsavel, hoje - data_termino as dias from public.backlog_melhorias where tipo_backlog = 'correcao' and data_termino < hoje and status <> 'Concluído' order by dias desc),
  av as (select demanda as titulo, tipo_projeto as modulo, (select nome from public.profiles p where p.id = d.responsavel_id) as responsavel, hoje - data_target as dias
           from public.microdeliveries d where data_target < hoje and quantidade - concluido - cancelado > 0 order by dias desc)
  select jsonb_build_object('hoje', hoje,
    'melhorias_prazo_vencido', jsonb_build_object('total', (select count(*) from pv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pv limit 10) x), '[]'::jsonb)),
    'melhorias_sla_vencido',   jsonb_build_object('total', (select count(*) from sv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sv limit 10) x), '[]'::jsonb)),
    'melhorias_sem_responsavel', jsonb_build_object('total', (select count(*) from sr), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sr limit 10) x), '[]'::jsonb)),
    'correcoes_prazo_vencido', jsonb_build_object('total', (select count(*) from cv), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from cv limit 10) x), '[]'::jsonb)),
    'atividades_prazo_vencido', jsonb_build_object('total', (select count(*) from av), 'itens', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from av limit 10) x), '[]'::jsonb)))
  into r;
  return r;
end $$;
revoke all on function public.avisos_dados() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.avisos_dados() to service_role; end if; end $$;

commit;

-- ===== 026 =====
-- 026: agenda o aviso semanal por e-mail (segunda 08:00 Fortaleza = 11:00 UTC).
-- O segredo do agendamento é gerado AQUI, dentro do banco (Vault); nenhum valor precisa ser copiado à mão.
-- A função aviso-semanal confere o segredo por cron_secret_ok() (só service_role).
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'cron_secret', 'Segredo do agendamento do aviso semanal');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text) returns boolean
language sql security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

select cron.unschedule('aviso-semanal') where exists (select 1 from cron.job where jobname = 'aviso-semanal');
select cron.schedule('aviso-semanal', '0 11 * * 1', $job$
  select net.http_post(
    url := 'https://hgzubmiwmflfaobnuvdu.supabase.co/functions/v1/aviso-semanal',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$job$);

-- ===== 027 =====
-- 027: reincidência dos chamados (coluna "REINCIDENTE ?" da planilha) para o "Resumo do mês" da Análise de chamados.
-- A importação passa a gravar a coluna; cargas anteriores (e o "Desfazer carga") continuam funcionando (valor vazio).
alter table public.backlog_chamados add column if not exists reincidente boolean;

create or replace function public.chamados_substituir(p_rows jsonb) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode importar a base de chamados.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nenhuma linha para importar.'; end if;
  delete from backlog_chamados where true;
  insert into backlog_chamados(id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase,reincidente)
    select id_chamado,data_identificacao,data_ref,categoria,subcategoria,tipo,item_sintoma,sistema_ofensor,cliente,site,status,prazo,responsavel,empresa_responsavel,responsavel_rocco,fase,reincidente
    from jsonb_to_recordset(p_rows) as x(id_chamado text,data_identificacao date,data_ref date,categoria text,subcategoria text,tipo text,item_sintoma text,sistema_ofensor text,cliente text,site text,status text,prazo text,responsavel text,empresa_responsavel text,responsavel_rocco text,fase text,reincidente boolean);
  get diagnostics n = row_count;
  insert into backlog_chamados_carga(qtd) values (n);
  perform chamados_sincronizar();   -- chamados válidos viram/atualizam atividades do Backlog
  return n;
end $$;
revoke all on function public.chamados_substituir(jsonb) from public, anon;
grant execute on function public.chamados_substituir(jsonb) to authenticated;

-- ===== 028_semanal.sql =====
begin;
create table if not exists public.semanais(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  titulo text not null default 'Semanal Italo' check (length(trim(titulo)) between 1 and 200),
  data_reuniao date not null default current_date,
  blocos jsonb not null default '[]'::jsonb check (jsonb_typeof(blocos) = 'array' and length(blocos::text) <= 12000000),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create index if not exists semanais_user_data on public.semanais(user_id, data_reuniao desc);
alter table public.semanais enable row level security;
drop policy if exists sem_sel on public.semanais; drop policy if exists sem_ins on public.semanais; drop policy if exists sem_upd on public.semanais; drop policy if exists sem_del on public.semanais;
create policy sem_sel on public.semanais for select to authenticated using ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_ins on public.semanais for insert to authenticated with check ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_upd on public.semanais for update to authenticated using ((select is_manager()) and user_id = (select auth.uid())) with check ((select is_manager()) and user_id = (select auth.uid()));
create policy sem_del on public.semanais for delete to authenticated using ((select is_manager()) and user_id = (select auth.uid()));
revoke all on public.semanais from anon;
drop trigger if exists touch_semanais on public.semanais;
create trigger touch_semanais before update on public.semanais for each row execute function touch_updated();
commit;
