-- Staff with roles. Replaces public.admins with public.staff.
-- Roles are separate and a person can have several:
--   coach: manages students, plans, goals and notes (what the coach could do before).
--   admin: sees and edits every user on the Users page (staff and students).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)
-- Run this before the new site goes live: the page calls my_roles() and list_users().

-- 1. The staff table. Everyone in admins becomes an admin and a coach. ---------

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

insert into public.staff (email, roles) select email, '{admin,coach}' from public.admins;

-- 2. Who is signed in ------------------------------------------------------------

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

-- 3. Coach rules now check is_coach(), before is_admin() narrows to admins ------

drop policy "coach: everything" on public.students;
drop policy "coach: everything" on public.plans;
drop policy "coach: everything" on public.sessions;
drop policy "coach: everything" on public.notes;
drop policy "coach: everything" on public.goals;

create policy "coach: everything" on public.students for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "coach: everything" on public.plans for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "coach: everything" on public.sessions for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "coach: everything" on public.notes for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy "coach: everything" on public.goals for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles)
  );
$$;

-- Admins can edit students' details and invites too (not their plans or goals).
create policy "admin: students" on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.delete_student(p_id uuid) returns void
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

create or replace function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.staff where email = lower(new.email)) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

-- 4. Staff rules: only admins can read or change the staff list. ----------------

alter table public.staff enable row level security;
grant select, insert, update, delete on public.staff to authenticated;
create policy "admin: everything" on public.staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

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

-- 5. The Users page ------------------------------------------------------------

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

revoke execute on function public.list_users() from public, anon;
revoke execute on function public.delete_staff(uuid) from public, anon;
grant execute on function public.list_users(), public.delete_staff(uuid) to authenticated;

-- 6. The old admins list is now in staff. ---------------------------------------

drop table public.admins;
