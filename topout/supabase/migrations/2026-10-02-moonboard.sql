-- MoonBoard on a check-in: a V grade and the angle, like the Tension Board 2 and Kilter. Run once in the SQL Editor.

alter table public.team_checkins
  add column if not exists moon_grade smallint check (moon_grade between 0 and 17),
  add column if not exists moon_angle smallint check (moon_angle between 0 and 70);
