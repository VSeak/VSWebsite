-- Purposes on the master exercise list (Mobility, Injury Prevention, ...), so coaches
-- can search and filter by what an exercise is for. Plans don't copy them, so
-- students never see them. The existing exercises start with none.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.exercises
  add column purposes text[] not null default '{}' check (cardinality(purposes) <= 12);
