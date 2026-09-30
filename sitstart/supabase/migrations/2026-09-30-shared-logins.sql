-- Shared logins with Top Out (topout/, the Adult Team app), which uses this same Supabase project.
-- Adds login_in_other_app() (false until Top Out's schema replaces it), and makes the sign-up gate, Delete Student,
-- Delete Staff and Deactivate ask it, so a Top Out coach can create a login and Sit Start never deletes it or signs
-- it out. stamp_sender also marks the login topout = false for the shared email templates.
-- Run this BEFORE topout/supabase/schema.sql.
begin;

-- Other vsapps apps share this project's logins (Top Out: team_staff). Their schema replaces this to say whether an
-- email is one of theirs, so the sign-up gate lets it in and Sit Start never deletes or signs out that login.
create or replace function public.login_in_other_app(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select false;
$$;

create or replace function public.delete_student(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.students;
begin
  if not (public.is_admin() or public.can_coach(p_id)) then
    raise exception 'Only an admin or their coach can delete a student.';
  end if;
  if exists (select 1 from public.students where id = p_id and training_ended_at is null) then
    raise exception 'End their coaching before deleting them.';
  end if;
  delete from public.students where id = p_id returning * into s;
  if s.id is null then return; end if;
  -- Their login: the claimed one, or one made by an invite they never opened.
  delete from auth.users u
  where (u.id = s.user_id or (s.email is not null and lower(u.email) = s.email))
    and not exists (select 1 from public.staff a where a.email = lower(u.email))
    and not public.login_in_other_app(u.email);
end;
$$;

create or replace function public.stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email')
    and ('coach' = any (roles) or 'admin' = any (roles)) and deactivated_at is null;
  if sender is null then raise exception 'Only a coach or an admin can send sign-in links.'; end if;
  -- A normal sign-in link clears email_changed_to (prepare_email_change), so it gets the usual wording again.
  -- topout and staff switch the shared email templates back to Sit Start wording (Top Out's team_stamp_sender sets them too).
  update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email_changed_to')
    || jsonb_build_object('sent_by', sender, 'topout', false,
         'staff', exists (select 1 from public.staff where email = lower(trim(p_email))))
  where lower(email) = lower(trim(p_email));
end;
$$;

create or replace function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.staff where email = lower(new.email) and deactivated_at is null)
     and not public.login_in_other_app(new.email) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

create or replace function public.staff_deactivated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deactivated_at is null or old.deactivated_at is not null then return null; end if;
  if new.email = lower(auth.jwt() ->> 'email') then raise exception 'You can''t deactivate yourself.'; end if;
  update public.students set coach_id = null where coach_id = new.id;
  delete from auth.sessions s using auth.users u
  where s.user_id = u.id and lower(u.email) = new.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = new.email)
    and not public.login_in_other_app(new.email);
  return null;
end;
$$;

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
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = s.email)
    and not public.login_in_other_app(s.email);
end;
$$;

revoke execute on function public.login_in_other_app(text) from public, anon, authenticated;

commit;
