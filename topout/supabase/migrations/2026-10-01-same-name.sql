-- Add Member's same-name check, for members the person adding can't see (on teams at locations they don't coach).
-- It says only where they are and whether they've left: no id, so a coach still can't open them.
create function public.team_same_name(p_first text, p_last text)
returns table (locations text, left_team boolean) language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(l.name, ', ' order by l.position, l.name), ''), m.left_on is not null
  from public.team_members m
  left join public.team_member_locations ml on ml.member_id = m.id
  left join public.team_locations l on l.id = ml.location_id
  where public.team_is_staff() and not public.team_can_member(m.id)
    and lower(m.first_name) = lower(trim(p_first)) and lower(m.last_name) = lower(trim(p_last))
  group by m.id;
$$;
revoke execute on function public.team_same_name(text, text) from public, anon;
grant execute on function public.team_same_name(text, text) to authenticated;
