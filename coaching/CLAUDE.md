# Bouldering Coaching

A personal site for a bouldering coach. Coaches sign in to manage students and write their training plans. Each student signs in to see only their own plans and leave notes on sessions.

## How it's built

- One page: `index.html`, with HTML, CSS and plain JavaScript inline. No build step. supabase-js v2 comes from jsDelivr, fonts from Google Fonts.
- Backend: Supabase (auth + Postgres). `supabase/schema.sql` creates everything. Setup steps are in `SETUP.md`. `CONFIG` at the top of the script holds the project URL and publishable key.
- **Security is in the database, not the page.** Row-level security in `schema.sql` decides what each user can read or write. Any new table needs RLS and policies. The page never holds the secret key.
- Serve it over http (`npx serve .`), since sign-in links need a real address.

## Accounts

- Staff = a row in `public.staff` (matched by the signed-in email) with `roles`, a set of separate roles: `coach` (students, plans, goals, notes) and `admin` (the Users page: every user, staff and students). One person can have both. `my_roles()` returns them; RLS uses `is_coach()` and `is_admin()`. Admins can edit students' rows (details, invites) but not plans or goals. The `keep_an_admin` trigger refuses any change that leaves no admin, and the page won't let you remove your own Admin role. To add a role: allow it in the `staff.roles` check, then add it to `ROLE_LABEL`, `ROLE_PLURAL`, `ROLE_HINT` and `STAFF_ROLES`.
- Staff are added on the Users page (Add Staff sends the invite straight away). `delete_staff()` removes the row and their login (kept if they are also a student). Staff invites pass `staff: true` in the login's data, and both emails switch to staff wording with `{{ if .Data.staff }}`.
- Students are added by name first (`email` and `invited_at` start empty), so the coach can build their plan before inviting. The Account card on the student page saves the email, calls `signInWithOtp` to email a link, then sets `invited_at`. The list shows Not Invited, Invited or Active. The `gate_signup` trigger on `auth.users` refuses any sign-up whose email isn't in `students` or `staff`, so sign-ups can stay enabled.
- **Delete Student** calls `delete_student()`, which removes the row and the matching `auth.users` login (never a staff member's). Without that, re-adding the email would find the old login: Supabase sends the Magic Link email instead of Confirm signup, and the old password stays.
- Only staff send links: the invite, or Send Sign-In Link for a student who forgot their password. The sign-in page has no "email me a link" form, on purpose, so nobody can trigger emails from it.
- Links go through `mailer`, a second client with no stored session, so sending one never touches the coach's session. Both clients use the implicit flow, so a link works on any device.
- Links redirect to `CONFIG.siteUrl` (the live site, so links sent from localhost still work on a phone), or the current address if it is empty, plus `?setpw=1`. After sign-in, `claim_student()` links the account to the student row (`students.user_id`). A student without `user_metadata.password_set` is sent to "Choose a Password".

## Data

- `staff(id, email, first_name, last_name, name, roles, invited_at)`: `roles` is a text array (`{admin,coach}`, at least one). Only admins can read it. The Users page reads everyone through `list_users()`, which adds `last_sign_in_at` from `auth.users` for the Active status.
- `students(id, first_name, last_name, name, email, invited_at, user_id)`: `name` is generated from first + last (read it for display; write the two parts). First and last are separate so a first name with a space greets correctly. `email` is null until the coach adds it.
- `plans(id, student_id, title, overview, start_date, active)`: `active` = current plan. A student has at most one: the `one_current_plan` trigger turns their other current plan into a past plan (a unique index backs it up), and none is allowed. New and copied plans are current only if the student has none yet. A student with a current plan sees it straight away.
- `sessions(id, plan_id, week, position, title, details, exercises)`: `exercises` is JSON `[{name, sets, reps, rest, notes}]`.
- `goals(id, student_id, body, status, done_at)`: `status` is `current`, `achieved` or `archived`; `done_at` is when it left `current`. The coach adds, edits, marks achieved, archives, restores and deletes them on the student page (the Goals card re-renders in place). Students see current goals at the top of their home page and a Goals Achieved card at the bottom; RLS hides archived goals from them.
- `notes(id, session_id, author_id, from_coach, body)`: students can add and delete their own. The coach can do anything.

## Pages (hash routes, `route()`)

- Staff: `#/` Coach Home (Admin Home for admin-only staff), one tile per page from `ADMIN_PAGES`, shown by `role` (add a new page there and in `route()`, which also checks the role). Coach pages: `#/students` students + add student + latest student notes; `#/student/<id>` plans, goals, details, account; `#/plan/<id>` plan editor. Admin pages: `#/users` everyone from `list_users()` with search, a role filter and Add Staff; `#/user/<id>` any user's details, roles (staff) and account (invite, sign-in link, Remove Access or Delete Student).
- Student: `#/` their goals and current plan (or a list), then achieved goals; `#/plan/<id>` one plan.
- The plan editor keeps a `draft` and saves on **Save Plan** (upserts sessions, deletes removed ones). Saving needs a title, a start date and at least one session. New plans start with an empty title (lists show "Untitled Plan" until it is saved). Session ids are made in the browser so notes stay attached. `dirty` drives the leave check (`onHashChange`, `beforeunload`, Sign Out). **Student View** previews the draft.

## Conventions

- Colors are tokens on `:root`, with dark mode under `prefers-color-scheme` and `[data-theme]`. Don't hard-code colors.
- Fonts: Space Grotesk for headings, Inter for body text.
- Must work at phone width (~400px). Exercise tables become stacked cards under 600px.
- Buttons, headings and labels use title case; hints and messages use sentence case.
- Confirmations use `ask()` (one `<dialog>`), which settles on submit.
