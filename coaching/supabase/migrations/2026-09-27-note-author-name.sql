-- A coach's reply shows the coach's name instead of "Coach". Students can't read the staff table, so the name is
-- kept on the note. The stamp_note_author trigger sets it from the poster's own staff row, so nobody can post as
-- someone else, and the name stays if that coach is later removed. Student notes keep it empty.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.notes add column author_name text not null default '';

-- Existing coach replies get their author's name (before the trigger, which keeps the name fixed on update).
update public.notes n set author_name = s.name
from auth.users u join public.staff s on s.email = lower(u.email)
where n.from_coach and n.author_id = u.id and s.name <> '';

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
