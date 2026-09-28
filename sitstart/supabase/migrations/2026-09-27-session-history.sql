-- Session History: past training sessions, shown in the Sessions card on the student page
-- (under Next Session) and on the student's own page.
-- The page adds a row when a coach or admin updates or clears a Next Session that has ended
-- (it knows the local time; the database doesn't), and coaches can add or delete rows by hand.
-- One row per student, day and start time, so logging the same session twice does nothing.
-- Coaches and admins can do everything (like the Next Session); a student can read their own.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create table public.session_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  location text not null check (length(trim(location)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (student_id, session_date, start_time)
);

alter table public.session_history enable row level security;
grant select, insert, update, delete on public.session_history to authenticated;

create policy "staff: everything" on public.session_history for all to authenticated
  using (public.is_coach() or public.is_admin()) with check (public.is_coach() or public.is_admin());
create policy "student: own history" on public.session_history for select to authenticated
  using (student_id = public.my_student_id());
