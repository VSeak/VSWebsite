-- Bouldering coaching site: tables, access rules and the sign-up gate.
-- Run once in Supabase: SQL Editor → New query → paste all of this → change
-- the email in step 8 to yours → Run.

-- 1. Tables ------------------------------------------------------------------

-- Staff sign in by email. Roles are separate and a person can have several:
-- coach manages students, plans, goals and notes; admin sees and edits every
-- user on the Users page (staff and students).
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  first_name text not null default '',
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  pronouns text not null default '' check (length(pronouns) <= 40),   -- e.g. she/her; empty = not given
  roles text[] not null default '{coach}'
    check (cardinality(roles) > 0 and roles <@ array['admin', 'coach']),
  invited_at timestamptz,
  owner boolean not null default false,   -- see section 5: nobody else can change their access
  deactivated_at timestamptz,             -- set when they leave: no roles, but the row, login and history stay
  created_at timestamptz not null default now()
);
create unique index staff_one_owner on public.staff (owner) where owner;

-- One row per student. email can wait until the coach is ready to invite them.
-- invited_at is set when an invite goes out; user_id the first time they sign in.
-- coach_id is their current coach (see section 6).
create table public.students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  pronouns text not null default '' check (length(pronouns) <= 40),   -- e.g. she/her; the student can change it (update_my_pronouns)
  email text unique check (email = lower(email)),
  invited_at timestamptz,
  user_id uuid unique references auth.users (id) on delete set null,
  coach_id uuid references public.staff (id) on delete set null,   -- current coach; history in student_coaches
  -- Their next training session: coaches and admins set it, the student only reads it.
  -- All four are set together (the end after the start), or none.
  next_date date,
  next_start time,
  next_end time,
  next_location text check (length(next_location) <= 200),
  -- Null while they are training; set when they finish (Inactive on the Students list).
  training_ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint next_session_whole check (
    (next_date is null and next_start is null and next_end is null and next_location is null)
    or (next_date is not null and next_start is not null and next_end > next_start
        and length(trim(next_location)) > 0))
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  title text not null,
  overview text not null default '',
  start_date date,
  -- true = Repeat Weekly: one week of sessions (all week 1), done every week. false = Week by Week.
  repeats boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.plans (student_id);

-- At most one current plan per student: making a plan current turns their
-- other current plan into a past plan. No current plan is fine.
create function public.one_current_plan() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active then
    update public.plans set active = false
    where student_id = new.student_id and active and id <> new.id;
  end if;
  return new;
end;
$$;
create trigger one_current_plan before insert or update of active, student_id on public.plans
  for each row execute function public.one_current_plan();
create unique index plans_one_current on public.plans (student_id) where active;

-- exercises: [{name, sets, reps, rest, notes}]
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  week int not null default 1 check (week >= 1),
  position int not null default 0,
  title text not null default '',
  details text not null default '',
  exercises jsonb not null default '[]'
);
create index on public.sessions (plan_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,   -- the note outlives the login
  from_coach boolean not null default false,
  author_name text not null default '',   -- a coach's name on their replies (stamp_note_author); empty for students
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on public.notes (session_id);

-- The coach marks a goal achieved (done_at = the day) or archives it.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  status text not null default 'current' check (status in ('current', 'achieved', 'archived')),
  done_at date,
  created_at timestamptz not null default now()
);
create index on public.goals (student_id);

-- Coach Notes: private notes coaches keep on a student (students can't see them).
-- session_date set = notes from that session; empty = a general note.
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  author_name text not null default '',   -- stamp_coach_note, kept if the coach is removed
  session_date date,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz                    -- stamp_coach_note, on a change to the text or date
);
create index on public.coach_notes (student_id);

-- Session History: past sessions. The page logs a Next Session once it has ended and is updated or
-- cleared; coaches can add or delete rows by hand. One row per student, day and start time.
create table public.session_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  location text not null check (length(trim(location)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (student_id, session_date, start_time)
);

-- The master exercise list: defaults a plan copies when the coach picks an
-- exercise. Plans keep their own copy, so editing either never changes the other.
-- name_key makes names unique ignoring case and spaces at the ends.
-- purposes (Mobility, Injury Prevention, ...) are for coaches to search by. Plans
-- don't copy them, so students never see them.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  name_key text generated always as (lower(trim(name))) stored unique,
  sets text not null default '',
  reps text not null default '',
  rest text not null default '',
  notes text not null default '',
  purposes text[] not null default '{}' check (cardinality(purposes) <= 12),
  created_at timestamptz not null default now()
);

-- The purposes to pick from, added, renamed and deleted on the Master Exercise List.
-- Renaming one renames it on every exercise; deleting one takes it off every exercise.
create table public.exercise_purposes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  name_key text generated always as (lower(trim(name))) stored unique,
  created_at timestamptz not null default now()
);
insert into public.exercise_purposes (name) values ('Mobility'), ('Injury Prevention'), ('Strength Training'),
  ('Finger Strength'), ('Power'), ('Core'), ('Endurance'), ('Technique'), ('Warm-Up'), ('Recovery');

create function public.sync_exercise_purpose() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.exercises set purposes = array_remove(purposes, old.name) where old.name = any(purposes);
    return old;
  end if;
  if new.name <> old.name then
    update public.exercises set purposes = array_replace(purposes, old.name, new.name) where old.name = any(purposes);
  end if;
  return new;
end;
$$;
create trigger sync_exercise_purpose after update of name or delete on public.exercise_purposes
  for each row execute function public.sync_exercise_purpose();

-- 2. Helpers (security definer so the rules below don't loop on themselves) --

-- The signed-in person's staff roles, e.g. {admin,coach}, or null for a student.
-- Deactivated staff (staff.deactivated_at) get no roles here or from is_coach() and is_admin().
create function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select roles from public.staff where email = lower(auth.jwt() ->> 'email') and deactivated_at is null;
$$;

create function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'coach' = any (roles) and deactivated_at is null
  );
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles) and deactivated_at is null
  );
$$;

create function public.my_student_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.students where user_id = auth.uid();
$$;

create function public.owns_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans
    where id = p and student_id = public.my_student_id()
  );
$$;

create function public.owns_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions ss
    join public.plans p on p.id = ss.plan_id
    where ss.id = s and p.student_id = public.my_student_id()
  );
$$;

create function public.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.staff where email = lower(auth.jwt() ->> 'email');
$$;

-- A staff member can also be a student. True when the student is the signed-in person (their claimed login,
-- or their email before they claim it): nobody coaches themselves or sees Coach Notes about themselves.
create function public.is_self(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students
    where id = p and (user_id = auth.uid() or email = lower(auth.jwt() ->> 'email'))
  );
$$;

-- True when the signed-in coach may change this student: they are the student's coach, or the student has none.
-- Never for themselves. Other coaches can only read.
create function public.can_coach(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach() and exists (
    select 1 from public.students
    where id = p and (coach_id is null or coach_id = public.my_staff_id())
  ) and not public.is_self(p);
$$;

create function public.can_coach_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_coach((select student_id from public.plans where id = p));
$$;

create function public.can_coach_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_coach_plan((select plan_id from public.sessions where id = s));
$$;

-- Called by the site after sign-in: links the account to its student row.
create function public.claim_student() returns void
language sql volatile security definer set search_path = '' as $$
  update public.students set user_id = auth.uid()
  where email = lower(auth.jwt() ->> 'email')
    and user_id is null
    and auth.uid() is not null
    and not exists (select 1 from public.students where user_id = auth.uid());
$$;

-- A signed-in student changes their own pronouns (nothing else on their row: coaches and admins keep their name,
-- so the coach always knows who they are).
create function public.update_my_pronouns(p_pronouns text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.students set pronouns = trim(coalesce(p_pronouns, ''))
  where user_id = auth.uid() and auth.uid() is not null;
  if not found then raise exception 'Only a signed-in student can change their pronouns here.'; end if;
end;
$$;

-- Called by the coach's Delete Student button: removes the student and their
-- login (never a coach's), so re-adding the same email starts fresh.
-- Only once their coaching has ended (End Coaching is the way to archive someone).
create function public.delete_student(p_id uuid) returns void
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

-- Emails sign off with the sender's first name ({{ .Data.sent_by }}). Supabase ignores a link's data for a login
-- that already exists, so the page stamps it here before each send. The name comes from the caller's staff row.
create function public.stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email')
    and ('coach' = any (roles) or 'admin' = any (roles)) and deactivated_at is null;
  if sender is null then raise exception 'Only a coach or an admin can send sign-in links.'; end if;
  -- A normal sign-in link clears email_changed_to (prepare_email_change), so it gets the usual wording again.
  update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email_changed_to')
    || jsonb_build_object('sent_by', sender)
  where lower(email) = lower(trim(p_email));
end;
$$;

-- A coach's reply is signed with their name. Students can't read staff, so it is kept on the note, taken from
-- the poster's own staff row (nobody can post as someone else) and fixed after that.
create function public.stamp_note_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.author_name := old.author_name;
  elsif new.from_coach then
    new.author_name := coalesce((select nullif(name, '') from public.staff where email = lower(auth.jwt() ->> 'email')), '');
  else
    new.author_name := '';
  end if;
  return new;
end;
$$;
create trigger stamp_note_author before insert or update on public.notes
  for each row execute function public.stamp_note_author();

-- A coach note keeps who wrote it and when (nobody can change those), and when it was last edited.
create function public.stamp_coach_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    if (new.body, new.session_date) is distinct from (old.body, old.session_date) then new.edited_at := now(); end if;
  else
    new.author_id := auth.uid();
    new.author_name := coalesce((select name from public.staff where email = lower(auth.jwt() ->> 'email')), '');
    new.edited_at := null;
  end if;
  return new;
end;
$$;
create trigger stamp_coach_note before insert or update on public.coach_notes
  for each row execute function public.stamp_coach_note();

-- 3. Access rules -------------------------------------------------------------
-- Every coach can read every student, plan, session, note and goal. Only a student's current coach (or any
-- coach, for a student with no coach: can_coach()) changes them or replies to notes. Any coach adds Coach Notes
-- (the author or the student's coach edits them) and logs past sessions. Nobody coaches themselves.
-- Admins can read and change the staff list and students (not plans or goals).
-- A student can read their own row (and change their pronouns through
-- update_my_pronouns()), plans and sessions, read their current and
-- achieved goals (not archived ones), read notes on their sessions, and add or
-- delete their own notes.
-- Coach notes are for coaches only: students and admin-only staff can't see them.
-- Coaches and admins can do everything with the master exercise list. Students
-- can't see it at all. The same goes for its purposes.

alter table public.staff    enable row level security;
alter table public.students enable row level security;
alter table public.plans    enable row level security;
alter table public.sessions enable row level security;
alter table public.notes    enable row level security;
alter table public.goals    enable row level security;
alter table public.coach_notes enable row level security;
alter table public.session_history enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_purposes enable row level security;

grant select, insert, update, delete
  on public.staff, public.students, public.plans, public.sessions, public.notes, public.goals, public.coach_notes, public.session_history,
     public.exercises, public.exercise_purposes
  to authenticated;

-- Helpers that don't depend on the row are wrapped in (select ...), so Postgres runs them once per query instead of
-- once per row. Calls that take a column, like can_coach(student_id), have to run per row.
create policy "admin: everything" on public.staff for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "staff: own row" on public.staff for select to authenticated
  using (email = (select lower(auth.jwt() ->> 'email')));

create policy "coach: read" on public.students for select to authenticated using ((select public.is_coach()));
create policy "coach: add" on public.students for insert to authenticated with check ((select public.is_coach()));
create policy "coach: change own" on public.students for update to authenticated
  using (public.can_coach(id))
  with check ((select public.is_coach()) and (coach_id is null or coach_id = (select public.my_staff_id())));
create policy "coach: delete own" on public.students for delete to authenticated using (public.can_coach(id));
create policy "admin: students" on public.students for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "student: own row" on public.students for select to authenticated
  using (user_id = (select auth.uid()));

create policy "coach: read" on public.plans for select to authenticated using ((select public.is_coach()));
create policy "coach: add" on public.plans for insert to authenticated with check (public.can_coach(student_id));
create policy "coach: change" on public.plans for update to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
create policy "coach: delete" on public.plans for delete to authenticated using (public.can_coach(student_id));
create policy "student: own plans" on public.plans for select to authenticated
  using (student_id = (select public.my_student_id()));

create policy "coach: read" on public.sessions for select to authenticated using ((select public.is_coach()));
create policy "coach: add" on public.sessions for insert to authenticated with check (public.can_coach_plan(plan_id));
create policy "coach: change" on public.sessions for update to authenticated
  using (public.can_coach_plan(plan_id)) with check (public.can_coach_plan(plan_id));
create policy "coach: delete" on public.sessions for delete to authenticated using (public.can_coach_plan(plan_id));
create policy "student: own sessions" on public.sessions for select to authenticated
  using (public.owns_plan(plan_id));

create policy "coach: read" on public.notes for select to authenticated using ((select public.is_coach()));
create policy "coach: reply" on public.notes for insert to authenticated
  with check (from_coach and author_id = (select auth.uid()) and public.can_coach_session(session_id));
create policy "coach: delete" on public.notes for delete to authenticated using (public.can_coach_session(session_id));
create policy "student: read notes" on public.notes for select to authenticated
  using (public.owns_session(session_id));
create policy "student: add notes" on public.notes for insert to authenticated
  with check (author_id = (select auth.uid()) and not from_coach and public.owns_session(session_id));
create policy "student: delete own notes" on public.notes for delete to authenticated
  using (author_id = (select auth.uid()) and not from_coach);

create policy "coach: read" on public.goals for select to authenticated using ((select public.is_coach()));
create policy "coach: add" on public.goals for insert to authenticated with check (public.can_coach(student_id));
create policy "coach: change" on public.goals for update to authenticated
  using (public.can_coach(student_id)) with check (public.can_coach(student_id));
create policy "coach: delete" on public.goals for delete to authenticated using (public.can_coach(student_id));
create policy "student: own goals" on public.goals for select to authenticated
  using (student_id = (select public.my_student_id()) and status <> 'archived');

create policy "coach: read" on public.coach_notes for select to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id));
create policy "coach: add" on public.coach_notes for insert to authenticated
  with check ((select public.is_coach()) and not public.is_self(student_id));
create policy "coach: change" on public.coach_notes for update to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id) and (author_id = (select auth.uid()) or public.can_coach(student_id)))
  with check ((select public.is_coach()) and not public.is_self(student_id));
create policy "coach: delete" on public.coach_notes for delete to authenticated
  using ((select public.is_coach()) and not public.is_self(student_id) and (author_id = (select auth.uid()) or public.can_coach(student_id)));

create policy "staff: read" on public.session_history for select to authenticated using ((select public.is_coach()) or (select public.is_admin()));
create policy "staff: add" on public.session_history for insert to authenticated
  with check ((select public.is_admin()) or ((select public.is_coach()) and not public.is_self(student_id)));
create policy "staff: change" on public.session_history for update to authenticated
  using ((select public.is_admin()) or public.can_coach(student_id)) with check ((select public.is_admin()) or public.can_coach(student_id));
create policy "staff: delete" on public.session_history for delete to authenticated
  using ((select public.is_admin()) or public.can_coach(student_id));
create policy "student: own history" on public.session_history for select to authenticated
  using (student_id = (select public.my_student_id()));

create policy "staff: everything" on public.exercises for all to authenticated
  using ((select public.is_coach()) or (select public.is_admin())) with check ((select public.is_coach()) or (select public.is_admin()));
create policy "staff: everything" on public.exercise_purposes for all to authenticated
  using ((select public.is_coach()) or (select public.is_admin())) with check ((select public.is_coach()) or (select public.is_admin()));

-- 4. Sign-up gate ---------------------------------------------------------------
-- Only emails on the student list (or the active staff list) can create an account.
-- Anyone else gets an error, so an open sign-up can't be abused.

create function public.gate_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where email = lower(new.email))
     and not exists (select 1 from public.staff where email = lower(new.email) and deactivated_at is null) then
    raise exception 'This email has not been invited.';
  end if;
  return new;
end;
$$;

create trigger gate_signup before insert on auth.users
  for each row execute function public.gate_signup();

-- 5. Admins ------------------------------------------------------------------------

-- There must always be an admin, so nobody can lock everyone out of the Users page.
create function public.keep_an_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where 'admin' = any (roles) and deactivated_at is null) then
    raise exception 'There must always be at least one admin.';
  end if;
  return null;
end;
$$;
create trigger keep_an_admin after update or delete on public.staff
  for each statement execute function public.keep_an_admin();

-- The owner (step 8): other admins can't change their roles or email, or remove them.
-- The owner keeps the Admin role and can still change their own Coach role and name.
-- Only the SQL Editor can make someone the owner (or undo it).
create function public.protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The SQL Editor (no signed-in user) can do anything.
  if auth.jwt() ->> 'email' is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.owner then raise exception 'Only the SQL Editor can make someone the owner.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.owner then raise exception 'The owner can''t be removed.'; end if;
    return old;
  end if;
  if new.owner is distinct from old.owner then
    raise exception 'Only the SQL Editor can change who the owner is.';
  end if;
  if old.owner then
    if new.email <> old.email then raise exception 'The owner''s email can''t be changed here.'; end if;
    if not ('admin' = any (new.roles)) then raise exception 'The owner always keeps the Admin role.'; end if;
    if new.deactivated_at is not null then raise exception 'The owner can''t be deactivated.'; end if;
    if new.roles is distinct from old.roles and old.email <> lower(auth.jwt() ->> 'email') then
      raise exception 'Only the owner can change their own roles.';
    end if;
  end if;
  return new;
end;
$$;
create trigger protect_owner before insert or update or delete on public.staff
  for each row execute function public.protect_owner();

-- Staff who leave are deactivated (deactivated_at), not deleted, so they can come back with their history.
-- Deactivating someone (not yourself) leaves their students with no coach and ends any sign-in they have open (unless
-- their login is also a student's). Their password still works, so only someone who knows it learns the account is
-- deactivated: the page signs them straight back out and shows "Account Deactivated". They get no roles or data meanwhile.
-- Reactivating doesn't give their students back.
create function public.staff_deactivated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deactivated_at is null or old.deactivated_at is not null then return null; end if;
  if new.email = lower(auth.jwt() ->> 'email') then raise exception 'You can''t deactivate yourself.'; end if;
  update public.students set coach_id = null where coach_id = new.id;
  delete from auth.sessions s using auth.users u
  where s.user_id = u.id and lower(u.email) = new.email
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = new.email);
  return null;
end;
$$;
create trigger staff_deactivated after update of deactivated_at on public.staff
  for each row execute function public.staff_deactivated();

-- Everyone, staff and students, for admins only (others get no rows).
-- last_sign_in_at comes from their login, so the page can tell who is active.
create function public.list_users()
returns table (kind text, id uuid, first_name text, last_name text, name text, pronouns text, email text,
               roles text[], invited_at timestamptz, last_sign_in_at timestamptz, owner boolean, deactivated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'staff'::text, s.id, s.first_name, s.last_name, s.name, s.pronouns, s.email, s.roles, s.invited_at, u.last_sign_in_at, s.owner,
         s.deactivated_at
  from public.staff s left join auth.users u on lower(u.email) = s.email
  where public.is_admin()
  union all
  select 'student'::text, st.id, st.first_name, st.last_name, st.name, st.pronouns, st.email, '{student}'::text[], st.invited_at,
         u.last_sign_in_at, false, null::timestamptz
  from public.students st left join auth.users u on u.id = st.user_id
  where public.is_admin();
$$;

-- Removes a staff member and their login (kept if they are also a student). Only once they're deactivated.
-- Their students are left with no coach, and their time as coach ends now.
create function public.delete_staff(p_id uuid) returns void
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
    and not exists (select 1 from public.students st where st.user_id = u.id or st.email = s.email);
end;
$$;

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

-- The OLD address gets a notice when an admin changes a signed-in student's email (the Magic Link email with
-- {{ if .Data.email_changed_to }} wording and no sign-in button). It has to go out before the change, while the old
-- address still has a login: this checks the new email like change_student_email() does, stamps sent_by and
-- email_changed_to on the student's login, and returns the old email. The page sends the notice, then changes the email.
create function public.prepare_email_change(p_id uuid, p_email text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_email text := lower(trim(coalesce(p_email, '')));
  sender text;
  uid uuid;
  old_email text;
begin
  select first_name into sender from public.staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles)
    and deactivated_at is null;
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

-- A student can be invited once they have a saved plan (one with a title) and a goal.
-- Security definer so admins, who can't read plans or goals, can check it too.
create function public.student_ready(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.is_coach() or public.is_admin())
    and exists (select 1 from public.plans where student_id = p_id and title <> '')
    and exists (select 1 from public.goals where student_id = p_id);
$$;

-- 6. Coaches -------------------------------------------------------------------------

-- Every coach a student has had: one row per coach, so a coach who comes back
-- reuses their row (started_at resets, ended_at clears) and never shows twice.
-- coach_name is kept so a past coach's name survives their staff row being removed.
-- No policies: everyone reads it through coaches_of(), and only the triggers write it.
create table public.student_coaches (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete set null,
  coach_name text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (student_id, staff_id)
);
alter table public.student_coaches enable row level security;

-- A new student gets the coach who added them (unless it's themselves). After that only an admin can
-- change the coach (the SQL Editor, with no signed-in user, can too). Ending coaching leaves them with
-- no coach and no current plan; resuming gives them back the coach they had then, if that coach is the one
-- resuming. Nobody can be their own coach.
create function public.check_student_coach() returns trigger
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
create trigger check_student_coach before insert or update of coach_id, training_ended_at on public.students
  for each row execute function public.check_student_coach();

-- Keeps student_coaches in step: the old coach's row gets an end date, the new
-- coach gets a row (or their old one back).
create function public.log_student_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.coach_id is not distinct from old.coach_id then return null; end if;
    update public.student_coaches set ended_at = now()
    where student_id = new.id and staff_id = old.coach_id and ended_at is null;
  end if;
  if new.coach_id is not null then
    insert into public.student_coaches (student_id, staff_id, coach_name)
    select new.id, s.id, coalesce(nullif(s.name, ''), s.email) from public.staff s where s.id = new.coach_id
    on conflict (student_id, staff_id) do update
      set coach_name = excluded.coach_name, started_at = now(), ended_at = null;
  end if;
  return null;
end;
$$;
create trigger log_student_coach after insert or update of coach_id, training_ended_at on public.students
  for each row execute function public.log_student_coach();

-- Active coaches' names, for staff (coaches can't read other staff rows).
create function public.coach_list() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select s.id, coalesce(nullif(s.name, ''), s.email) from public.staff s
  where 'coach' = any (s.roles) and s.deactivated_at is null and (public.is_coach() or public.is_admin());
$$;

-- A student's current coach and past coaches, newest first. For staff, or the
-- student themselves (students can't read the staff table).
create function public.coaches_of(p_id uuid)
returns table (staff_id uuid, name text, is_current boolean, started_at timestamptz, ended_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.staff_id, coalesce(nullif(s.name, ''), nullif(c.coach_name, ''), s.email),
         c.staff_id is not null and c.staff_id = st.coach_id, c.started_at, c.ended_at
  from public.student_coaches c
  join public.students st on st.id = c.student_id
  left join public.staff s on s.id = c.staff_id
  where c.student_id = p_id
    and (public.is_coach() or public.is_admin() or p_id = public.my_student_id())
  order by 3 desc, coalesce(c.ended_at, c.started_at) desc;
$$;

-- 7. Nothing here needs the anonymous (signed-out) role.
revoke execute on function public.claim_student() from anon;
revoke execute on function public.update_my_pronouns(text) from public, anon;
revoke execute on function public.delete_student(uuid) from public, anon;
revoke execute on function public.list_users() from public, anon;
revoke execute on function public.delete_staff(uuid) from public, anon;
revoke execute on function public.student_ready(uuid) from public, anon;
revoke execute on function public.coaches_of(uuid), public.my_staff_id(), public.coach_list() from public, anon;
revoke execute on function public.is_self(uuid), public.can_coach(uuid), public.can_coach_plan(uuid),
  public.can_coach_session(uuid) from public, anon;
revoke execute on function public.stamp_sender(text) from public, anon;
revoke execute on function public.change_student_email(uuid, text), public.prepare_email_change(uuid, text) from public, anon;
grant execute on function public.delete_student(uuid), public.list_users(), public.delete_staff(uuid), public.student_ready(uuid),
  public.coaches_of(uuid), public.my_staff_id(), public.coach_list(), public.update_my_pronouns(text), public.stamp_sender(text),
  public.change_student_email(uuid, text), public.prepare_email_change(uuid, text),
  public.is_self(uuid), public.can_coach(uuid), public.can_coach_plan(uuid), public.can_coach_session(uuid) to authenticated;

-- 8. Make yourself an admin, a coach and the owner. Change this to the email you'll sign in with.
insert into public.staff (email, roles, owner) values (lower('you@example.com'), '{admin,coach}', true);
