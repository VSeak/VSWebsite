-- Add Staff: an email Sit Start already has fills in the name and pronouns, and one whose login already has a password
-- skips the invite. Also lets Sit Start's Add User fill in names from Top Out (person_in_other_app).
-- Run AFTER sitstart/supabase/migrations/2026-09-30-staff-lookup.sql.
begin;

-- Sit Start's Add User asks this for the name and pronouns Top Out has for an email (staff_lookup in Sit Start).
create or replace function public.person_in_other_app(p_email text)
returns table (first_name text, last_name text, pronouns text)
language sql stable security definer set search_path = '' as $$
  select first_name, last_name, pronouns from public.team_staff where email = lower(trim(p_email));
$$;

-- Add Staff, admins only: the name and pronouns Sit Start has for this email (its staff, else its students; null if
-- neither), and whether its login already has a password. Then the invite is skipped: they sign in with the password
-- they have.
create function public.team_staff_lookup(p_email text)
returns table (first_name text, last_name text, pronouns text, has_password boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  e text := lower(trim(p_email));
begin
  if not public.team_is_admin() then return; end if;
  return query
  select o.first_name, o.last_name, o.pronouns,
    exists (select 1 from auth.users u where lower(u.email) = e and coalesce(u.encrypted_password, '') <> '')
  from (select 1) x left join lateral (
    select s.first_name, s.last_name, s.pronouns, 1 as pick from public.staff s where s.email = e
    union all
    select st.first_name, st.last_name, st.pronouns, 2 from public.students st where st.email = e
    order by pick limit 1) o on true;
end;
$$;

revoke execute on function public.team_staff_lookup(text) from public, anon;
grant execute on function public.team_staff_lookup(text) to authenticated;

commit;
