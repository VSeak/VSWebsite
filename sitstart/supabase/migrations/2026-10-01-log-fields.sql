-- Training Log: coaches add their own log fields (the Log Fields card on Exercises & Drills) beside the built-in ones.
-- A field is a number (a stepper, with an optional unit like "moves") or a pick from a few choices.
-- Exercises and plans list a field by its key (exercises.track, a plan exercise's "track"), and logs keep its value
-- under the same key (exercise_logs.vals), so renaming a field keeps its history. Deleting one takes it off every
-- exercise on the list (plans that have it just stop showing it).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create table public.log_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null unique default ('c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  label text not null check (length(trim(label)) between 1 and 30),
  label_key text generated always as (lower(trim(label))) stored unique,
  kind text not null check (kind in ('number', 'pick')),
  unit text not null default '' check (length(unit) <= 20),
  opts text[] not null default '{}' check (cardinality(opts) <= 12),
  created_at timestamptz not null default now(),
  check (kind = 'number' or cardinality(opts) >= 2)
);

-- exercises.track now takes custom keys too.
alter table public.exercises drop constraint exercises_track_check;
alter table public.exercises add constraint exercises_track_check check (cardinality(track) <= 30);

-- The key and kind never change (logs keep values under the key); deleting a field takes it off every exercise.
create function public.sync_log_field() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.exercises set track = array_remove(track, old.key) where old.key = any(track);
    return old;
  end if;
  new.key := old.key;
  new.kind := old.kind;
  return new;
end;
$$;
create trigger keep_log_field_key before update on public.log_fields
  for each row execute function public.sync_log_field();
create trigger sync_log_field after delete on public.log_fields
  for each row execute function public.sync_log_field();

alter table public.log_fields enable row level security;
grant select, insert, update, delete on public.log_fields to authenticated;

-- Everyone signed in reads them (students need them to log); coaches and admins change them.
create policy "everyone: read" on public.log_fields for select to authenticated using (true);
create policy "staff: change" on public.log_fields for insert to authenticated
  with check ((select public.is_coach()) or (select public.is_admin()));
create policy "staff: update" on public.log_fields for update to authenticated
  using ((select public.is_coach()) or (select public.is_admin())) with check ((select public.is_coach()) or (select public.is_admin()));
create policy "staff: delete" on public.log_fields for delete to authenticated
  using ((select public.is_coach()) or (select public.is_admin()));
