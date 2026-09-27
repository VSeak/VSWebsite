-- The owner: one staff member whose access nobody else can change.
-- Other admins can't change the owner's roles or email, or remove them. The owner
-- keeps the Admin role and can still change their own Coach role and name.
-- Only the SQL Editor can make someone the owner (or undo it).
-- Run once in Supabase: SQL Editor → New query → change the email at the bottom
-- to yours → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.staff add column owner boolean not null default false;
create unique index staff_one_owner on public.staff (owner) where owner;

create function public.protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The SQL Editor (no signed-in user) can do anything.
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
    if new.roles is distinct from old.roles and old.email <> lower(auth.jwt() ->> 'email') then
      raise exception 'Only the owner can change their own roles.';
    end if;
  end if;
  return new;
end;
$$;
create trigger protect_owner before insert or update or delete on public.staff
  for each row execute function public.protect_owner();

-- list_users() now says who the owner is (the return type changes, so drop it first).
drop function public.list_users();
create function public.list_users()
returns table (kind text, id uuid, first_name text, last_name text, name text, email text,
               roles text[], invited_at timestamptz, last_sign_in_at timestamptz, owner boolean)
language sql stable security definer set search_path = '' as $$
  select 'staff'::text, s.id, s.first_name, s.last_name, s.name, s.email, s.roles, s.invited_at, u.last_sign_in_at, s.owner
  from public.staff s left join auth.users u on lower(u.email) = s.email
  where public.is_admin()
  union all
  select 'student'::text, st.id, st.first_name, st.last_name, st.name, st.email, '{student}'::text[], st.invited_at, u.last_sign_in_at, false
  from public.students st left join auth.users u on u.id = st.user_id
  where public.is_admin();
$$;
revoke execute on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;

-- Make yourself the owner. Change this to the email you sign in with.
do $$
begin
  update public.staff set owner = true, roles = array(select distinct unnest(roles || '{admin}'))
  where email = lower('you@example.com');
  if not found then raise exception 'No staff member has that email. Change it and run again.'; end if;
end;
$$;
