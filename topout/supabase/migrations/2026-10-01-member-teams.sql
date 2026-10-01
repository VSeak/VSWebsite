-- A team member can be on more than one team (location).
-- team_members.location_id (one team) becomes team_member_locations (a list). Adding a member goes through
-- team_add_member(), which adds them and their first team together.
begin;

create table public.team_member_locations (
  member_id uuid not null references public.team_members (id) on delete cascade,
  location_id uuid not null references public.team_locations (id) on delete restrict,   -- take members off first
  primary key (member_id, location_id)
);
create index on public.team_member_locations (location_id);
insert into public.team_member_locations (member_id, location_id) select id, location_id from public.team_members;

-- An admin, or a coach at one of the member's teams.
create or replace function public.team_can_member(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.team_is_admin() or exists (
    select 1 from public.team_member_locations ml where ml.member_id = p and public.team_can_location(ml.location_id));
$$;

drop policy "staff: everything" on public.team_members;
alter table public.team_members drop column location_id;   -- its index goes with it

-- Members: anyone who coaches one of their teams. New members come in through team_add_member().
create policy "staff: read" on public.team_members for select to authenticated using (public.team_can_member(id));
create policy "staff: change" on public.team_members for update to authenticated
  using (public.team_can_member(id)) with check (public.team_can_member(id));
create policy "staff: delete" on public.team_members for delete to authenticated using (public.team_can_member(id));

-- Teams: anyone who sees the member sees all their teams; a coach adds or takes off only their own locations.
alter table public.team_member_locations enable row level security;
create policy "staff: read" on public.team_member_locations for select to authenticated using (public.team_can_member(member_id));
create policy "staff: add" on public.team_member_locations for insert to authenticated
  with check (public.team_can_location(location_id) and public.team_can_member(member_id));
create policy "staff: remove" on public.team_member_locations for delete to authenticated using (public.team_can_location(location_id));

-- Adds a member and their teams in one step (the member can't be read back until they're on a team).
create function public.team_add_member(p_first text, p_last text, p_pronouns text, p_email text, p_joined date, p_locations uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if coalesce(cardinality(p_locations), 0) = 0 or not public.team_can_all_locations(p_locations) then
    raise exception 'You can only add members to a team you coach.' using errcode = '42501';
  end if;
  insert into public.team_members (first_name, last_name, pronouns, email, joined_on)
    values (p_first, p_last, p_pronouns, p_email, p_joined) returning id into new_id;
  insert into public.team_member_locations (member_id, location_id) select distinct new_id, l from unnest(p_locations) l;
  return new_id;
end $$;
revoke execute on function public.team_add_member(text, text, text, text, date, uuid[]) from public, anon;
grant execute on function public.team_add_member(text, text, text, text, date, uuid[]) to authenticated;

commit;
