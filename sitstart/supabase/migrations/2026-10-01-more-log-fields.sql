-- Training Log: five more standard log fields (Duration in minutes, Problems, Board Angle, Hand, Effort as RPE 1–10),
-- and Pinch, Sloper and Pocket added to Grip's choices. How each one works is in the page (LOG_STANDARD).
-- Run once in Supabase after 2026-10-01-standard-log-fields.sql: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.log_fields drop constraint log_fields_standard_key;
alter table public.log_fields add constraint log_fields_standard_key check (kind <> 'standard'
  or key in ('weight', 'time', 'duration', 'sets', 'reps', 'grade', 'attempts', 'problems', 'edge', 'angle', 'grip', 'hand', 'sent', 'effort'));

insert into public.log_fields (key, label, kind) values
  ('duration', 'Duration', 'standard'), ('problems', 'Problems', 'standard'), ('angle', 'Board Angle', 'standard'),
  ('hand', 'Hand', 'standard'), ('effort', 'Effort', 'standard')
on conflict do nothing;

-- Grip's new choices, unless a coach already has them (or Grip was deleted).
update public.log_fields
  set opts = opts || array(select o from unnest(array['Pinch', 'Sloper', 'Pocket']) o
    where lower(o) <> all (select lower(x) from unnest(opts) x))
  where key = 'grip' and cardinality(opts) <= 9;
