-- A third plan layout, Training Blocks: the plan is split into blocks (e.g. 4 weeks of strength, then 3 of power),
-- each with its own sessions that repeat every week of the block. blocks = [{"name": "Strength", "weeks": 4}, ...]
-- in order; a session's week is its block's number (1, 2, ...). Null = Repeat Weekly or Week by Week (repeats).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (schema.sql already includes this for a fresh project.)

alter table public.plans add column blocks jsonb
  check (blocks is null or (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) between 1 and 52));
