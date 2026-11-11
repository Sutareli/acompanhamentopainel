-- MIGRAÇÃO 006 — Atividades futuras (por bloco) + Projetos (MacroProjetos/MicroProjetos, "com quem está").
-- Requer 001/002. NÃO execute em instalação nova (use só o 001). Não apaga dados.
begin;

-- ===== Atividades futuras: agendadas por bloco para outras datas =====
-- Ficam em tabela própria: "Limpar lista do dia" NÃO as remove. Na data alvo, futuras_incorporar() as coloca na lista do dia (uma única vez).
create table public.atividades_futuras(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  bloco_numero int not null check (bloco_numero between 1 and 5),
  data_alvo date not null,
  descricao text not null check (length(trim(descricao))>0),
  incorporada_em timestamptz,
  criado_em timestamptz not null default now());
create index on atividades_futuras(user_id, data_alvo);
alter table public.daily_tasks add column futura_id uuid references atividades_futuras(id) on delete set null;   -- origem (não é copiada para o dia seguinte)

alter table atividades_futuras enable row level security;
create policy af_sel on atividades_futuras for select to authenticated using (is_active() and (user_id=auth.uid() or is_viewer_all()));
create policy af_ins on atividades_futuras for insert to authenticated with check (user_id=auth.uid() and is_active());
create policy af_upd on atividades_futuras for update to authenticated using (user_id=auth.uid() and is_active()) with check (user_id=auth.uid() and is_active());
create policy af_del on atividades_futuras for delete to authenticated using (user_id=auth.uid() and is_active());

-- Coloca na lista do dia p_data (já criado, com seus 5 blocos) as futuras com data alvo <= p_data. Atômica: duas abas não duplicam.
create function public.futuras_incorporar(p_data date) returns int language plpgsql as $$
declare n int;
begin
  if p_data > (now() at time zone 'America/Fortaleza')::date then raise exception 'data no futuro'; end if;
  with mov as (
    update atividades_futuras f set incorporada_em=now()
     where f.user_id=auth.uid() and f.incorporada_em is null and f.data_alvo<=p_data
       and exists(select 1 from daily_records r join daily_blocks b on b.daily_record_id=r.id where r.user_id=f.user_id and r.data=p_data and b.numero=f.bloco_numero)
    returning f.id, f.user_id, f.bloco_numero, f.descricao, f.data_alvo, f.criado_em)
  insert into daily_tasks(user_id,block_id,descricao,ordem,futura_id)
    select m.user_id, b.id, m.descricao,
           coalesce((select max(t.ordem)+1 from daily_tasks t where t.block_id=b.id),0) + row_number() over (partition by b.id order by m.data_alvo, m.criado_em) - 1, m.id
    from mov m join daily_records r on r.user_id=m.user_id and r.data=p_data join daily_blocks b on b.daily_record_id=r.id and b.numero=m.bloco_numero;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===== Projetos (antigas Microentregas): tipo e "com quem está" =====
alter table public.microdeliveries
  add column tipo_projeto text not null default 'micro' check (tipo_projeto in ('macro','micro')),   -- MacroProjeto / MicroProjeto
  add column com_quem_id uuid references profiles(id);                                                 -- com quem o projeto está agora (MacroProjetos)
create index on microdeliveries(tipo_projeto);

drop view public.v_microdeliveries;
create view public.v_microdeliveries with (security_invoker=true) as
select m.*, p.nome as responsavel_nome, c.nome as com_quem_nome, md_status(a_iniciar,em_andamento,concluido,cancelado,quantidade) as status_geral,
  (data_target < (now() at time zone 'America/Fortaleza')::date and a_iniciar+em_andamento>0) as atrasada,
  case when quantidade-cancelado=0 then null else round(100.0*concluido/(quantidade-cancelado)) end as pct_conclusao
from microdeliveries m join profiles p on p.id=m.responsavel_id left join profiles c on c.id=m.com_quem_id;

drop policy md_ins on microdeliveries;
drop policy md_upd on microdeliveries;
create policy md_ins on microdeliveries for insert to authenticated
  with check (is_active() and criado_por=auth.uid() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));
create policy md_upd on microdeliveries for update to authenticated
  using (is_active()) with check (is_active() and exists(select 1 from profiles where id=responsavel_id and ativo)
              and (com_quem_id is null or exists(select 1 from profiles where id=com_quem_id and ativo)));

create or replace function public.md_before_update() returns trigger language plpgsql security definer set search_path=public as $$
declare k text; o jsonb:=to_jsonb(old); n jsonb:=to_jsonb(new); so text; sn text;
begin
  new.atualizado_em := now();
  foreach k in array array['criticidade','responsavel_id','demanda','resumo','data_target','quantidade','a_iniciar','em_andamento','concluido','cancelado','observacoes','tipo_projeto','com_quem_id'] loop
    if o->k is distinct from n->k then
      insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_anterior,valor_novo) values(old.id,auth.uid(),k,o->>k,n->>k);
    end if;
  end loop;
  so:=md_status(old.a_iniciar,old.em_andamento,old.concluido,old.cancelado,old.quantidade);
  sn:=md_status(new.a_iniciar,new.em_andamento,new.concluido,new.cancelado,new.quantidade);
  if so<>sn then insert into microdelivery_history(microdelivery_id,usuario_id,campo_alterado,valor_anterior,valor_novo) values(old.id,auth.uid(),'status_geral',so,sn); end if;
  return new;
end $$;

commit;
