-- Faster row-level security. Helpers that don't depend on the row (is_coach(), is_admin(), my_student_id(),
-- my_staff_id(), auth.uid(), the signed-in email) are wrapped in (select ...), so Postgres runs them once per query
-- instead of once per row. Who can see and change what stays exactly the same.
-- Every policy is listed; the ones that only call per-row checks, like can_coach(student_id), are unchanged.
begin;

alter policy "admin: everything" on public.staff to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "staff: own row" on public.staff to authenticated
  using (email = (select lower(auth.jwt() ->> 'email')));

alter policy "coach: read" on public.students to authenticated using ((select public.is_coach()));
alter policy "coach: add" on public.students to authenticated with check ((select public.is_coach()));
alter policy "coach: change own" on public.students to authenticated
  using (public.can_coach(id))
  with check ((select public.is_coach()) and (coach_id is null or coach_id = (select public.my_staff_id())));
alter policy "coach: delete own" on public.students to authenticated using (public.can_coach(id));
alter policy "admin: students" on public.students to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "student: own row" on public.students to authenticated
  using (user_id = (select auth.uid()));

alter policy "coach: read" on public.plans to authenticated using ((select public.is_coach()));
alter policy "coach: add" on public.plans to authenticated with check (public.can_coach(student_id));
alter policy "coach: change" on public.plans to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
alter policy "coach: delete" on public.plans to authenticated using (public.can_coach(student_id));
alter policy "student: own plans" on public.plans to authenticated
  using (student_id = (select public.my_student_id()));

alter policy "coach: read" on public.sessions to authenticated using ((select public.is_coach()));
alter policy "coach: add" on public.sessions to authenticated with check (public.can_coach_plan(plan_id));
alter policy "coach: change" on public.sessions to authenticated
  using (public.can_coach_plan(plan_id)) with check (public.can_coach_plan(plan_id));
alter policy "coach: delete" on public.sessions to authenticated using (public.can_coach_plan(plan_id));
alter policy "student: own sessions" on public.sessions to authenticated
  using (public.owns_plan(plan_id));

alter policy "coach: read" on public.notes to authenticated using ((select public.is_coach()));
alter policy "coach: reply" on public.notes to authenticated
  with check (from_coach and author_id = (select auth.uid()) and public.can_coach_session(session_id));
alter policy "coach: delete" on public.notes to authenticated using (public.can_coach_session(session_id));
alter policy "student: read notes" on public.notes to authenticated
  using (public.owns_session(session_id));
alter policy "student: add notes" on public.notes to authenticated
  with check (author_id = (select auth.uid()) and not from_coach and public.owns_session(session_id));
alter policy "student: delete own notes" on public.notes to authenticated
  using (author_id = (select auth.uid()) and not from_coach);

alter policy "coach: read" on public.goals to authenticated using ((select public.is_coach()));
alter policy "coach: add" on public.goals to authenticated with check (public.can_coach(student_id));
alter policy "coach: change" on public.goals to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
alter policy "coach: delete" on public.goals to authenticated using (public.can_coach(student_id));
alter policy "student: own goals" on public.goals to authenticated
  using (student_id = (select public.my_student_id()) and status <> 'archived');

alter policy "coach: read" on public.coach_notes to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id));
alter policy "coach: add" on public.coach_notes to authenticated
  with check ((select public.is_coach()) and not public.is_self(student_id));
alter policy "coach: change" on public.coach_notes to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id) and (author_id = (select auth.uid()) or public.can_coach(student_id)))
  with check ((select public.is_coach()) and not public.is_self(student_id));
alter policy "coach: delete" on public.coach_notes to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id) and (author_id = (select auth.uid()) or public.can_coach(student_id)));

alter policy "staff: read" on public.session_history to authenticated using ((select public.is_coach()) or (select public.is_admin()));
alter policy "staff: add" on public.session_history to authenticated
  with check ((select public.is_admin()) or ((select public.is_coach()) and not public.is_self(student_id)));
alter policy "staff: change" on public.session_history to authenticated
  using ((select public.is_admin()) or public.can_coach(student_id)) with check ((select public.is_admin()) or public.can_coach(student_id));
alter policy "staff: delete" on public.session_history to authenticated
  using ((select public.is_admin()) or public.can_coach(student_id));
alter policy "student: own history" on public.session_history to authenticated
  using (student_id = (select public.my_student_id()));

alter policy "staff: everything" on public.exercises to authenticated
  using ((select public.is_coach()) or (select public.is_admin())) with check ((select public.is_coach()) or (select public.is_admin()));
alter policy "staff: everything" on public.exercise_purposes to authenticated
  using ((select public.is_coach()) or (select public.is_admin())) with check ((select public.is_coach()) or (select public.is_admin()));


commit;
