-- End Coaching also turns the student's current plan into a past plan. It happens in check_student_coach,
-- so it works for an admin too (admins can't change plans). Resume Coaching leaves plans as they are;
-- the coach picks which one to make current again.

-- A new student gets the coach who added them (unless it's themselves). After that only an admin can
-- change the coach (the SQL Editor, with no signed-in user, can too). Ending coaching leaves them with
-- no coach and no current plan; a coach who resumes it becomes their coach. Nobody can be their own coach.
create or replace function public.check_student_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.coach_id is null and public.is_coach()
     and new.email is distinct from lower(auth.jwt() ->> 'email') then
    new.coach_id := public.my_staff_id();
  end if;
  if tg_op = 'UPDATE' and new.training_ended_at is distinct from old.training_ended_at then
    if new.training_ended_at is not null then
      new.coach_id := null;
      update public.plans set active = false where student_id = new.id and active;
      return new;
    end if;
    if new.coach_id is null and old.coach_id is null and public.is_coach() and not public.is_self(new.id) then
      new.coach_id := public.my_staff_id();
      return new;
    end if;
  end if;
  if new.coach_id is not distinct from (case when tg_op = 'UPDATE' then old.coach_id end) then
    return new;
  end if;
  if auth.uid() is not null and not public.is_admin()
     and not (tg_op = 'INSERT' and new.coach_id = public.my_staff_id()) then
    raise exception 'Only an admin can change a student''s coach.';
  end if;
  if new.coach_id is not null and not exists (
    select 1 from public.staff where id = new.coach_id and 'coach' = any (roles) and deactivated_at is null
  ) then
    raise exception 'Pick an active staff member with the Coach role.';
  end if;
  if new.coach_id is not null and exists (select 1 from public.staff where id = new.coach_id and email = new.email) then
    raise exception 'Nobody can be their own coach.';
  end if;
  return new;
end;
$$;

-- Students whose coaching has already ended lose their current plan too.
update public.plans p set active = false
from public.students s
where p.student_id = s.id and p.active and s.training_ended_at is not null;
