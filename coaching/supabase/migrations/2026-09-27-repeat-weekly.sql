-- A plan is either Repeat Weekly (one week of sessions, done every week) or Week by Week (week 1, week 2, ...).
-- New plans start as Repeat Weekly. The coach switches in the plan editor; students only see the result.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.plans add column repeats boolean not null default true;

-- Existing plans with more than one week stay Week by Week.
update public.plans p set repeats = false
where exists (select 1 from public.sessions s where s.plan_id = p.id and s.week > 1);
