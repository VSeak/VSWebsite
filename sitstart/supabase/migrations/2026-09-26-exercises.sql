-- The master exercise list. Coaches and admins see and edit it; students can't
-- see it at all. Picking an exercise in a plan copies its sets, reps, rest and
-- notes into the plan, and saving a plan adds any exercise that isn't listed yet.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

-- name_key makes names unique ignoring case and spaces at the ends.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  name_key text generated always as (lower(trim(name))) stored unique,
  sets text not null default '',
  reps text not null default '',
  rest text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.exercises enable row level security;
grant select, insert, update, delete on public.exercises to authenticated;

create policy "staff: everything" on public.exercises for all to authenticated
  using (public.is_coach() or public.is_admin()) with check (public.is_coach() or public.is_admin());

-- Start the list with every exercise already in a plan, using the values from
-- the most recently updated plan that has it.
insert into public.exercises (name, sets, reps, rest, notes)
select distinct on (lower(trim(x ->> 'name')))
  left(trim(x ->> 'name'), 200), coalesce(x ->> 'sets', ''), coalesce(x ->> 'reps', ''),
  coalesce(x ->> 'rest', ''), coalesce(x ->> 'notes', '')
from public.sessions s
join public.plans p on p.id = s.plan_id
cross join jsonb_array_elements(s.exercises) x
where trim(coalesce(x ->> 'name', '')) <> ''
order by lower(trim(x ->> 'name')), p.updated_at desc
on conflict do nothing;
