-- Plan notes can be edited by whoever wrote them (a student or a coach). The note keeps its session, author,
-- side and time (nobody can move or re-sign a note), and edited_at is set when the text changes.
begin;

alter table public.notes add column edited_at timestamptz;

create or replace function public.stamp_note_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.author_name := old.author_name;
    new.author_id := old.author_id;
    new.from_coach := old.from_coach;
    new.session_id := old.session_id;
    new.created_at := old.created_at;
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  elsif new.from_coach then
    new.author_name := coalesce((select nullif(name, '') from public.staff where email = lower(auth.jwt() ->> 'email')), '');
  else
    new.author_name := '';
  end if;
  return new;
end;
$$;

create policy "author: edit own notes" on public.notes for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

commit;
