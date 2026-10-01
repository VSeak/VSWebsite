-- Coaching Sessions: what a coach plans for a student's next session and the notes they take during it. Coaches only:
-- students and admin-only staff can't see them. While open it follows the student's Next Session (the page keeps its
-- date, times and place in step until that time has passed). Submitting it (submit_coaching_session) puts its notes into
-- one Coach Note for that day, logs the session in Session History and makes it a past coaching session, read only for good.
-- A student has at most one open coaching session.
-- Coach Notes can now be longer (30,000 characters), since a submitted session's note holds every exercise's notes.
-- Run once in Supabase after 2026-10-01-more-log-fields.sql: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.coach_notes drop constraint coach_notes_body_check;
alter table public.coach_notes add constraint coach_notes_body_check check (length(trim(body)) between 1 and 30000);

-- exercises: [{id, name, sets, reps, rest, plan_notes, notes}]. plan_notes: the notes copied from the plan or the
-- exercise list (the student's instructions), shown but never put in the Coach Note; notes: the coach's notes.
create table public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_date date,
  start_time time,
  end_time time,
  location text check (length(location) <= 200),
  exercises jsonb not null default '[]' check (jsonb_typeof(exercises) = 'array' and length(exercises::text) <= 60000),
  notes text not null default '' check (length(notes) <= 4000),
  submitted_at timestamptz,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  author_name text not null default '',   -- stamp_coaching_session, kept if the coach is removed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The day, times and place are all set (the end after the start), or none (no next session to follow yet).
  constraint coaching_session_time check (
    (session_date is null and start_time is null and end_time is null and location is null)
    or (session_date is not null and start_time is not null and end_time > start_time and length(trim(location)) > 0)),
  constraint coaching_session_submitted check (submitted_at is null or session_date is not null)
);
create unique index coaching_sessions_one_open on public.coaching_sessions (student_id) where submitted_at is null;
create index on public.coaching_sessions (student_id);

-- Who made it is fixed; a submitted one never changes.
create function public.stamp_coaching_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.submitted_at is not null then raise exception 'A submitted coaching session can''t be changed.'; end if;
    new.student_id := old.student_id;
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
  else
    new.author_id := auth.uid();
    new.author_name := coalesce((select name from public.staff where email = lower(auth.jwt() ->> 'email')), '');
    new.submitted_at := null;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger stamp_coaching_session before insert or update on public.coaching_sessions
  for each row execute function public.stamp_coaching_session();

-- Every coach reads them (not about themselves); only the student's coach adds, changes or deletes an open one.
alter table public.coaching_sessions enable row level security;
grant select, insert, update, delete on public.coaching_sessions to authenticated;
create policy "coach: read" on public.coaching_sessions for select to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id));
create policy "coach: add" on public.coaching_sessions for insert to authenticated
  with check (public.can_coach(student_id) and submitted_at is null);
create policy "coach: change" on public.coaching_sessions for update to authenticated
  using (public.can_coach(student_id) and submitted_at is null) with check (public.can_coach(student_id));
create policy "coach: delete" on public.coaching_sessions for delete to authenticated
  using (public.can_coach(student_id) and submitted_at is null);

-- Submit: the Coach Note (p_note, written by the page), the Session History row and submitted_at, all or nothing.
-- Runs as the caller, so the rules above still decide. The page only offers it once the session has ended (local time).
create function public.submit_coaching_session(p_id uuid, p_note text) returns void
language plpgsql set search_path = '' as $$
declare
  c public.coaching_sessions;
begin
  select * into c from public.coaching_sessions where id = p_id and submitted_at is null for update;
  if not found then raise exception 'This coaching session was already submitted or deleted.'; end if;
  if c.session_date is null then raise exception 'This coaching session has no date. Set the next session first.'; end if;
  insert into public.coach_notes (student_id, session_date, body) values (c.student_id, c.session_date, p_note);
  insert into public.session_history (student_id, session_date, start_time, end_time, location)
    values (c.student_id, c.session_date, c.start_time, c.end_time, c.location)
    on conflict (student_id, session_date, start_time) do nothing;
  update public.coaching_sessions set submitted_at = now() where id = p_id;
end;
$$;
revoke execute on function public.submit_coaching_session(uuid, text) from public, anon;
grant execute on function public.submit_coaching_session(uuid, text) to authenticated;
