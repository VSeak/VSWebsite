-- A student can have several goals. The coach marks each one Achieved or
-- archives it. Students see their current and achieved goals, not archived ones.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)
-- Run this before the new site goes live: it moves students.goal into goals.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  status text not null default 'current' check (status in ('current', 'achieved', 'archived')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.goals (student_id);

alter table public.goals enable row level security;
grant select, insert, update, delete on public.goals to authenticated;

create policy "coach: everything" on public.goals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: own goals" on public.goals for select to authenticated
  using (student_id = public.my_student_id() and status <> 'archived');

-- Each student's old single goal becomes their first current goal.
insert into public.goals (student_id, body, created_at)
select id, left(trim(goal), 500), created_at from public.students where trim(goal) <> '';

alter table public.students drop column goal;
