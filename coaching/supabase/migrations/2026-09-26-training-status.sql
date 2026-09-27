-- Whether a student is still training: null = active, a time = when they finished.
-- Coaches and admins mark it on the student's page; the Students list shows Active or Inactive.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)
-- No new policies: coaches and admins can already update students, and a
-- student can only read their own row.

alter table public.students add column training_ended_at timestamptz;
