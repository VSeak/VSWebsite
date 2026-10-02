-- Every circuit color and check-in question can be deleted (the user asked), like focus areas.
-- Deleting a circuit color clears it as the hardest circuit on the check-ins that used it.
-- Deleting a question takes its answers and tags off the check-ins that have them. Run once in the SQL Editor.
begin;

alter table public.team_checkins drop constraint team_checkins_circuit_id_fkey,
  add constraint team_checkins_circuit_id_fkey foreign key (circuit_id) references public.team_circuits (id) on delete set null;

drop trigger team_question_in_use on public.team_checkin_questions;
drop function public.team_question_in_use();

create function public.team_question_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text := old.id::text;
begin
  update public.team_checkins set answers = answers - k, tags = tags - k where answers ? k or tags ? k;
  return old;
end;
$$;
create trigger team_question_cleanup before delete on public.team_checkin_questions
  for each row execute function public.team_question_cleanup();

commit;
