-- Names and pronouns stay the same in both apps: saving a person's name or pronouns in Sit Start (staff or student)
-- or Top Out (staff) copies them to their other rows with the same email.
begin;

-- One person, one name. Sit Start's staff and students and Top Out's team_staff rows with the same email share their
-- first name, last name and pronouns. A row that newly gets an email someone already has (added, or an email set on a
-- student made by name first), or one saved with no first name, takes the name and pronouns the others have. After
-- that, changing them on any row copies them to the others (the last save wins).
create function public.person_pull() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  src record;
begin
  if new.email is null then return new; end if;
  if tg_op = 'UPDATE' and new.email is not distinct from old.email and new.first_name <> '' then return new; end if;
  select x.first_name, x.last_name, x.pronouns into src from (
    select s.first_name, s.last_name, s.pronouns, 1 as k from public.staff s where s.email = new.email
      and not (tg_table_name = 'staff' and s.id = new.id)
    union all select t.first_name, t.last_name, t.pronouns, 2 from public.team_staff t where t.email = new.email
      and not (tg_table_name = 'team_staff' and t.id = new.id)
    union all select st.first_name, st.last_name, st.pronouns, 3 from public.students st where st.email = new.email
      and not (tg_table_name = 'students' and st.id = new.id)
  ) x where x.first_name <> '' order by x.k limit 1;
  if found then new.first_name := src.first_name; new.last_name := src.last_name; new.pronouns := src.pronouns; end if;
  return new;
end;
$$;

create function public.person_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or new.first_name = '' then return null; end if;
  -- Only rows that differ, so the copies' own triggers stop at once.
  update public.staff set first_name = new.first_name, last_name = new.last_name, pronouns = new.pronouns
    where email = new.email and (first_name, last_name, pronouns) is distinct from (new.first_name, new.last_name, new.pronouns);
  update public.team_staff set first_name = new.first_name, last_name = new.last_name, pronouns = new.pronouns
    where email = new.email and (first_name, last_name, pronouns) is distinct from (new.first_name, new.last_name, new.pronouns);
  update public.students set first_name = new.first_name, last_name = new.last_name, pronouns = new.pronouns
    where email = new.email and (first_name, last_name, pronouns) is distinct from (new.first_name, new.last_name, new.pronouns);
  return null;
end;
$$;

create trigger person_pull before insert or update of email, first_name on public.staff
  for each row execute function public.person_pull();
create trigger person_pull before insert or update of email, first_name on public.team_staff
  for each row execute function public.person_pull();
create trigger person_pull before insert or update of email, first_name on public.students
  for each row execute function public.person_pull();
create trigger person_push after insert or update of email, first_name, last_name, pronouns on public.staff
  for each row execute function public.person_push();
create trigger person_push after insert or update of email, first_name, last_name, pronouns on public.team_staff
  for each row execute function public.person_push();
create trigger person_push after insert or update of email, first_name, last_name, pronouns on public.students
  for each row execute function public.person_push();
revoke execute on function public.person_pull(), public.person_push() from public, anon, authenticated;

commit;
