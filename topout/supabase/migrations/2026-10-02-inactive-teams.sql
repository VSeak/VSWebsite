-- A member can be inactive on one team and active on another (switched locations, but still on both teams' lists).
-- inactive_on set = inactive on that team since that day. Left the Team (team_members.left_on) is still for leaving Adult Team.
-- Run once in the SQL Editor.
begin;

alter table public.team_member_locations add column inactive_on date;

-- A coach marks a member active or inactive only on their own locations.
create policy "staff: change" on public.team_member_locations for update to authenticated
  using (public.team_can_location(location_id)) with check (public.team_can_location(location_id));

-- Add to <location> on someone already on that team but inactive there makes them active again.
create or replace function public.team_join_location(p_member uuid, p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.team_can_location(p_location) then
    raise exception 'You can only add members to a team you coach.' using errcode = '42501';
  end if;
  insert into public.team_member_locations (member_id, location_id) values (p_member, p_location)
    on conflict (member_id, location_id) do update set inactive_on = null;
end $$;

-- The same-name check says which of their teams they're inactive on.
create or replace function public.team_same_name(p_first text, p_last text)
returns table (member_id uuid, pronouns text, locations text, left_team boolean) language sql stable security definer set search_path = '' as $$
  select m.id, m.pronouns,
         coalesce(string_agg(l.name || case when ml.inactive_on is not null then ' (inactive)' else '' end, ', ' order by l.position, l.name), ''),
         m.left_on is not null
  from public.team_members m
  left join public.team_member_locations ml on ml.member_id = m.id
  left join public.team_locations l on l.id = ml.location_id
  where public.team_is_staff() and not public.team_can_member(m.id)
    and lower(m.first_name) = lower(trim(p_first)) and lower(m.last_name) = lower(trim(p_last))
  group by m.id;
$$;

commit;
