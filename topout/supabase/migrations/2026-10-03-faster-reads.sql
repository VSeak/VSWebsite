-- Faster reads. The read rules checked team_can_member() / team_can_location() once per row, so a Summary or
-- Check-In Answers over many check-ins ran the staff lookup hundreds of times. Now the signed-in person's locations
-- and members are worked out once per query (team_my_locations(), team_my_members()) and each row is just looked up
-- in that list. Who can see what stays exactly the same; adding, changing and deleting keep their per-row checks.
begin;

-- The locations team_can_location() says yes to: every one for an admin, else the ones they coach.
create or replace function public.team_my_locations() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when public.team_is_admin() then (select coalesce(array_agg(id), '{}') from public.team_locations)
    else (select coalesce(array_agg(sl.location_id), '{}') from public.team_staff_locations sl join public.team_staff s on s.id = sl.staff_id
          where s.email = lower(auth.jwt() ->> 'email') and 'coach' = any (s.roles)) end;
$$;

-- The members team_can_member() says yes to: every one for an admin, else anyone on one of their teams.
create or replace function public.team_my_members() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.team_members where public.team_is_admin()
  union
  select member_id from public.team_member_locations where location_id = any (public.team_my_locations());
$$;

revoke execute on function public.team_my_locations(), public.team_my_members() from public, anon;
grant execute on function public.team_my_locations(), public.team_my_members() to authenticated;

alter policy "staff: read" on public.team_locations to authenticated using (id in (select unnest(public.team_my_locations())));
alter policy "staff: read" on public.team_members to authenticated using (id in (select public.team_my_members()));
alter policy "staff: read" on public.team_member_locations to authenticated using (member_id in (select public.team_my_members()));
alter policy "staff: everything" on public.team_goals to authenticated
  using (member_id in (select public.team_my_members())) with check (public.team_can_member(member_id));
alter policy "staff: read" on public.team_exits to authenticated using (member_id in (select public.team_my_members()));
alter policy "staff: read" on public.team_coach_notes to authenticated using (member_id in (select public.team_my_members()));
alter policy "staff: read" on public.team_checkins to authenticated using (member_id in (select public.team_my_members()));
alter policy "staff: everything" on public.team_focus to authenticated
  using (location_id in (select unnest(public.team_my_locations()))) with check (public.team_can_location(location_id));
alter policy "staff: read" on public.team_events to authenticated
  using ((location_ids is null and (select public.team_is_staff())) or location_ids && (select public.team_my_locations()));

commit;
