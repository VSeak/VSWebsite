-- A coach can put a member who is already on another team onto their own location (from Add Member's same-name check),
-- even when they don't coach that member's other team. team_same_name now also returns the member's id for that.
begin;

drop function public.team_same_name(text, text);
create function public.team_same_name(p_first text, p_last text)
returns table (member_id uuid, locations text, left_team boolean) language sql stable security definer set search_path = '' as $$
  select m.id, coalesce(string_agg(l.name, ', ' order by l.position, l.name), ''), m.left_on is not null
  from public.team_members m
  left join public.team_member_locations ml on ml.member_id = m.id
  left join public.team_locations l on l.id = ml.location_id
  where public.team_is_staff() and not public.team_can_member(m.id)
    and lower(m.first_name) = lower(trim(p_first)) and lower(m.last_name) = lower(trim(p_last))
  group by m.id;
$$;

-- Puts a member on a location the caller coaches (or any, for an admin). After this they can see the member.
create function public.team_join_location(p_member uuid, p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.team_can_location(p_location) then
    raise exception 'You can only add members to a team you coach.' using errcode = '42501';
  end if;
  insert into public.team_member_locations (member_id, location_id) values (p_member, p_location) on conflict do nothing;
end $$;

revoke execute on function public.team_same_name(text, text), public.team_join_location(uuid, uuid) from public, anon;
grant execute on function public.team_same_name(text, text), public.team_join_location(uuid, uuid) to authenticated;

commit;
