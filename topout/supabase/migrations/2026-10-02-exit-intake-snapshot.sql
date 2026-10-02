-- Exit Intake keeps a copy of the member's intake (why they joined, what they wanted) from when the exit row is made,
-- so a later Save Intake doesn't change it. The database copies it on insert and keeps it on every update.
-- Exits made before this get the intake as it is now (the best there is). Run once in the SQL Editor.
begin;

alter table public.team_exits
  add column joined_why text not null default '',
  add column joined_wants text not null default '';

-- Fill in earlier exits without stamping them as Updated.
alter table public.team_exits disable trigger team_stamp_author;
update public.team_exits x set joined_why = m.intake_why, joined_wants = m.intake_wants
  from public.team_members m where m.id = x.member_id;
alter table public.team_exits enable trigger team_stamp_author;

create function public.team_exit_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select m.intake_why, m.intake_wants into new.joined_why, new.joined_wants from public.team_members m where m.id = new.member_id;
  else
    new.joined_why := old.joined_why;
    new.joined_wants := old.joined_wants;
  end if;
  return new;
end;
$$;
create trigger team_exit_snapshot before insert or update on public.team_exits
  for each row execute function public.team_exit_snapshot();
revoke execute on function public.team_exit_snapshot() from public, anon, authenticated;

commit;
