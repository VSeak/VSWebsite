-- The purposes coaches pick from on the master exercise list, kept in their own
-- table so they can be added, renamed and deleted on the page. Renaming one
-- renames it on every exercise; deleting one takes it off every exercise.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create table public.exercise_purposes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  name_key text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);

create function public.sync_exercise_purpose() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.exercises set purposes = array_remove(purposes, old.name) where old.name = any(purposes);
    return old;
  end if;
  if new.name <> old.name then
    update public.exercises set purposes = array_replace(purposes, old.name, new.name) where old.name = any(purposes);
  end if;
  return new;
end;
$$;
create trigger sync_exercise_purpose after update of name or delete on public.exercise_purposes
  for each row execute function public.sync_exercise_purpose();

alter table public.exercise_purposes enable row level security;
grant select, insert, update, delete on public.exercise_purposes to authenticated;

create policy "staff: everything" on public.exercise_purposes for all to authenticated
  using (public.is_coach() or public.is_admin()) with check (public.is_coach() or public.is_admin());

-- Start with the usual purposes, plus any already typed onto an exercise.
insert into public.exercise_purposes (name)
select unnest(array['Mobility', 'Injury Prevention', 'Strength Training', 'Finger Strength', 'Power', 'Core',
  'Endurance', 'Technique', 'Warm-Up', 'Recovery'])
union
select distinct unnest(purposes) from public.exercises
on conflict do nothing;
