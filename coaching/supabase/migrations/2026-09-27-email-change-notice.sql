-- When an admin changes a signed-in student's email, the OLD address gets a notice (the Magic Link email with
-- {{ if .Data.email_changed_to }} wording and no sign-in button). It has to go out before the change, while the old
-- address still has a login, so the page calls prepare_email_change() (checks the new email, stamps the notice's data),
-- sends the notice to the old address, and only then calls change_student_email().

-- Checks the new email the same way change_student_email() does, and stamps sent_by and email_changed_to on the
-- student's login. Returns the old email, for the page to send the notice to.
create function public.prepare_email_change(p_id uuid, p_email text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_email text := lower(trim(coalesce(p_email, '')));
  sender text;
  uid uuid;
  old_email text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles);
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

-- A normal sign-in link clears email_changed_to, so it gets the usual wording again.
create or replace function public.stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email')
    and ('coach' = any (roles) or 'admin' = any (roles));
  if sender is null then raise exception 'Only a coach or an admin can send sign-in links.'; end if;
  update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email_changed_to')
    || jsonb_build_object('sent_by', sender)
  where lower(email) = lower(trim(p_email));
end;
$$;

revoke execute on function public.prepare_email_change(uuid, text) from public, anon;
grant execute on function public.prepare_email_change(uuid, text) to authenticated;
