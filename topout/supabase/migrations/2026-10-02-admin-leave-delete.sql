-- Only an admin marks a member as left (Left the Team) or deletes a member. Coaches can still bring someone
-- back (Back on Team clears left_on). The SQL Editor (no signed-in user) is not blocked.
-- Run once in the SQL Editor.
begin;

create function public.team_only_admin_leaves() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.team_is_admin() then
    raise exception 'Only an admin can mark someone as left.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger team_only_admin_leaves before update of left_on on public.team_members
  for each row when (new.left_on is not null and new.left_on is distinct from old.left_on)
  execute function public.team_only_admin_leaves();
revoke execute on function public.team_only_admin_leaves() from public, anon, authenticated;

drop policy "staff: delete" on public.team_members;
create policy "admins: delete" on public.team_members for delete to authenticated using (public.team_is_admin());

commit;
