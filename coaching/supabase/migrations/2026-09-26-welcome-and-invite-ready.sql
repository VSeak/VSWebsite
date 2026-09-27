-- Staff can read their own staff row (home page says "Welcome <first name>!"),
-- and student_ready() tells staff whether a student can be invited yet.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create policy "staff: own row" on public.staff for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

-- A student can be invited once they have a saved plan (one with a title) and a goal.
-- Security definer so admins, who can't read plans or goals, can check it too.
create function public.student_ready(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.is_coach() or public.is_admin())
    and exists (select 1 from public.plans where student_id = p_id and title <> '')
    and exists (select 1 from public.goals where student_id = p_id);
$$;

revoke execute on function public.student_ready(uuid) from public, anon;
grant execute on function public.student_ready(uuid) to authenticated;
