-- Each student's next training session: date, start and end time, location.
-- Coaches and admins set it on the student's page; the student sees it on theirs.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)
-- No new policies: coaches and admins can already update students, and a
-- student can only read their own row.

alter table public.students
  add column next_date date,
  add column next_start time,
  add column next_end time,
  add column next_location text check (length(next_location) <= 200),
  add constraint next_session_whole check (
    (next_date is null and next_start is null and next_end is null and next_location is null)
    or (next_date is not null and next_start is not null and next_end > next_start
        and length(trim(next_location)) > 0));
