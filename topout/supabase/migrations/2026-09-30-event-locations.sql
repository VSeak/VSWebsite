-- Calendar events at several locations, and repeating events.
-- location_id (one location, or null = every location) becomes location_ids (a list, or null = every location).
-- series_id ties together the events made by one Repeats Weekly, so they can be changed or deleted together.
begin;

alter table public.team_events add column location_ids uuid[] check (location_ids is null or cardinality(location_ids) > 0);
alter table public.team_events add column series_id uuid;
update public.team_events set location_ids = array[location_id] where location_id is not null;

drop policy "staff: read" on public.team_events;
drop policy "staff: write" on public.team_events;
alter table public.team_events drop column location_id;   -- its indexes go with it
create index on public.team_events using gin (location_ids);
create index on public.team_events (event_date) where location_ids is null;
create index on public.team_events (series_id, event_date) where series_id is not null;

-- Can see one of these locations (reading an event), or every one of them (changing it).
create function public.team_can_any_location(p uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p) l where public.team_can_location(l));
$$;
create function public.team_can_all_locations(p uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(p) > 0 and not exists (select 1 from unnest(p) l where not public.team_can_location(l));
$$;
revoke execute on function public.team_can_any_location(uuid[]), public.team_can_all_locations(uuid[]) from public, anon;
grant execute on function public.team_can_any_location(uuid[]), public.team_can_all_locations(uuid[]) to authenticated;

-- Calendar: staff read the events at their locations and every-location events; they change an event only when
-- they have all its locations. Admins change any (and only they add every-location ones).
create policy "staff: read" on public.team_events for select to authenticated
  using ((location_ids is null and (select public.team_is_staff())) or public.team_can_any_location(location_ids));
create policy "staff: write" on public.team_events for all to authenticated
  using ((select public.team_is_admin()) or (location_ids is not null and public.team_can_all_locations(location_ids)))
  with check ((select public.team_is_admin()) or (location_ids is not null and public.team_can_all_locations(location_ids)));

-- A deleted location comes off its events; an event that was only there goes too.
create function public.team_drop_event_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.team_events where location_ids = array[old.id];
  update public.team_events set location_ids = array_remove(location_ids, old.id) where old.id = any (location_ids);
  return old;
end;
$$;
create trigger team_drop_event_location after delete on public.team_locations
  for each row execute function public.team_drop_event_location();
revoke execute on function public.team_drop_event_location() from public, anon, authenticated;

commit;
