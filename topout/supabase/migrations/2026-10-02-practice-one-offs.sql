-- One-off practices (the user asked): editing a practice from an event can Save to This Event Only, which makes a copy
-- just for that event (event_only, based_on = the practice it came from) and leaves the original alone.
-- A one-off no event uses any more is deleted. Run once in the SQL Editor.
begin;

alter table public.team_practices
  add column based_on uuid references public.team_practices (id) on delete set null,
  add column event_only boolean not null default false;

-- Save to This Event Only. A one-off only this event uses is changed in place; otherwise a new one-off is made and the
-- event links to it, in one go (security invoker, so the usual rules apply: if the coach can't change the event,
-- nothing is saved).
create function public.team_event_practice(p_event uuid, p_name text, p_summary text, p_area_ids uuid[], p_blocks jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  cur public.team_practices;
  new_id uuid;
begin
  select p.* into cur from public.team_events e join public.team_practices p on p.id = e.practice_id where e.id = p_event;
  if cur.id is null then raise exception 'That event has no practice plan.'; end if;
  if cur.event_only and not exists (select 1 from public.team_events where practice_id = cur.id and id <> p_event) then
    update public.team_practices set name = p_name, summary = p_summary, area_ids = p_area_ids, blocks = p_blocks where id = cur.id;
    return cur.id;
  end if;
  insert into public.team_practices (name, summary, area_ids, blocks, based_on, event_only)
    values (p_name, p_summary, p_area_ids, p_blocks, coalesce(cur.based_on, cur.id), true) returning id into new_id;
  update public.team_events set practice_id = new_id where id = p_event;
  if not found then raise exception 'Only a coach at every location of this event can change it.'; end if;
  return new_id;
end;
$$;

-- A one-off that no event links to any more (the event picked another plan, or was deleted) goes too.
create function public.team_drop_unused_one_off() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.practice_id is not null then
    delete from public.team_practices p where p.id = old.practice_id and p.event_only
      and not exists (select 1 from public.team_events e where e.practice_id = p.id);
  end if;
  return null;
end;
$$;
create trigger team_drop_unused_one_off after update of practice_id or delete on public.team_events
  for each row execute function public.team_drop_unused_one_off();

revoke execute on function public.team_drop_unused_one_off() from public, anon, authenticated;
revoke execute on function public.team_event_practice(uuid, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.team_event_practice(uuid, text, text, uuid[], jsonb) to authenticated;

commit;
