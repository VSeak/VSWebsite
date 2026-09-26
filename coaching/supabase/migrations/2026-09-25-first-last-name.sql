-- Split a student's name into first_name and last_name, so a first name with a
-- space in it ("Mary Ann") is greeted correctly. name stays, built from the two.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.students add column first_name text;
alter table public.students add column last_name text not null default '';

-- Existing students: first word is the first name, the rest the last name.
-- Check these on each student's page afterwards.
update public.students set
  first_name = split_part(trim(name), ' ', 1),
  last_name  = trim(substr(trim(name), length(split_part(trim(name), ' ', 1)) + 1));

alter table public.students alter column first_name set not null;
alter table public.students drop column name;
alter table public.students add column name text
  generated always as (trim(first_name || ' ' || last_name)) stored;
