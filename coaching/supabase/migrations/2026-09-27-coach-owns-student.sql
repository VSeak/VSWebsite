-- Only a student's current coach changes their plans, goals, details and next session, and replies to their notes.
-- Other coaches can read everything, add Coach Notes (editing only their own) and log past sessions.
-- A student with no coach can be changed by any coach. Ending coaching leaves the student with no coach;
-- a coach who resumes it becomes their coach.
-- A staff member can also be a student: nobody coaches themselves, and a coach never sees Coach Notes about themselves.

-- True when the student is the signed-in person (their claimed login, or their email before they claim it).
create or replace function public.is_self(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students
    where id = p and (user_id = auth.uid() or email = lower(auth.jwt() ->> 'email'))
  );
$$;

-- True when the signed-in coach may change this student: they are the student's coach, or the student has none.
-- Never for themselves.
create or replace function public.can_coach(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach() and exists (
    select 1 from public.students
    where id = p and (coach_id is null or coach_id = public.my_staff_id())
  ) and not public.is_self(p);
$$;

create or replace function public.can_coach_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_coach((select student_id from public.plans where id = p));
$$;

create or replace function public.can_coach_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_coach_plan((select plan_id from public.sessions where id = s));
$$;

-- Active coaches' names, for staff (coaches can't read other staff rows).
create or replace function public.coach_list() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select s.id, coalesce(nullif(s.name, ''), s.email) from public.staff s
  where 'coach' = any (s.roles) and s.deactivated_at is null and (public.is_coach() or public.is_admin());
$$;

revoke execute on function public.is_self(uuid), public.can_coach(uuid), public.can_coach_plan(uuid),
  public.can_coach_session(uuid), public.coach_list() from public, anon;
grant execute on function public.is_self(uuid), public.can_coach(uuid), public.can_coach_plan(uuid),
  public.can_coach_session(uuid), public.coach_list() to authenticated;

-- Students
drop policy "coach: everything" on public.students;
create policy "coach: read" on public.students for select to authenticated using (public.is_coach());
create policy "coach: add" on public.students for insert to authenticated with check (public.is_coach());
create policy "coach: change own" on public.students for update to authenticated
  using (public.can_coach(id))
  with check (public.is_coach() and (coach_id is null or coach_id = public.my_staff_id()));
create policy "coach: delete own" on public.students for delete to authenticated using (public.can_coach(id));

-- Plans
drop policy "coach: everything" on public.plans;
create policy "coach: read" on public.plans for select to authenticated using (public.is_coach());
create policy "coach: add" on public.plans for insert to authenticated with check (public.can_coach(student_id));
create policy "coach: change" on public.plans for update to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
create policy "coach: delete" on public.plans for delete to authenticated using (public.can_coach(student_id));

-- Sessions
drop policy "coach: everything" on public.sessions;
create policy "coach: read" on public.sessions for select to authenticated using (public.is_coach());
create policy "coach: add" on public.sessions for insert to authenticated with check (public.can_coach_plan(plan_id));
create policy "coach: change" on public.sessions for update to authenticated
  using (public.can_coach_plan(plan_id)) with check (public.can_coach_plan(plan_id));
create policy "coach: delete" on public.sessions for delete to authenticated using (public.can_coach_plan(plan_id));

-- Plan notes: every coach reads them; only the student's coach replies or deletes.
drop policy "coach: everything" on public.notes;
create policy "coach: read" on public.notes for select to authenticated using (public.is_coach());
create policy "coach: reply" on public.notes for insert to authenticated
  with check (from_coach and author_id = auth.uid() and public.can_coach_session(session_id));
create policy "coach: delete" on public.notes for delete to authenticated using (public.can_coach_session(session_id));

-- Goals
drop policy "coach: everything" on public.goals;
create policy "coach: read" on public.goals for select to authenticated using (public.is_coach());
create policy "coach: add" on public.goals for insert to authenticated with check (public.can_coach(student_id));
create policy "coach: change" on public.goals for update to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
create policy "coach: delete" on public.goals for delete to authenticated using (public.can_coach(student_id));

-- Coach Notes: any coach adds; the author or the student's coach edits and deletes; never about yourself.
drop policy "coach: everything" on public.coach_notes;
create policy "coach: read" on public.coach_notes for select to authenticated
  using (public.is_coach() and not public.is_self(student_id));
create policy "coach: add" on public.coach_notes for insert to authenticated
  with check (public.is_coach() and not public.is_self(student_id));
create policy "coach: change" on public.coach_notes for update to authenticated
  using (public.is_coach() and not public.is_self(student_id) and (author_id = auth.uid() or public.can_coach(student_id)))
  with check (public.is_coach() and not public.is_self(student_id));
create policy "coach: delete" on public.coach_notes for delete to authenticated
  using (public.is_coach() and not public.is_self(student_id) and (author_id = auth.uid() or public.can_coach(student_id)));

-- Session History: any coach logs a past session (not their own); the student's coach or an admin changes or deletes.
drop policy "staff: everything" on public.session_history;
create policy "staff: read" on public.session_history for select to authenticated using (public.is_coach() or public.is_admin());
create policy "staff: add" on public.session_history for insert to authenticated
  with check (public.is_admin() or (public.is_coach() and not public.is_self(student_id)));
create policy "staff: change" on public.session_history for update to authenticated
  using (public.is_admin() or public.can_coach(student_id)) with check (public.is_admin() or public.can_coach(student_id));
create policy "staff: delete" on public.session_history for delete to authenticated
  using (public.is_admin() or public.can_coach(student_id));

-- Delete Student: an admin, or a coach who may change the student.
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
    and not exists (select 1 from public.staff a where a.email = lower(u.email));
end;
$$;

-- Coaches: ending coaching leaves no coach, and a coach who resumes it becomes the coach. Nobody coaches themselves.
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
drop trigger check_student_coach on public.students;
create trigger check_student_coach before insert or update of coach_id, training_ended_at on public.students
  for each row execute function public.check_student_coach();
drop trigger log_student_coach on public.students;
create trigger log_student_coach after insert or update of coach_id, training_ended_at on public.students
  for each row execute function public.log_student_coach();

-- Students whose coaching already ended lose their coach (their time as coach ends now).
update public.students set coach_id = null where training_ended_at is not null and coach_id is not null;
