-- Exit Intake: why someone left Adult Team, asked when they're marked as Left the Team (every field optional).
-- One row per time they left, so someone who comes back and leaves again keeps both. reasons are keys from EXIT_REASONS
-- in member.js (not checked here, so the list can change). Read and changed by anyone who sees the member; deleted with them.
-- Run once in the SQL Editor.
begin;

create table public.team_exits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  left_on date not null,
  reasons text[] not null default '{}',
  details text not null default '',     -- in their words
  better text not null default '',      -- what we could have done better
  come_back text not null default '' check (come_back in ('', 'yes', 'maybe', 'no')),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.team_exits (member_id);

create trigger team_stamp_author before insert or update on public.team_exits
  for each row execute function public.team_stamp_author();

alter table public.team_exits enable row level security;
create policy "staff: read" on public.team_exits for select to authenticated using (public.team_can_member(member_id));
create policy "staff: add" on public.team_exits for insert to authenticated with check (public.team_can_member(member_id));
create policy "staff: change" on public.team_exits for update to authenticated
  using (public.team_can_member(member_id)) with check (public.team_can_member(member_id));
create policy "admins: delete" on public.team_exits for delete to authenticated using ((select public.team_is_admin()));

commit;
