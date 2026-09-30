-- Add User (staff): an email Top Out already has fills in the name and pronouns, and one whose login already has a
-- password skips the invite. Adds person_in_other_app() (empty until Top Out's schema replaces it) and staff_lookup().
-- Run this BEFORE topout/supabase/migrations/2026-09-30-staff-lookup.sql.
begin;

-- Another app's staff row for this email (name and pronouns), so Add User can fill them in. Empty here; Top Out's
-- schema replaces it (team_staff).
create function public.person_in_other_app(p_email text)
returns table (first_name text, last_name text, pronouns text)
language sql stable security definer set search_path = '' as $$
  select null::text, null::text, null::text where false;
$$;

-- Add User (staff), admins only: the name and pronouns another app already has for this email (null if none), and
-- whether its login already has a password. Then the invite is skipped: they sign in with the password they have.
create function public.staff_lookup(p_email text)
returns table (first_name text, last_name text, pronouns text, has_password boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
  return query
  select o.first_name, o.last_name, o.pronouns,
    exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email)) and coalesce(u.encrypted_password, '') <> '')
  from (select 1) x left join lateral (select * from public.person_in_other_app(p_email) limit 1) o on true;
end;
$$;

revoke execute on function public.person_in_other_app(text) from public, anon, authenticated;
revoke execute on function public.staff_lookup(text) from public, anon;
grant execute on function public.staff_lookup(text) to authenticated;

commit;
