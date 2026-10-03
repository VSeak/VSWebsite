-- Error log for every app on this Supabase project (Sit Start, Top Out). Run once in the SQL Editor.
-- Each app's core.js (logError) adds a row for an unexpected error or a server call that took over 4 seconds,
-- so problems show up without anyone reporting them. Nobody can read the rows from an app (no select policy):
-- the owner looks in Table Editor → app_errors. Delete old rows there whenever you like.
begin;

create table public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  app text not null check (app in ('sitstart', 'topout')),
  kind text not null check (kind in ('error', 'slow')),
  message text not null check (length(message) <= 1000),
  detail text not null default '' check (length(detail) <= 4000),   -- stack trace, or how long a slow call took
  page text not null default '' check (length(page) <= 300),        -- the page's #/ address
  user_agent text not null default '' check (length(user_agent) <= 300),
  user_id uuid default auth.uid()                                     -- null when signed out
);
create index on public.app_errors (created_at desc);

alter table public.app_errors enable row level security;
-- Anyone can add a row (errors on the sign-in page count too), only as themselves. No read, change or delete.
create policy "anyone: add" on public.app_errors for insert to anon, authenticated
  with check (user_id is not distinct from (select auth.uid()));
grant insert on public.app_errors to anon, authenticated;

commit;
