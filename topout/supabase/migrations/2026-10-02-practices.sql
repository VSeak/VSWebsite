-- Practices: practice plans every coach shares (like Sit Start's Exercises & Drills), each a list of timed blocks.
-- A practice on the calendar can link to one. Run once in the SQL Editor.
begin;

-- blocks: [{id, title, minutes, notes}] in order, every field optional. area_ids: the Areas it works on (to filter by).
create table public.team_practices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  summary text not null default '',
  area_ids uuid[] not null default '{}',
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create trigger team_stamp_author before insert or update on public.team_practices
  for each row execute function public.team_stamp_author();
alter table public.team_practices enable row level security;
-- Shared: every staff member reads, adds, changes and deletes them, wherever they coach.
create policy "staff: everything" on public.team_practices for all to authenticated
  using ((select public.team_is_staff())) with check ((select public.team_is_staff()));

alter table public.team_events add column practice_id uuid references public.team_practices (id) on delete set null;

-- A deleted area comes off practices too.
create or replace function public.team_area_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text := old.id::text;
begin
  update public.team_checkins c set
    ratings = c.ratings - k,
    coach_ratings = c.coach_ratings - k,
    tags = coalesce((select jsonb_object_agg(e.key, e.value - k) from jsonb_each(c.tags) e
                     where jsonb_array_length(e.value - k) > 0), '{}')
  where c.ratings ? k or c.coach_ratings ? k or exists (select 1 from jsonb_each(c.tags) e where e.value ? k);
  update public.team_focus set area_ids = array_remove(area_ids, old.id) where old.id = any (area_ids);
  update public.team_practices set area_ids = array_remove(area_ids, old.id) where old.id = any (area_ids);
  return old;
end;
$$;

commit;
