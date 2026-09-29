-- Goals keep the day they were achieved or archived, not the time of day.
-- Existing times become the day they fell on in Central time (the coach's zone).
alter table public.goals
  alter column done_at type date using (done_at at time zone 'America/Chicago')::date;
