-- Resume Coaching only gives the student back to the coach they had when coaching ended. Before, any coach who
-- resumed became the coach, so End Coaching then Resume Coaching let a coach take a No Coach student (or another
-- coach's inactive student) without an admin. Anyone else who resumes leaves them with no coach for an admin to pick.
-- End Coaching now stamps the server's time, the same moment the old coach's student_coaches row ends, so the two
-- match. Older ends used the browser's clock, so a few minutes either way still counts.

-- A new student gets the coach who added them (unless it's themselves). After that only an admin can
-- change the coach (the SQL Editor, with no signed-in user, can too). Ending coaching leaves them with
-- no coach and no current plan; resuming gives them back the coach they had then, if that coach is the one
-- resuming. Nobody can be their own coach.
create or replace function public.check_student_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.coach_id is null and public.is_coach()
     and new.email is distinct from lower(auth.jwt() ->> 'email') then
    new.coach_id := public.my_staff_id();
  end if;
  if tg_op = 'UPDATE' and new.training_ended_at is distinct from old.training_ended_at then
    if new.training_ended_at is not null then
      new.training_ended_at := now();
      new.coach_id := null;
      update public.plans set active = false where student_id = new.id and active;
      return new;
    end if;
    if new.coach_id is null and old.coach_id is null and public.is_coach() and not public.is_self(new.id)
       and exists (select 1 from public.student_coaches c
                   where c.student_id = new.id and c.staff_id = public.my_staff_id()
                     and c.ended_at between old.training_ended_at - interval '5 minutes'
                                        and old.training_ended_at + interval '5 minutes') then
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
