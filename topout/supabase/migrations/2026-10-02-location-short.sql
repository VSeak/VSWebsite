-- Location shorthand: what people at the gym call it (MBP, SPBP). Used on chips and short helper lines where a
-- shorthand reads better; '' = use the full name. Admins set it in Settings. Run once in the SQL Editor.
begin;

alter table public.team_locations
  add column if not exists short_name text not null default '' check (length(short_name) <= 10);

update public.team_locations set short_name = 'MBP' where name = 'Minneapolis' and short_name = '';
update public.team_locations set short_name = 'SPBP' where name = 'St. Paul' and short_name = '';

commit;
