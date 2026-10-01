-- Training Log: students log what they did for an exercise in their plan (one summary line a day per exercise),
-- and they and coaches see its history across every plan.
-- exercises.track: the fields students fill in when they log it (the default; plans copy it into each
-- exercise's JSON as "track", and the coach can change it per plan). Notes are always there.
-- exercise_logs.vals: the values, e.g. {"weight": 40, "unit": "lb", "edge": 20, "time": 10, "grip": "Half Crimp"}.
-- Logs are keyed by the exercise's name (exercise_key = lower(trim(name)), like exercises.name_key), so the
-- history follows the exercise from plan to plan.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.exercises add column track text[] not null default '{}'
  check (track <@ array['weight', 'edge', 'time', 'grip', 'sets', 'reps', 'grade', 'attempts', 'sent']);

create table public.exercise_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  exercise_key text not null check (length(exercise_key) between 1 and 200),
  exercise_name text not null check (length(trim(exercise_name)) between 1 and 200),
  logged_on date not null,
  vals jsonb not null default '{}' check (jsonb_typeof(vals) = 'object' and length(vals::text) <= 2000),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (student_id, exercise_key, logged_on)
);

-- True when s is one of the signed-in student's sessions and has an exercise named k (ignoring case and end spaces),
-- so students only log exercises that are in their own plans.
create function public.my_session_has(s uuid, k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions ss
    join public.plans p on p.id = ss.plan_id
    cross join lateral jsonb_array_elements(ss.exercises) e
    where ss.id = s and p.student_id = public.my_student_id() and lower(trim(e ->> 'name')) = k
  );
$$;

alter table public.exercise_logs enable row level security;
grant select, insert, update, delete on public.exercise_logs to authenticated;

-- Only the student adds, changes or deletes their logs. Every coach reads them (like plans).
create policy "student: own logs" on public.exercise_logs for select to authenticated
  using (student_id = (select public.my_student_id()));
create policy "student: add" on public.exercise_logs for insert to authenticated
  with check (student_id = (select public.my_student_id()) and public.my_session_has(session_id, exercise_key));
create policy "student: change" on public.exercise_logs for update to authenticated
  using (student_id = (select public.my_student_id()))
  with check (student_id = (select public.my_student_id()) and (session_id is null or public.my_session_has(session_id, exercise_key)));
create policy "student: delete" on public.exercise_logs for delete to authenticated
  using (student_id = (select public.my_student_id()));
create policy "coach: read" on public.exercise_logs for select to authenticated
  using ((select public.is_coach()));
