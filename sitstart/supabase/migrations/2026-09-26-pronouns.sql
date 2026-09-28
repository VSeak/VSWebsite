-- Preferred pronouns for staff and students (e.g. she/her), shown by their name and used in the page's text about them.
-- Coaches and admins set them on the student and user pages. Students change only their own pronouns
-- through update_my_pronouns(), since they can only read their row (their name stays the coach's to change).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.staff add column pronouns text not null default '' check (length(pronouns) <= 40);
alter table public.students add column pronouns text not null default '' check (length(pronouns) <= 40);

-- list_users() gains pronouns, so it has to be dropped and made again.
drop function public.list_users();
create function public.list_users()
returns table (kind text, id uuid, first_name text, last_name text, name text, pronouns text, email text,
               roles text[], invited_at timestamptz, last_sign_in_at timestamptz, owner boolean)
language sql stable security definer set search_path = '' as $$
  select 'staff'::text, s.id, s.first_name, s.last_name, s.name, s.pronouns, s.email, s.roles, s.invited_at, u.last_sign_in_at, s.owner
  from public.staff s left join auth.users u on lower(u.email) = s.email
  where public.is_admin()
  union all
  select 'student'::text, st.id, st.first_name, st.last_name, st.name, st.pronouns, st.email, '{student}'::text[], st.invited_at, u.last_sign_in_at, false
  from public.students st left join auth.users u on u.id = st.user_id
  where public.is_admin();
$$;

-- A signed-in student changes their own pronouns (nothing else on their row: coaches and admins keep their name,
-- so the coach always knows who they are).
create function public.update_my_pronouns(p_pronouns text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.students set pronouns = trim(coalesce(p_pronouns, ''))
  where user_id = auth.uid() and auth.uid() is not null;
  if not found then raise exception 'Only a signed-in student can change their pronouns here.'; end if;
end;
$$;

revoke execute on function public.list_users(), public.update_my_pronouns(text) from public, anon;
grant execute on function public.list_users(), public.update_my_pronouns(text) to authenticated;
