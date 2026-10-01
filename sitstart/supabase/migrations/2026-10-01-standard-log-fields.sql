-- Training Log: the standard log fields (Added Weight, Time, Sets Done, Reps, Grade, Attempts, Edge, Grip, Sent)
-- become log_fields rows too (kind 'standard', key = the field the Log sheet knows), so coaches can rename or delete
-- them like their own, and change Grip's choices. How each one works (steppers, lb/kg, grades, edge sizes) stays in
-- the page. Names stay unique ignoring case and spaces (label_key), across every field.
-- Run once in Supabase after 2026-10-01-log-fields.sql: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.log_fields'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.log_fields drop constraint %I', c);
  end loop;
end;
$$;
alter table public.log_fields
  add constraint log_fields_kind_check check (kind in ('number', 'pick', 'standard')),
  add constraint log_fields_pick_opts check (kind <> 'pick' or cardinality(opts) >= 2),
  add constraint log_fields_standard_key check (kind <> 'standard'
    or key in ('weight', 'time', 'sets', 'reps', 'grade', 'attempts', 'edge', 'grip', 'sent'));

insert into public.log_fields (key, label, kind, opts) values
  ('weight', 'Added Weight', 'standard', '{}'), ('time', 'Time', 'standard', '{}'), ('sets', 'Sets Done', 'standard', '{}'),
  ('reps', 'Reps', 'standard', '{}'), ('grade', 'Grade', 'standard', '{}'), ('attempts', 'Attempts', 'standard', '{}'),
  ('edge', 'Edge', 'standard', '{}'), ('grip', 'Grip', 'standard', '{Half Crimp,Open Hand,Full Crimp,3 Finger Drag}'),
  ('sent', 'Sent', 'standard', '{}')
on conflict do nothing;
