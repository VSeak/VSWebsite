-- A student has at most one current plan. Making a plan current (new or saved)
-- turns their other current plan into a past plan. No current plan is fine.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

-- New plans start as past plans; the page makes the first one current.
alter table public.plans alter column active set default false;

-- Students who already have several current plans keep only the latest one.
update public.plans p set active = false
where p.active and exists (
  select 1 from public.plans q
  where q.student_id = p.student_id and q.active and q.id <> p.id
    and (q.updated_at, q.id) > (p.updated_at, p.id)
);

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

-- A backstop in case anything gets past the trigger.
create unique index plans_one_current on public.plans (student_id) where active;
