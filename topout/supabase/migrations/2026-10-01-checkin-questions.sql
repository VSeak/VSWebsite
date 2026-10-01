-- Check-ins get the coach's conversation and a second set of ratings, and each location gets a Team Focus.
--   Areas (team_rating_areas): a group (physical / skill / mental), rated or tag only, and a description for each
--     number 1-5 so coaches rate the same way.
--   Questions (team_checkin_questions): what a coach asks at a check-in. Admins edit them. tags = the answer can be
--     tagged with areas (Want to Improve).
--   Check-ins: ratings is now the member's own rating; coach_ratings is the coach's. answers = {question id: text},
--     tags = {question id: [area ids]}.
--   Team Focus (team_focus): what a location's team works on, written by its coaches from the check-ins.
begin;

-- 1. Areas -------------------------------------------------------------------
alter table public.team_rating_areas
  add column area_group text not null default 'skill' check (area_group in ('physical', 'skill', 'mental')),
  add column rated boolean not null default true,
  add column guide text[] not null default '{}' check (cardinality(guide) in (0, 5));

update public.team_rating_areas set area_group = 'physical' where name_key in ('strength', 'endurance');
update public.team_rating_areas set area_group = 'mental' where name_key = 'mental game';
update public.team_rating_areas set guide = array[
  'Climbs mostly with arms; moves feel stiff or random.',
  'Knows basic moves (flagging, drop knees) but uses them only on easy climbs.',
  'Picks the right move on most climbs at their level; smooth on familiar styles.',
  'Adapts to new styles and harder climbs; rarely wastes a move.',
  'Reads and climbs efficiently in any style; others copy their beta.'] where name_key = 'technique';
update public.team_rating_areas set guide = array[
  'Struggles to hold small edges or pull through steep moves.',
  'Holds good edges; steep or crimpy climbs at their level shut them down.',
  'Strength matches their grade; rarely the main reason they fall.',
  'Strength lets them try climbs above their grade; strong on the boards.',
  'Powerful on any angle and hold type.'] where name_key = 'strength';
update public.team_rating_areas set guide = array[
  'Pumped or tired after a few climbs; needs long rests.',
  'Lasts part of a session; quality drops off fast.',
  'Climbs a full session at a steady level; recovers between tries.',
  'Stays strong through long sessions and long problems.',
  'Barely fades; many hard tries in a session or a comp round.'] where name_key = 'endurance';
update public.team_rating_areas set guide = array[
  'Hesitates or backs off when scared, pumped or watched.',
  'Commits on familiar climbs; nerves or a fall throw them off.',
  'Commits on most climbs at their level; bounces back after falls.',
  'Calm and focused at their limit, in comps and on scary moves.',
  'Thrives under pressure; makes good decisions when it counts.'] where name_key = 'mental game';
update public.team_rating_areas set guide = array[
  'Feet cut or scrape often; looks at hands, not feet.',
  'Places feet, but often readjusts or misses small holds.',
  'Precise on most holds; quiet feet on easier climbs.',
  'Precise on small holds at their limit; heel and toe hooks when needed.',
  'Feet drive the climbing; finds and uses footholds others miss.'] where name_key = 'footwork';

-- Tag only: things members want to work on that nobody rates.
insert into public.team_rating_areas (name, position, area_group, rated)
select v.name, (select coalesce(max(position), 0) from public.team_rating_areas) + v.n, v.area_group, false
from (values ('Flexibility', 1, 'physical'), ('Volume', 2, 'skill'), ('Comp Prep', 3, 'mental')) v (name, n, area_group)
on conflict (name_key) do nothing;

-- 2. Questions ---------------------------------------------------------------
create table public.team_checkin_questions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (length(trim(prompt)) between 1 and 80),
  hint text not null default '' check (length(hint) <= 120),   -- the example shown in the empty box
  position int not null,
  active boolean not null default true,
  tags boolean not null default false
);
insert into public.team_checkin_questions (prompt, hint, position, tags) values
  ('Proud Of', 'E.g. sent their first Black, stuck with the board all winter', 1, false),
  ('Want to Improve', 'E.g. slab feet, trusting high steps, finishing sessions strong', 2, true),
  ('Competition Thoughts', 'E.g. how Boulderfest went and how they felt about it', 3, false);

alter table public.team_checkin_questions enable row level security;
create policy "staff: read" on public.team_checkin_questions for select to authenticated using ((select public.team_is_staff()));
create policy "admin: everything" on public.team_checkin_questions for all to authenticated
  using ((select public.team_is_admin())) with check ((select public.team_is_admin()));

-- 3. Check-ins ---------------------------------------------------------------
alter table public.team_checkins
  add column coach_ratings jsonb not null default '{}' check (jsonb_typeof(coach_ratings) = 'object'),
  add column answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  add column tags jsonb not null default '{}' check (jsonb_typeof(tags) = 'object');

-- An area a check-in uses (either rating or a tag) can be hidden but not deleted. Same for a question with answers.
create or replace function public.team_area_in_use() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.team_checkins c
             where c.ratings ? old.id::text or c.coach_ratings ? old.id::text
                or exists (select 1 from jsonb_each(c.tags) t where t.value ? old.id::text)) then
    raise exception 'Check-ins use this area. Hide it instead.';
  end if;
  return old;
end;
$$;

create function public.team_question_in_use() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.team_checkins where answers ? old.id::text or tags ? old.id::text) then
    raise exception 'Check-ins have answers to this question. Hide it instead.';
  end if;
  return old;
end;
$$;
create trigger team_question_in_use before delete on public.team_checkin_questions
  for each row execute function public.team_question_in_use();

-- 4. Team Focus --------------------------------------------------------------
-- Dated, so earlier ones stay as history. Any coach at the location writes and changes them (signed by the first writer).
create table public.team_focus (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.team_locations (id) on delete cascade,
  focus_date date not null default current_date,
  body text not null check (length(trim(body)) > 0),
  area_ids uuid[] not null default '{}',
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.team_focus (location_id, focus_date desc);
create trigger team_stamp_author before insert or update on public.team_focus
  for each row execute function public.team_stamp_author();

alter table public.team_focus enable row level security;
create policy "staff: everything" on public.team_focus for all to authenticated
  using (public.team_can_location(location_id)) with check (public.team_can_location(location_id));

commit;
