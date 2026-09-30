-- A student (or staff) invite skips the email when the login already has a password (e.g. a Top Out coach).
begin;

-- A student's invite, or a staff member's: whether their login already has a password (e.g. they coach on Top Out).
-- Then the page skips the email and just marks them invited, so they sign in with the password they have.
-- Coaches and admins only, and only for an email on the student or staff list.
create function public.login_has_password(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.is_coach() or public.is_admin())
    and (exists (select 1 from public.students where email = lower(trim(p_email)))
         or exists (select 1 from public.staff where email = lower(trim(p_email))))
    and exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email)) and coalesce(u.encrypted_password, '') <> '');
$$;

revoke execute on function public.login_has_password(text) from public, anon;
grant execute on function public.login_has_password(text) to authenticated;

commit;
