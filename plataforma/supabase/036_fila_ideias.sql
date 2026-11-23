-- 036 · Fila de ideias (ranking dentro da coluna "Ideia" de Melhorias)
alter table public.backlog_melhorias add column if not exists fila_ideia integer;
comment on column public.backlog_melhorias.fila_ideia is 'Posição na fila de ideias (1 = próxima a ser priorizada). Só vale enquanto fase = ideia.';

create or replace function public.bl_fila_ideia() returns trigger language plpgsql set search_path = public as $$
begin
  if new.tipo_backlog is distinct from 'melhoria' then return new; end if;
  if new.fase = 'ideia' then
    if new.fila_ideia is null then
      select coalesce(max(fila_ideia), 0) + 1 into new.fila_ideia from backlog_melhorias where tipo_backlog = 'melhoria' and fase = 'ideia' and id is distinct from new.id;
    end if;
  else
    new.fila_ideia := null;
  end if;
  return new;
end $$;

drop trigger if exists zz_fila_ideia_backlog_melhorias on public.backlog_melhorias;
create trigger zz_fila_ideia_backlog_melhorias before insert or update on public.backlog_melhorias
  for each row execute function public.bl_fila_ideia();

with o as (
  select id, row_number() over (order by coalesce(ordem_top, 9999), prioridade, lower(melhoria), id) rn
  from public.backlog_melhorias where tipo_backlog = 'melhoria' and fase = 'ideia')
update public.backlog_melhorias b set fila_ideia = o.rn from o where b.id = o.id;

create or replace function public.melhorias_fila_ideias(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then raise exception 'Somente o Analista Sr pode reordenar a fila de ideias.' using errcode = '42501'; end if;
  with ordem as (
    select id, row_number() over (order by pos, fila_ideia, id) rn from (
      select b.id, b.fila_ideia, coalesce(x.pos, 1000000) pos
      from backlog_melhorias b left join unnest(p_ids) with ordinality x(id, pos) on x.id = b.id
      where b.tipo_backlog = 'melhoria' and b.fase = 'ideia') s)
  update backlog_melhorias b set fila_ideia = ordem.rn from ordem where b.id = ordem.id and b.fila_ideia is distinct from ordem.rn;
end $$;
revoke all on function public.melhorias_fila_ideias(uuid[]) from public, anon;
grant execute on function public.melhorias_fila_ideias(uuid[]) to authenticated;
