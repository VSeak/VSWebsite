-- Emails sign off with the first name of the coach or admin who sent them ({{ .Data.sent_by }}), not a fixed name.
-- A new login gets sent_by from the invite's data, but Supabase ignores that data for a login that already exists
-- (a resent invite or a sign-in link), so the page calls stamp_sender() first. The name comes from the caller's
-- own staff row, so nobody can sign an email as someone else.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create function public.stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email')
    and ('coach' = any (roles) or 'admin' = any (roles));
  if sender is null then raise exception 'Only a coach or an admin can send sign-in links.'; end if;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('sent_by', sender)
  where lower(email) = lower(trim(p_email));
end;
$$;

revoke execute on function public.stamp_sender(text) from public, anon;
grant execute on function public.stamp_sender(text) to authenticated;
