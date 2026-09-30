-- Top Out (Adult Team): tables, access rules and the shared-login hook.
-- It shares one Supabase project with Sit Start: the same logins (auth.users), separate tables (all named team_*).
-- A login alone opens nothing here: every table checks team_staff, so a Sit Start-only account sees no rows.
-- Run once, after Sit Start's schema and its 2026-09-30-shared-logins.sql migration: SQL Editor → New query →
-- paste all of this → change the email in step 8 to yours → Run.

-- 1. Tables ------------------------------------------------------------------

-- Staff sign in by email. roles: admin (every location, staff, circuits, rating areas) and coach (the locations
-- they're assigned to in team_staff_locations). A person can have both. Only staff sign in (no member logins yet).
create table public.team_staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  first_name text not null default '',
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  pronouns text not null default '' check (length(pronouns) <= 40),
  roles text[] not null default '{coach}'
    check (cardinality(roles) > 0 and roles <@ array['admin', 'coach']),
  invited_at timestamptz,
  owner boolean not null default false,   -- set only in the SQL Editor: nobody else changes their access
  created_at timestamptz not null default now()
);
create unique index team_staff_one_owner on public.team_staff (owner) where owner;

create table public.team_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  name_key text generated always as (lower(trim(name))) stored unique,
  position int not null default 0,   -- order of the cards on Home
  created_at timestamptz not null default now()
);

-- Which locations a coach works at (one or more). Admins see every location without a row here.
create table public.team_staff_locations (
  staff_id uuid not null references public.team_staff (id) on delete cascade,
  location_id uuid not null references public.team_locations (id) on delete cascade,
  primary key (staff_id, location_id)
);
create index on public.team_staff_locations (location_id);

-- Team members. They don't sign in; email is just for contact. The intake is filled in by a coach:
-- why they joined, what they want out of Adult Team, comps, injuries or limits.
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.team_locations (id) on delete restrict,   -- move or remove members first
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null default '',
  name text generated always as (trim(first_name || ' ' || last_name)) stored,
  pronouns text not null default '' check (length(pronouns) <= 40),
  email text check (email = lower(email)),
  joined_on date,
  left_on date,   -- set when they leave the team (Inactive); null while on it
  intake_why text not null default '',
  intake_wants text not null default '',
  intake_comps text not null default '' check (intake_comps in ('', 'yes', 'maybe', 'no')),
  intake_injuries text not null default '',
  intake_other text not null default '',
  intake_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.team_members (location_id);

create table public.team_goals (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  status text not null default 'current' check (status in ('current', 'achieved', 'archived')),
  done_at date,   -- the day it left current
  created_at timestamptz not null default now()
);
create index on public.team_goals (member_id);

-- Private notes coaches keep on a member. note_date is the practice it's about (empty = a general note).
create table public.team_coach_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  note_date date,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.team_coach_notes (member_id);

-- The circuit colors, easiest first (position). v_min / v_max are the rough V range, for comparing progress.
-- Admins edit the list. A circuit used by a check-in can be renamed but not deleted.
create table public.team_circuits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 30),
  name_key text generated always as (lower(trim(name))) stored unique,
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  position int not null,
  v_min smallint check (v_min between 0 and 17),
  v_max smallint check (v_max between 0 and 17 and v_max >= v_min)   -- null = open-ended (V11+)
);
insert into public.team_circuits (name, color, position, v_min, v_max) values
  ('Yellow', '#F2C832', 1, 0, 0),
  ('Red',    '#E0413A', 2, 0, 2),
  ('Green',  '#6BB36B', 3, 1, 3),
  ('Purple', '#7B4FB0', 4, 2, 4),
  ('Orange', '#F07A2E', 5, 3, 5),
  ('Black',  '#3A3A3A', 6, 4, 6),
  ('Blue',   '#1F6FC4', 7, 5, 7),
  ('Pink',   '#E0457B', 8, 6, 8),
  ('White',  '#F4F4F4', 9, 8, 10),
  ('Mint',   '#A8DCD1', 10, 11, null);

-- What coaches rate 1–5 on a check-in. Admins edit the list; hiding one (active = false) keeps old ratings.
create table public.team_rating_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  name_key text generated always as (lower(trim(name))) stored unique,
  position int not null,
  active boolean not null default true
);
insert into public.team_rating_areas (name, position) values
  ('Technique', 1), ('Strength', 2), ('Endurance', 3), ('Mental Game', 4), ('Footwork', 5);

-- A check-in: a snapshot of a member on a day, whenever the coach wants (monthly, per season, yearly).
-- Every grade is optional. V grades are 0–17. Board angles are degrees. ratings = {"<rating area id>": 1..5}.
create table public.team_checkins (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  checkin_date date not null default current_date,
  circuit_id uuid references public.team_circuits (id) on delete restrict,
  tb2_grade smallint check (tb2_grade between 0 and 17),
  tb2_angle smallint check (tb2_angle between 0 and 70),
  kilter_grade smallint check (kilter_grade between 0 and 17),
  kilter_angle smallint check (kilter_angle between 0 and 70),
  boulder_grade smallint check (boulder_grade between 0 and 17),   -- outdoors or another gym
  route_grade text check (route_grade in ('5.5', '5.6', '5.7', '5.8', '5.9',
    '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d',
    '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b', '5.15c', '5.15d')),
  ratings jsonb not null default '{}' check (jsonb_typeof(ratings) = 'object'),
  notes text not null default '',
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.team_checkins (member_id, checkin_date desc);

-- The calendar. location_id null = every location (only admins add those).
-- kind: competition, practice (an agenda: what to work on that day), open_house, other.
create table public.team_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.team_locations (id) on delete cascade,
  kind text not null default 'other' check (kind in ('competition', 'practice', 'open_house', 'other')),
  title text not null check (length(trim(title)) between 1 and 120),
  event_date date not null,
  end_date date check (end_date >= event_date),   -- a comp over several days; null = one day
  start_time time,                                 -- null = all day
  end_time time check (end_time > start_time),
  place text not null default '' check (length(place) <= 200),
  notes text not null default '',
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.team_events (location_id, event_date);
create index on public.team_events (event_date) where location_id is null;

-- 2. Helpers (security definer so the rules below don't loop on themselves) --

create function public.team_my_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.team_staff where email = lower(auth.jwt() ->> 'email');
$$;

create function public.team_my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select roles from public.team_staff where email = lower(auth.jwt() ->> 'email');
$$;

create function public.team_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_staff where email = lower(auth.jwt() ->> 'email'));
$$;

create function public.team_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_staff where email = lower(auth.jwt() ->> 'email') and 'admin' = any (roles));
$$;

-- An admin, or a coach assigned to this location.
create function public.team_can_location(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.team_is_admin() or exists (
    select 1 from public.team_staff_locations sl join public.team_staff s on s.id = sl.staff_id
    where sl.location_id = p and s.email = lower(auth.jwt() ->> 'email') and 'coach' = any (s.roles)
  );
$$;

create function public.team_can_member(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.team_can_location((select location_id from public.team_members where id = p));
$$;

-- Admins' Staff page: every staff member plus when they last signed in (Active vs Invited).
create function public.team_staff_list()
returns table (id uuid, email text, first_name text, last_name text, name text, pronouns text, roles text[],
               invited_at timestamptz, owner boolean, last_sign_in_at timestamptz, location_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select s.id, s.email, s.first_name, s.last_name, s.name, s.pronouns, s.roles, s.invited_at, s.owner, u.last_sign_in_at,
         coalesce(array(select location_id from public.team_staff_locations where staff_id = s.id), '{}')
  from public.team_staff s left join auth.users u on lower(u.email) = s.email
  where public.team_is_admin()
  order by s.name, s.email;
$$;

-- Emails are shared with Sit Start: the templates switch to Top Out wording when the login's data has app = topout.
-- Supabase ignores a link's data for a login that already exists, so the page stamps it here before each send
-- (Sit Start's stamp_sender sets it back to sitstart).
create function public.team_stamp_sender(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  sender text;
begin
  select first_name into sender from public.team_staff where email = lower(auth.jwt() ->> 'email');
  if sender is null then raise exception 'Only Top Out staff can send sign-in links.'; end if;
  update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'email_changed_to')
    || jsonb_build_object('sent_by', sender, 'app', 'topout', 'staff', true)
  where lower(email) = lower(trim(p_email));
end;
$$;

-- 3. Triggers ----------------------------------------------------------------

-- Notes, check-ins and events are signed with the writer's name, taken from their own staff row, and kept fixed
-- on update (with created_at). edited_at is set on any change.
create function public.team_stamp_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    new.edited_at := now();
  else
    new.author_id := auth.uid();
    new.author_name := coalesce((select nullif(name, '') from public.team_staff
                                 where email = lower(auth.jwt() ->> 'email')), '');
    new.created_at := now();
    new.edited_at := null;
  end if;
  return new;
end;
$$;
create trigger team_stamp_author before insert or update on public.team_coach_notes
  for each row execute function public.team_stamp_author();
create trigger team_stamp_author before insert or update on public.team_checkins
  for each row execute function public.team_stamp_author();
create trigger team_stamp_author before insert or update on public.team_events
  for each row execute function public.team_stamp_author();

-- There must always be an admin, so nobody locks everyone out of the Staff page.
create function public.team_keep_an_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.team_staff where 'admin' = any (roles)) then
    raise exception 'There must always be at least one admin.';
  end if;
  return null;
end;
$$;
create trigger team_keep_an_admin after update or delete on public.team_staff
  for each statement execute function public.team_keep_an_admin();

-- The owner (set in the SQL Editor) always keeps Admin and their email, and can't be removed by anyone else.
-- Nobody changes the owner flag from the page, and nobody removes themselves.
create function public.team_protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(auth.jwt() ->> 'email');
begin
  if me is null then return coalesce(new, old); end if;   -- the SQL Editor
  if tg_op = 'DELETE' then
    if old.owner then raise exception 'The owner can''t be removed.'; end if;
    if old.email = me then raise exception 'You can''t remove yourself.'; end if;
    return old;
  end if;
  if new.owner is distinct from old.owner then raise exception 'The owner is set in the SQL Editor.'; end if;
  if old.owner and (new.email <> old.email or not ('admin' = any (new.roles))) then
    raise exception 'The owner keeps their email and the Admin role.';
  end if;
  if old.owner and old.email <> me and new.roles is distinct from old.roles then
    raise exception 'Only the owner changes their own roles.';
  end if;
  return new;
end;
$$;
create trigger team_protect_owner before update or delete on public.team_staff
  for each row execute function public.team_protect_owner();

-- A rating area that a check-in uses can be hidden but not deleted.
create function public.team_area_in_use() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.team_checkins where ratings ? old.id::text) then
    raise exception 'Check-ins use this rating area. Hide it instead.';
  end if;
  return old;
end;
$$;
create trigger team_area_in_use before delete on public.team_rating_areas
  for each row execute function public.team_area_in_use();

-- A goal's done_at is the day it left current (the page can change it for an achieved goal).
create function public.team_goal_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'current' then new.done_at := null;
  elsif new.done_at is null then new.done_at := current_date;
  end if;
  return new;
end;
$$;
create trigger team_goal_done before insert or update on public.team_goals
  for each row execute function public.team_goal_done();

-- 4. Row-level security -------------------------------------------------------
-- Helpers that don't depend on the row are wrapped in (select ...) so they run once per query.

alter table public.team_staff enable row level security;
alter table public.team_locations enable row level security;
alter table public.team_staff_locations enable row level security;
alter table public.team_members enable row level security;
alter table public.team_goals enable row level security;
alter table public.team_coach_notes enable row level security;
alter table public.team_circuits enable row level security;
alter table public.team_rating_areas enable row level security;
alter table public.team_checkins enable row level security;
alter table public.team_events enable row level security;

-- Staff read each other (coworkers' names); admins change them.
create policy "staff: read" on public.team_staff for select to authenticated using ((select public.team_is_staff()));
create policy "admin: add" on public.team_staff for insert to authenticated with check ((select public.team_is_admin()));
create policy "admin: change" on public.team_staff for update to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));
create policy "admin: remove" on public.team_staff for delete to authenticated using ((select public.team_is_admin()));

create policy "staff: read" on public.team_staff_locations for select to authenticated using ((select public.team_is_staff()));
create policy "admin: everything" on public.team_staff_locations for all to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));

-- Coaches see only their locations; admins see and manage all.
create policy "staff: read" on public.team_locations for select to authenticated using (public.team_can_location(id));
create policy "admin: everything" on public.team_locations for all to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));

-- Members: anyone who can see the location. Moving one needs both the old and the new location.
create policy "staff: everything" on public.team_members for all to authenticated
  using (public.team_can_location(location_id)) with check (public.team_can_location(location_id));

create policy "staff: everything" on public.team_goals for all to authenticated
  using (public.team_can_member(member_id)) with check (public.team_can_member(member_id));

-- Coach Notes and check-ins: anyone at the location reads and adds; the author or an admin edits or deletes.
create policy "staff: read" on public.team_coach_notes for select to authenticated using (public.team_can_member(member_id));
create policy "staff: add" on public.team_coach_notes for insert to authenticated with check (public.team_can_member(member_id));
create policy "author: change" on public.team_coach_notes for update to authenticated
  using (public.team_can_member(member_id) and (author_id = (select auth.uid()) or (select public.team_is_admin())))
  with check (public.team_can_member(member_id));
create policy "author: delete" on public.team_coach_notes for delete to authenticated
  using (public.team_can_member(member_id) and (author_id = (select auth.uid()) or (select public.team_is_admin())));

create policy "staff: read" on public.team_checkins for select to authenticated using (public.team_can_member(member_id));
create policy "staff: add" on public.team_checkins for insert to authenticated with check (public.team_can_member(member_id));
create policy "author: change" on public.team_checkins for update to authenticated
  using (public.team_can_member(member_id) and (author_id = (select auth.uid()) or (select public.team_is_admin())))
  with check (public.team_can_member(member_id));
create policy "author: delete" on public.team_checkins for delete to authenticated
  using (public.team_can_member(member_id) and (author_id = (select auth.uid()) or (select public.team_is_admin())));

create policy "staff: read" on public.team_circuits for select to authenticated using ((select public.team_is_staff()));
create policy "admin: everything" on public.team_circuits for all to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));
create policy "staff: read" on public.team_rating_areas for select to authenticated using ((select public.team_is_staff()));
create policy "admin: everything" on public.team_rating_areas for all to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));

-- Calendar: a location's staff read and write its events; everyone reads all-location events, admins write them.
create policy "staff: read" on public.team_events for select to authenticated
  using ((location_id is null and (select public.team_is_staff())) or public.team_can_location(location_id));
create policy "staff: write" on public.team_events for all to authenticated
  using ((select public.team_is_admin()) or (location_id is not null and public.team_can_location(location_id)))
  with check ((select public.team_is_admin()) or (location_id is not null and public.team_can_location(location_id)));

-- 5. Shared logins with Sit Start ----------------------------------------------
-- Sit Start's gate_signup, delete_student, delete_staff and staff_deactivated ask login_in_other_app() before
-- refusing a sign-up or removing a login (see sitstart/supabase/migrations/2026-09-30-shared-logins.sql).
-- Top Out answers for its staff, so a Top Out coach can create a login, and Sit Start never deletes it.
create or replace function public.login_in_other_app(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_staff where email = lower(trim(p_email)));
$$;

-- 6. Nothing here needs the anonymous (signed-out) role.
revoke execute on function public.team_my_id(), public.team_my_roles(), public.team_is_staff(), public.team_is_admin(),
  public.team_can_location(uuid), public.team_can_member(uuid), public.team_staff_list(), public.team_stamp_sender(text)
  from public, anon;
grant execute on function public.team_my_id(), public.team_my_roles(), public.team_is_staff(), public.team_is_admin(),
  public.team_can_location(uuid), public.team_can_member(uuid), public.team_staff_list(), public.team_stamp_sender(text)
  to authenticated;

-- 7. The two starting locations.
insert into public.team_locations (name, position) values ('Minneapolis', 1), ('St. Paul', 2);

-- 8. Make yourself an admin, a coach and the owner. Change this to the email you'll sign in with.
insert into public.team_staff (email, roles, owner) values (lower('you@example.com'), '{admin,coach}', true);
