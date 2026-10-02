-- Left the Team marks every team the member is on inactive (from their last day), including teams the coach
-- doesn't coach. Back on Team leaves them inactive; the coach picks the team they come back to.
-- Also marks inactive the teams of members who already left. Run once in the SQL Editor.
begin;

create function public.team_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.team_member_locations set inactive_on = new.left_on where member_id = new.id and inactive_on is null;
  return new;
end;
$$;
create trigger team_member_left after update of left_on on public.team_members
  for each row when (old.left_on is null and new.left_on is not null) execute function public.team_member_left();
revoke execute on function public.team_member_left() from public, anon, authenticated;

update public.team_member_locations ml set inactive_on = m.left_on
  from public.team_members m where m.id = ml.member_id and m.left_on is not null and ml.inactive_on is null;

commit;
