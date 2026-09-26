# Bouldering Coaching

A personal site for a bouldering coach. The coach (admin) signs in to manage students and write their training plans. Each student signs in to see only their own plans and leave notes on sessions.

## How it's built

- One page: `index.html`, with HTML, CSS and plain JavaScript inline. No build step. supabase-js v2 comes from jsDelivr, fonts from Google Fonts.
- Backend: Supabase (auth + Postgres). `supabase/schema.sql` creates everything. Setup steps are in `SETUP.md`. `CONFIG` at the top of the script holds the project URL and publishable key.
- **Security is in the database, not the page.** Row-level security in `schema.sql` decides what each user can read or write. Any new table needs RLS and policies. The page never holds the secret key.
- Serve it over http (`npx serve .`), since sign-in links need a real address.

## Accounts

- Coach = an email in `public.admins` (no API access to that table). `is_admin()` checks the signed-in email.
- Students are added by name first (`email` and `invited_at` start empty), so the coach can build their plan before inviting. The Account card on the student page saves the email, calls `signInWithOtp` to email a link, then sets `invited_at`. The list shows Not Invited, Invited or Active. The `gate_signup` trigger on `auth.users` refuses any sign-up whose email isn't in `students` or `admins`, so sign-ups can stay enabled.
- **Delete Student** calls `delete_student()`, which removes the row and the matching `auth.users` login (never a coach's). Without that, re-adding the email would find the old login: Supabase sends the Magic Link email instead of Confirm signup, and the old password stays.
- Only the coach sends links: the invite, or Send Sign-In Link for a student who forgot their password. The sign-in page has no "email me a link" form, on purpose, so nobody can trigger emails from it.
- Links go through `mailer`, a second client with no stored session, so sending one never touches the coach's session. Both clients use the implicit flow, so a link works on any device.
- Links redirect to `CONFIG.siteUrl` (the live site, so links sent from localhost still work on a phone), or the current address if it is empty, plus `?setpw=1`. After sign-in, `claim_student()` links the account to the student row (`students.user_id`). A student without `user_metadata.password_set` is sent to "Choose a Password".

## Data

- `students(id, first_name, last_name, name, email, goal, invited_at, user_id)`: `name` is generated from first + last (read it for display; write the two parts). First and last are separate so a first name with a space greets correctly. `email` is null until the coach adds it.
- `plans(id, student_id, title, overview, start_date, active)`: `active` = current plan. A student with exactly one current plan sees it straight away.
- `sessions(id, plan_id, week, position, title, details, exercises)`: `exercises` is JSON `[{name, sets, reps, rest, notes}]`.
- `notes(id, session_id, author_id, from_coach, body)`: students can add and delete their own. The coach can do anything.

## Pages (hash routes, `route()`)

- Coach: `#/` students + add student + latest student notes; `#/student/<id>` details, plans, account; `#/plan/<id>` plan editor.
- Student: `#/` their current plan (or a list); `#/plan/<id>` one plan.
- The plan editor keeps a `draft` and saves on **Save Plan** (upserts sessions, deletes removed ones). Session ids are made in the browser so notes stay attached. `dirty` drives the leave check (`onHashChange`, `beforeunload`, Sign Out). **Student View** previews the draft.

## Conventions

- Colors are tokens on `:root`, with dark mode under `prefers-color-scheme` and `[data-theme]`. Don't hard-code colors.
- Fonts: Space Grotesk for headings, Inter for body text.
- Must work at phone width (~400px). Exercise tables become stacked cards under 600px.
- Buttons, headings and labels use title case; hints and messages use sentence case.
- Confirmations use `ask()` (one `<dialog>`), which settles on submit.
