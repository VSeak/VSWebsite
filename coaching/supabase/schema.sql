-- Bouldering coaching site: tables, access rules and the sign-up gate.
-- Run once in Supabase: SQL Editor → New query → paste all of this → change
-- the email in step 7 to yours → Run.

-- 1. Tables ------------------------------------------------------------------

-- Staff sign in by email. Roles are separate and a person can have several:
-- coach manages students, plans, goals and notes; admin sees and edits every
-- user on the Users page (staff and students).
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  first_name text not null default '',
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  roles text[] not null default '{coach}'
    check (cardinality(roles) > 0 and roles <@ array['admin', 'coach']),
  invited_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per student. email can wait until the coach is ready to invite them.
-- invited_at is set when an invite goes out; user_id the first time they sign in.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  email text unique check (email = lower(email)),
  invited_at timestamptz,
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  title text not null,
  overview text not null default '',
  start_date date,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.plans (student_id);

-- At most one current plan per student: making a plan current turns their
-- other current plan into a past plan. No current plan is fine.
create function public.one_current_plan() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active then
    update public.plans set active = false
    where student_id = new.student_id and active and id <> new.id;
  end if;
  return new;
end;
$$;
create trigger one_current_plan before insert or update of active, student_id on public.plans
  for each row execute function public.one_current_plan();
create unique index plans_one_current on public.plans (student_id) where active;

-- exercises: [{name, sets, reps, rest, notes}]
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  week int not null default 1 check (week >= 1),
  position int not null default 0,
  title text not null default '',
  details text not null default '',
  exercises jsonb not null default '[]'
);
create index on public.sessions (plan_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_coach boolean not null default false,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on public.notes (session_id);

-- The coach marks a goal achieved (done_at = when) or archives it.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  status text not null default 'current' check (status in ('current', 'achieved', 'archived')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.goals (student_id);

-- The master exercise list: defaults a plan copies when the coach picks an
-- exercise. Plans keep their own copy, so editing either never changes the other.
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

-- 2. Helpers (security definer so the rules below don't loop on themselves) --

-- The signed-in person's staff roles, e.g. {admin,coach}, or null for a student.
create function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select roles from public.staff where email = lower(auth.jwt() ->> 'email');
$$;

create function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'coach' = any (roles)
  );
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles)
  );
$$;

create function public.my_student_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.students where user_id = auth.uid();
$$;

create function public.owns_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans
    where id = p and student_id = public.my_student_id()
  );
$$;

create function public.owns_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions ss
    join public.plans p on p.id = ss.plan_id
    where ss.id = s and p.student_id = public.my_student_id()
  );
$$;

-- Called by the site after sign-in: links the account to its student row.
create function public.claim_student() returns void
language sql volatile security definer set search_path = '' as $$
  update public.students set user_id = auth.uid()
  where email = lower(auth.jwt() ->> 'email')
    and user_id is null
    and auth.uid() is not null
    and not exists (select 1 from public.students where user_id = auth.uid());
$$;

-- Called by the coach's Delete Student button: removes the student and their
-- login (never a coach's), so re-adding the same email starts fresh.
create function public.delete_student(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.students;
begin
  if not (public.is_coach() or public.is_admin()) then
    raise exception 'Only a coach or an admin can delete students.';
  end if;
  delete from public.students where id = p_id returning * into s;
  if s.id is null then return; end if;
  -- Their login: the claimed one, or one made by an invite they never opened.
  delete from auth.users u
  where (u.id = s.user_id or (s.email is not null and lower(u.email) = s.email))
    and not exists (select 1 from public.staff a where a.email = lower(u.email));
end;
$$;

-- 3. Access rules -------------------------------------------------------------
-- Coaches can do everything with students, plans, sessions, notes and goals.
-- Admins can read and change the staff list and students (not plans or goals).
-- A student can read their own row, plans and sessions, read their current and
-- achieved goals (not archived ones), read notes on their sessions, and add or
-- delete their own notes.
-- Coaches and admins can do everything with the master exercise list. Students
-- can't see it at all.

alter table public.staff    enable row level security;
alter table public.students enable row level security;
alter table public.plans    enable row level security;
alter table public.sessions enable row level security;
alter table public.notes    enable row level security;
alter table public.goals    enable row level security;
alter table public.exercises enable row level security;

grant select, insert, update, delete
  on public.staff, public.students, public.plans, public.sessions, public.notes, public.goals, public.exercises
  to authenticated;

create policy "admin: everything" on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "staff: own row" on public.staff for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

create policy "coach: everything" on public.students for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "admin: students" on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: own row" on public.students for select to authenticated
  using (user_id = auth.uid());

create policy "coach: everything" on public.plans for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "student: own plans" on public.plans for select to authenticated
  using (student_id = public.my_student_id());

create policy "coach: everything" on public.sessions for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "student: own sessions" on public.sessions for select to authenticated
  using (public.owns_plan(plan_id));

create policy "coach: everything" on public.notes for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "student: read notes" on public.notes for select to authenticated
  using (public.owns_session(session_id));
create policy "student: add notes" on public.notes for insert to authenticated
  with check (author_id = auth.uid() and not from_coach and public.owns_session(session_id));
create policy "student: delete own notes" on public.notes for delete to authenticated
  using (author_id = auth.uid() and not from_coach);

create policy "coach: everything" on public.goals for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "student: own goals" on public.goals for select to authenticated
  using (student_id = public.my_student_id() and status <> 'archived');

create policy "staff: everything" on public.exercises for all to authenticated
  using (public.is_coach() or public.is_admin()) with check (public.is_coach() or public.is_admin());

-- 4. Sign-up gate ---------------------------------------------------------------
-- Only emails on the student list (or the staff list) can create an account.
-- Anyone else gets an error, so an open sign-up can't be abused.

create function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.staff where email = lower(new.email)) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

create trigger gate_signup before insert on auth.users
  for each row execute function public.gate_signup();

-- 5. Admins ------------------------------------------------------------------------

-- There must always be an admin, so nobody can lock everyone out of the Users page.
create function public.keep_an_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where 'admin' = any (roles)) then
    raise exception 'There must always be at least one admin.';
  end if;
  return null;
end;
$$;
create trigger keep_an_admin after update or delete on public.staff
  for each statement execute function public.keep_an_admin();

-- Everyone, staff and students, for admins only (others get no rows).
-- last_sign_in_at comes from their login, so the page can tell who is active.
create function public.list_users()
returns table (kind text, id uuid, first_name text, last_name text, name text, email text,
               roles text[], invited_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'staff'::text, s.id, s.first_name, s.last_name, s.name, s.email, s.roles, s.invited_at, u.last_sign_in_at
  from public.staff s left join auth.users u on lower(u.email) = s.email
  where public.is_admin()
  union all
  select 'student'::text, st.id, st.first_name, st.last_name, st.name, st.email, '{student}'::text[], st.invited_at, u.last_sign_in_at
  from public.students st left join auth.users u on u.id = st.user_id
  where public.is_admin();
$$;

-- Removes a staff member and their login (kept if they are also a student).
create function public.delete_staff(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.staff;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove staff.';
  end if;
  delete from public.staff where id = p_id returning * into s;
  if s.id is null then return; end if;
  delete from auth.users u
  where lower(u.email) = s.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = s.email);
end;
$$;

-- A student can be invited once they have a saved plan (one with a title) and a goal.
-- Security definer so admins, who can't read plans or goals, can check it too.
create function public.student_ready(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.is_coach() or public.is_admin())
    and exists (select 1 from public.plans where student_id = p_id and title <> '')
    and exists (select 1 from public.goals where student_id = p_id);
$$;

-- 6. Nothing here needs the anonymous (signed-out) role.
revoke execute on function public.claim_student() from anon;
revoke execute on function public.delete_student(uuid) from public, anon;
revoke execute on function public.list_users() from public, anon;
revoke execute on function public.delete_staff(uuid) from public, anon;
revoke execute on function public.student_ready(uuid) from public, anon;
grant execute on function public.delete_student(uuid), public.list_users(), public.delete_staff(uuid), public.student_ready(uuid) to authenticated;

-- 7. Make yourself an admin and a coach. Change this to the email you'll sign in with.
insert into public.staff (email, roles) values (lower('you@example.com'), '{admin,coach}');
