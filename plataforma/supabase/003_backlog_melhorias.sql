-- MIGRAÇÃO 003 — Backlog de Melhorias. Para quem JÁ tem o banco no ar (001 + 002 já executados). NÃO execute em instalação nova (use só o 001).
-- Cria a tabela backlog_melhorias, auditoria e as políticas de acesso (RLS). Não altera nada existente.
begin;

-- ===== Backlog de Melhorias (ideias, correções e melhorias solicitadas pelo time) =====
-- Leitura: todos os usuários ativos. Criar: qualquer usuário ativo. Editar: quem criou OU diretor/gerente/analista_sr.
-- Excluir: somente analista_sr (administração). Toda alteração é registrada em audit_log (antes/depois).
create table public.backlog_melhorias(
  id uuid primary key default gen_random_uuid(),
  modulo text not null check (length(trim(modulo)) > 0),          -- ex.: Gestão Executiva, Tabelas, Meus Feedback, Todos os módulos
  melhoria text not null check (length(trim(melhoria)) > 0),       -- nome curto
  descricao text, descricao_detalhada text,                        -- o que é / explicação aprofundada
  objetivo text, objetivo_detalhado text,                          -- benefício esperado / impacto operacional
  as_is text, to_be text,                                          -- cenário atual / cenário futuro
  prioridade int not null default 3 check (prioridade >= 1),       -- 1 = mais alta
  status text not null default 'A Iniciar' check (status in ('A Iniciar','Em andamento','Concluído','Atrasado','Novo Prazo')),
  percentual_concluido numeric(5,2) not null default 0 check (percentual_concluido between 0 and 100),
  responsavel text,
  data_inicio date, data_termino date,
  observacoes text,
  criado_por uuid default auth.uid() references profiles(id) on delete set null,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint bl_datas check (data_inicio is null or data_termino is null or data_termino >= data_inicio),
  constraint bl_concluido_100 check (status <> 'Concluído' or percentual_concluido = 100));
create index on backlog_melhorias(status);
create index on backlog_melhorias(modulo);
create trigger touch_backlog before update on backlog_melhorias for each row execute function touch_updated();
create trigger audit_backlog_melhorias after insert or update or delete on backlog_melhorias for each row execute function log_audit();

alter table backlog_melhorias enable row level security;
create policy bl_sel on backlog_melhorias for select to authenticated using (is_active());
create policy bl_ins on backlog_melhorias for insert to authenticated with check (is_active() and criado_por = auth.uid());
create policy bl_upd on backlog_melhorias for update to authenticated
  using (is_active() and (criado_por = auth.uid() or is_viewer_all()))
  with check (is_active() and (criado_por = auth.uid() or is_viewer_all()));
create policy bl_del on backlog_melhorias for delete to authenticated using (is_manager());

commit;
