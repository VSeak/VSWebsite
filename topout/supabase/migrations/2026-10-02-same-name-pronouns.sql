-- Add Member's same-name check also shows the member's pronouns, for members on teams the coach doesn't coach.
-- Run once in the SQL Editor.
begin;

drop function public.team_same_name(text, text);
create function public.team_same_name(p_first text, p_last text)
returns table (member_id uuid, pronouns text, locations text, left_team boolean) language sql stable security definer set search_path = '' as $$
  select m.id, m.pronouns, coalesce(string_agg(l.name, ', ' order by l.position, l.name), ''), m.left_on is not null
  from public.team_members m
  left join public.team_member_locations ml on ml.member_id = m.id
  left join public.team_locations l on l.id = ml.location_id
  where public.team_is_staff() and not public.team_can_member(m.id)
    and lower(m.first_name) = lower(trim(p_first)) and lower(m.last_name) = lower(trim(p_last))
  group by m.id;
$$;
revoke execute on function public.team_same_name(text, text) from public, anon;
grant execute on function public.team_same_name(text, text) to authenticated;

commit;
