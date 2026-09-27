-- Staff who leave are deactivated instead of deleted, so they can come back later with their history intact.
-- A deactivated staff member keeps their row and login, but the login is banned so they can't sign in, and
-- my_roles(), is_coach() and is_admin() ignore them anyway. Their students are left with no coach. Delete Staff only works
-- once someone is deactivated, and Delete Student only once a student's coaching has ended.
-- Also: a plan note now outlives its author's login (it was deleted with it).

alter table public.staff add column deactivated_at timestamptz;

-- Plan notes: removing a login used to delete every note that person wrote.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.notes'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.notes drop constraint %I', c);
  end loop;
end;
$$;
alter table public.notes alter column author_id drop not null;
alter table public.notes add constraint notes_author_id_fkey
  foreign key (author_id) references auth.users (id) on delete set null;

-- Deactivated staff have no roles.
create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select roles from public.staff where email = lower(auth.jwt() ->> 'email') and deactivated_at is null;
$$;

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'coach' = any (roles) and deactivated_at is null
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles) and deactivated_at is null
  );
$$;

create or replace function public.stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email')
    and ('coach' = any (roles) or 'admin' = any (roles)) and deactivated_at is null;
  if sender is null then raise exception 'Only a coach or an admin can send sign-in links.'; end if;
  update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email_changed_to')
    || jsonb_build_object('sent_by', sender)
  where lower(email) = lower(trim(p_email));
end;
$$;

create or replace function public.prepare_email_change(p_id uuid, p_email text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_email text := lower(trim(coalesce(p_email, '')));
  sender text;
  uid uuid;
  old_email text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles)
    and deactivated_at is null;
  if sender is null then raise exception 'Only an admin can change a student''s email.'; end if;
  if new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email.'; end if;
  select user_id into uid from public.students where id = p_id;
  if not found then raise exception 'That student no longer exists.'; end if;
  select email into old_email from auth.users where id = uid;
  if old_email is null then raise exception 'This student hasn''t signed in yet. Change the email in the invite form.'; end if;
  if lower(old_email) = new_email then raise exception 'That''s already their email.'; end if;
  if exists (select 1 from public.staff where email = new_email) then
    raise exception 'A staff member already has that email.';
  end if;
  if exists (select 1 from public.students where email = new_email and id <> p_id) then
    raise exception 'Another student already has that email.';
  end if;
  if exists (select 1 from auth.users where lower(email) = new_email) then
    raise exception 'Another login already uses that email.';
  end if;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('sent_by', sender, 'email_changed_to', new_email)
  where id = uid;
  return old_email;
end;
$$;

-- There must always be an active admin.
create or replace function public.keep_an_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where 'admin' = any (roles) and deactivated_at is null) then
    raise exception 'There must always be at least one admin.';
  end if;
  return null;
end;
$$;

-- The owner can't be deactivated either.
create or replace function public.protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.jwt() ->> 'email' is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.owner then raise exception 'Only the SQL Editor can make someone the owner.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.owner then raise exception 'The owner can''t be removed.'; end if;
    return old;
  end if;
  if new.owner is distinct from old.owner then
    raise exception 'Only the SQL Editor can change who the owner is.';
  end if;
  if old.owner then
    if new.email <> old.email then raise exception 'The owner''s email can''t be changed here.'; end if;
    if not ('admin' = any (new.roles)) then raise exception 'The owner always keeps the Admin role.'; end if;
    if new.deactivated_at is not null then raise exception 'The owner can''t be deactivated.'; end if;
    if new.roles is distinct from old.roles and old.email <> lower(auth.jwt() ->> 'email') then
      raise exception 'Only the owner can change their own roles.';
    end if;
  end if;
  return new;
end;
$$;

-- Deactivating someone (not yourself) leaves their students with no coach, bans their login so they can't sign in
-- (the page shows "Account Deactivated"), and ends any sign-in they have open. A login that is also a student's
-- isn't banned: they keep their student access. Reactivating lifts the ban (their students don't come back).
create function public.staff_deactivated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.deactivated_at is null) = (old.deactivated_at is null) then return null; end if;
  if new.deactivated_at is null then
    update auth.users set banned_until = null where lower(email) = new.email;
    return null;
  end if;
  if new.email = lower(auth.jwt() ->> 'email') then raise exception 'You can''t deactivate yourself.'; end if;
  update public.students set coach_id = null where coach_id = new.id;
  update auth.users u set banned_until = '2999-12-31'
  where lower(u.email) = new.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = new.email);
  delete from auth.sessions s using auth.users u
  where s.user_id = u.id and u.banned_until is not null and lower(u.email) = new.email;
  return null;
end;
$$;
create trigger staff_deactivated after update of deactivated_at on public.staff
  for each row execute function public.staff_deactivated();

-- A deactivated staff member with no login yet can't make one (unless they're also a student).
create or replace function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.staff where email = lower(new.email) and deactivated_at is null) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

-- A student's coach must be an active staff member with the Coach role.
create or replace function public.check_student_coach() returns trigger
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
    select 1 from public.staff where id = new.coach_id and 'coach' = any (roles) and deactivated_at is null
  ) then
    raise exception 'Pick an active staff member with the Coach role.';
  end if;
  return new;
end;
$$;

-- Delete Staff: only once they're deactivated.
create or replace function public.delete_staff(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.staff;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete staff.';
  end if;
  if exists (select 1 from public.staff where id = p_id and deactivated_at is null) then
    raise exception 'Deactivate them before deleting them.';
  end if;
  update public.student_coaches set ended_at = now() where staff_id = p_id and ended_at is null;
  delete from public.staff where id = p_id returning * into s;
  if s.id is null then return; end if;
  delete from auth.users u
  where lower(u.email) = s.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = s.email);
end;
$$;

-- Delete Student: only once their coaching has ended.
create or replace function public.delete_student(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.students;
begin
  if not (public.is_coach() or public.is_admin()) then
    raise exception 'Only a coach or an admin can delete students.';
  end if;
  if exists (select 1 from public.students where id = p_id and training_ended_at is null) then
    raise exception 'End their coaching before deleting them.';
  end if;
  delete from public.students where id = p_id returning * into s;
  if s.id is null then return; end if;
  delete from auth.users u
  where (u.id = s.user_id or (s.email is not null and lower(u.email) = s.email))
    and not exists (select 1 from public.staff a where a.email = lower(u.email));
end;
$$;

-- list_users() gains deactivated_at (a new column means dropping it first).
drop function public.list_users();
create function public.list_users()
returns table (kind text, id uuid, first_name text, last_name text, name text, pronouns text, email text,
               roles text[], invited_at timestamptz, last_sign_in_at timestamptz, owner boolean, deactivated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'staff'::text, s.id, s.first_name, s.last_name, s.name, s.pronouns, s.email, s.roles, s.invited_at, u.last_sign_in_at, s.owner,
         s.deactivated_at
  from public.staff s left join auth.users u on lower(u.email) = s.email
  where public.is_admin()
  union all
  select 'student'::text, st.id, st.first_name, st.last_name, st.name, st.pronouns, st.email, '{student}'::text[], st.invited_at,
         u.last_sign_in_at, false, null::timestamptz
  from public.students st left join auth.users u on u.id = st.user_id
  where public.is_admin();
$$;
revoke execute on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;
