-- Coach Notes: private notes a coach keeps on a student, on the student page. A note with a session_date is
-- notes from that session; without one it is a general note. Only staff with the Coach role can see them:
-- students and admin-only staff have no policy. Any coach can add, edit or delete any note, like goals.
-- The stamp_coach_note trigger writes the author's name on insert (kept if that coach is later removed)
-- and edited_at on each change to the text or date.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  author_name text not null default '',
  session_date date,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.coach_notes (student_id);

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

alter table public.coach_notes enable row level security;
grant select, insert, update, delete on public.coach_notes to authenticated;

create policy "coach: everything" on public.coach_notes for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
