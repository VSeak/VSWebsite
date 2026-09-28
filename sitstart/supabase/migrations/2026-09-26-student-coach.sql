-- Each student has a coach: the coach who added them, and an admin can change it.
-- student_coaches keeps every coach they've had, one row per coach, so students
-- see their current coach and their past coaches (a returning coach isn't listed twice).
-- Existing students start with no coach; an admin can assign one on the Users page.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.students
  add column coach_id uuid references public.staff (id) on delete set null;

-- Every coach a student has had: one row per coach, so a coach who comes back
-- reuses their row (started_at resets, ended_at clears) and never shows twice.
-- coach_name is kept so a past coach's name survives their staff row being removed.
-- No policies: everyone reads it through coaches_of(), and only the triggers write it.
create table public.student_coaches (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete set null,
  coach_name text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (student_id, staff_id)
);
alter table public.student_coaches enable row level security;

create function public.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.staff where email = lower(auth.jwt() ->> 'email');
$$;

-- A new student gets the coach who added them. After that only an admin can
-- change the coach (the SQL Editor, with no signed-in user, can too).
create function public.check_student_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.coach_id is null and public.is_coach() then
    new.coach_id := public.my_staff_id();
  end if;
  if new.coach_id is not distinct from (case when tg_op = 'UPDATE' then old.coach_id end) then
    return new;
  end if;
  if auth.uid() is not null and not public.is_admin()
     and not (tg_op = 'INSERT' and new.coach_id = public.my_staff_id()) then
    raise exception 'Only an admin can change a student''s coach.';
  end if;
  if new.coach_id is not null and not exists (
    select 1 from public.staff where id = new.coach_id and 'coach' = any (roles)
  ) then
    raise exception 'Pick someone with the Coach role.';
  end if;
  return new;
end;
$$;
create trigger check_student_coach before insert or update of coach_id on public.students
  for each row execute function public.check_student_coach();

-- Keeps student_coaches in step: the old coach's row gets an end date, the new
-- coach gets a row (or their old one back).
create function public.log_student_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.coach_id is not distinct from old.coach_id then return null; end if;
    update public.student_coaches set ended_at = now()
    where student_id = new.id and staff_id = old.coach_id and ended_at is null;
  end if;
  if new.coach_id is not null then
    insert into public.student_coaches (student_id, staff_id, coach_name)
    select new.id, s.id, coalesce(nullif(s.name, ''), s.email) from public.staff s where s.id = new.coach_id
    on conflict (student_id, staff_id) do update
      set coach_name = excluded.coach_name, started_at = now(), ended_at = null;
  end if;
  return null;
end;
$$;
create trigger log_student_coach after insert or update of coach_id on public.students
  for each row execute function public.log_student_coach();

-- A student's current coach and past coaches, newest first. For staff, or the
-- student themselves (students can't read the staff table).
create function public.coaches_of(p_id uuid)
returns table (staff_id uuid, name text, is_current boolean, started_at timestamptz, ended_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.staff_id, coalesce(nullif(s.name, ''), nullif(c.coach_name, ''), s.email),
         c.staff_id is not null and c.staff_id = st.coach_id, c.started_at, c.ended_at
  from public.student_coaches c
  join public.students st on st.id = c.student_id
  left join public.staff s on s.id = c.staff_id
  where c.student_id = p_id
    and (public.is_coach() or public.is_admin() or p_id = public.my_student_id())
  order by 3 desc, coalesce(c.ended_at, c.started_at) desc;
$$;

-- Removing a staff member ends their time as coach; their students are left with no coach.
create or replace function public.delete_staff(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.staff;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove staff.';
  end if;
  update public.student_coaches set ended_at = now() where staff_id = p_id and ended_at is null;
  delete from public.staff where id = p_id returning * into s;
  if s.id is null then return; end if;
  delete from auth.users u
  where lower(u.email) = s.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = s.email);
end;
$$;

revoke execute on function public.coaches_of(uuid), public.my_staff_id() from public, anon;
grant execute on function public.coaches_of(uuid), public.my_staff_id() to authenticated;
