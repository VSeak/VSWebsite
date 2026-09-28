-- Admins can change a signed-in student's email. Their login's email changes with it, so they sign in with the new one.
-- (Before they sign in, the invite form on their page changes the email instead.)
create function public.change_student_email(p_id uuid, p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_email text := lower(trim(coalesce(p_email, '')));
  uid uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change a student''s email.';
  end if;
  if new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email.';
  end if;
  select user_id into uid from public.students where id = p_id;
  if not found then raise exception 'That student no longer exists.'; end if;
  if exists (select 1 from public.staff where email = new_email) then
    raise exception 'A staff member already has that email.';
  end if;
  if exists (select 1 from auth.users where lower(email) = new_email and id is distinct from uid) then
    raise exception 'Another login already uses that email.';
  end if;
  begin
    update public.students set email = new_email where id = p_id;
  exception when unique_violation then
    raise exception 'Another student already has that email.';
  end;
  if uid is not null then
    update auth.users set email = new_email, updated_at = now() where id = uid;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', new_email), updated_at = now()
    where user_id = uid and provider = 'email';
  end if;
end;
$$;

revoke execute on function public.change_student_email(uuid, text) from public, anon;
grant execute on function public.change_student_email(uuid, text) to authenticated;
