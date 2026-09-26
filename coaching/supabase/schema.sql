-- Bouldering coaching site: tables, access rules and the sign-up gate.
-- Run once in Supabase: SQL Editor → New query → paste all of this → change
-- the email in step 6 to yours → Run.

-- 1. Tables ------------------------------------------------------------------

-- Emails that get coach (admin) access.
create table public.admins (
  email text primary key check (email = lower(email))
);

-- One row per student. email can wait until the coach is ready to invite them.
-- invited_at is set when an invite goes out; user_id the first time they sign in.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  email text unique check (email = lower(email)),
  goal text not null default '',
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
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.plans (student_id);

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

-- 2. Helpers (security definer so the rules below don't loop on themselves) --

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins where email = lower(auth.jwt() ->> 'email')
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
  if not public.is_admin() then
    raise exception 'Only the coach can delete students.';
  end if;
  delete from public.students where id = p_id returning * into s;
  if s.id is null then return; end if;
  -- Their login: the claimed one, or one made by an invite they never opened.
  delete from auth.users u
  where (u.id = s.user_id or (s.email is not null and lower(u.email) = s.email))
    and not exists (select 1 from public.admins a where a.email = lower(u.email));
end;
$$;

-- 3. Access rules -------------------------------------------------------------
-- The coach can do everything. A student can read their own row, plans and
-- sessions, read notes on their sessions, and add or delete their own notes.
-- admins has no rules at all, so nobody can read or change it from the site.

alter table public.admins   enable row level security;
alter table public.students enable row level security;
alter table public.plans    enable row level security;
alter table public.sessions enable row level security;
alter table public.notes    enable row level security;

grant select, insert, update, delete
  on public.students, public.plans, public.sessions, public.notes
  to authenticated;

create policy "coach: everything" on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: own row" on public.students for select to authenticated
  using (user_id = auth.uid());

create policy "coach: everything" on public.plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: own plans" on public.plans for select to authenticated
  using (student_id = public.my_student_id());

create policy "coach: everything" on public.sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: own sessions" on public.sessions for select to authenticated
  using (public.owns_plan(plan_id));

create policy "coach: everything" on public.notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "student: read notes" on public.notes for select to authenticated
  using (public.owns_session(session_id));
create policy "student: add notes" on public.notes for insert to authenticated
  with check (author_id = auth.uid() and not from_coach and public.owns_session(session_id));
create policy "student: delete own notes" on public.notes for delete to authenticated
  using (author_id = auth.uid() and not from_coach);

-- 4. Sign-up gate ---------------------------------------------------------------
-- Only emails on the student list (or the admins list) can create an account.
-- Anyone else gets an error, so an open sign-up can't be abused.

create function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.admins where email = lower(new.email)) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

create trigger gate_signup before insert on auth.users
  for each row execute function public.gate_signup();

-- 5. Nothing here needs the anonymous (signed-out) role.
revoke execute on function public.claim_student() from anon;
revoke execute on function public.delete_student(uuid) from public, anon;
grant execute on function public.delete_student(uuid) to authenticated;

-- 6. Make yourself the coach. Change this to the email you'll sign in with.
insert into public.admins (email) values (lower('you@example.com'));
