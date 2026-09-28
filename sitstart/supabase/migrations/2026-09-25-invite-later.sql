-- Add students by name first and invite them later.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.students alter column email drop not null;
alter table public.students add column invited_at timestamptz;

-- Students added before this change were all invited when they were added.
update public.students set invited_at = created_at where invited_at is null;
