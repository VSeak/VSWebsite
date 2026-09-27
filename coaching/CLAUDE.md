# Bouldering Coaching

A personal site for a bouldering coach. Coaches sign in to manage students and write their training plans. Each student signs in to see only their own plans and leave notes on sessions.

## How it's built

- One page: `index.html`, with HTML, CSS and plain JavaScript inline. No build step. supabase-js v2 comes from jsDelivr, fonts from Google Fonts.
- Backend: Supabase (auth + Postgres). `supabase/schema.sql` creates everything. Setup steps are in `SETUP.md`. `CONFIG` at the top of the script holds the project URL and publishable key.
- **Security is in the database, not the page.** Row-level security in `schema.sql` decides what each user can read or write. Any new table needs RLS and policies. The page never holds the secret key.
- Serve it over http (`npx serve .`), since sign-in links need a real address.

## Accounts

- Staff = a row in `public.staff` (matched by the signed-in email) with `roles`, a set of separate roles: `coach` (students, plans, goals, notes) and `admin` (the Users page: every user, staff and students). One person can have both. `my_roles()` returns them; RLS uses `is_coach()` and `is_admin()`. Admins can edit students' rows (details, invites) but not plans or goals. The `keep_an_admin` trigger refuses any change that leaves no admin, and the page won't let you remove your own Admin role. To add a role: allow it in the `staff.roles` check, then add it to `ROLE_LABEL`, `ROLE_PLURAL`, `ROLE_HINT` and `STAFF_ROLES`.
- Staff are added on the Users page (Add Staff sends the invite straight away). `delete_staff()` removes the row and their login (kept if they are also a student). Staff invites pass `staff: true` in the login's data, and both emails switch to staff wording with `{{ if .Data.staff }}`. The staff invite signs off "Welcome aboard!" instead of "Happy training!".
- Students are added by name first (`email` and `invited_at` start empty), so the coach can build their plan before inviting. The Account card on the student page saves the email, calls `signInWithOtp` to email a link, then sets `invited_at`. The invite waits until the student has a saved plan (one with a title) and a goal: `gateInvite()` disables the button and says what is missing. The student page checks its own data (and re-checks as goals change); the Users page asks `student_ready()`, since admins can't read plans or goals. The list shows Not Invited, Invited or Active. The `gate_signup` trigger on `auth.users` refuses any sign-up whose email isn't in `students` or `staff`, so sign-ups can stay enabled.
- **Delete Student** calls `delete_student()`, which removes the row and the matching `auth.users` login (never a staff member's). Without that, re-adding the email would find the old login: Supabase sends the Magic Link email instead of Confirm signup, and the old password stays.
- Only staff send links: the invite, or Send Sign-In Link for a student who forgot their password. The sign-in page has no "email me a link" form, on purpose, so nobody can trigger emails from it.
- Links go through `mailer`, a second client with no stored session, so sending one never touches the coach's session. Both clients use the implicit flow, so a link works on any device.
- Links redirect to `CONFIG.siteUrl` (the live site, so links sent from localhost still work on a phone), or the current address if it is empty, plus `?setpw=1`. After sign-in, `claim_student()` links the account to the student row (`students.user_id`). A student without `user_metadata.password_set` is sent to "Choose a Password".

## Data

- `staff(id, email, first_name, last_name, name, roles, invited_at)`: `roles` is a text array (`{admin,coach}`, at least one). Admins can read every row; other staff only their own (for the home page greeting). The Users page reads everyone through `list_users()`, which adds `last_sign_in_at` from `auth.users` for the Active status.
- `students(id, first_name, last_name, name, email, invited_at, user_id)`: `name` is generated from first + last (read it for display; write the two parts). First and last are separate so a first name with a space greets correctly. `email` is null until the coach adds it.
- `plans(id, student_id, title, overview, start_date, active)`: `active` = current plan. A student has at most one: the `one_current_plan` trigger turns their other current plan into a past plan (a unique index backs it up), and none is allowed. New and copied plans are current only if the student has none yet. A student with a current plan sees it straight away.
- `sessions(id, plan_id, week, position, title, details, exercises)`: `exercises` is JSON `[{name, sets, reps, rest, notes}]`.
- `goals(id, student_id, body, status, done_at)`: `status` is `current`, `achieved` or `archived`; `done_at` is when it left `current`. The coach adds, edits, marks achieved, archives, restores and deletes them on the student page (the Goals card re-renders in place). Students see current goals at the top of their home page and a Goals Achieved card at the bottom; RLS hides archived goals from them.
- `notes(id, session_id, author_id, from_coach, body)`: students can add and delete their own. The coach can do anything.
- `exercises(id, name, name_key, sets, reps, rest, notes)`: the Master Exercise List. Coaches and admins can do everything; students have no policy, so they can't see it. `name_key` is generated (`lower(trim(name))`) and unique, so names don't repeat ignoring case. Plans copy the values, so editing a plan never changes the list and editing the list never changes a plan.

## Pages (hash routes, `route()`)

- Staff: `#/` Home, headed "Welcome <first name>!" (students get the same greeting), one tile per page from `ADMIN_PAGES`, shown to anyone with one of its `roles` (add a new page there and in `route()`, which also checks the role). Coach and admin: `#/exercises` the Master Exercise List (search, add, edit and delete in place). Coach pages: `#/students` students + add student + latest student notes; `#/student/<id>` plans, goals, details, account; `#/plan/<id>` plan editor. Admin pages: `#/users` everyone from `list_users()` with search, a role filter and Add Staff; `#/user/<id>` any user's details, roles (staff) and account (invite, sign-in link, Remove Access or Delete Student).
- Every page below Home starts with `crumbs()`: the full trail from Home plus a **Back** button to the page one level up. Both change the hash, so the plan editor's leave check still runs.
- Student: `#/` their goals and current plan (or a list), then achieved goals; `#/plan/<id>` one plan.
- The plan editor keeps a `draft` and saves on **Save Plan** (upserts sessions, deletes removed ones). Saving needs a title, a start date and at least one session. New plans start with an empty title (lists show "Untitled Plan" until it is saved). Session ids are made in the browser so notes stay attached. `dirty` drives the leave check (`onHashChange`, `beforeunload`, Sign Out). **Student View** previews the draft.
- Exercise names pick from the master list (`draft.library`) through `#exMenu`, a styled dropdown built in the page (not a `<datalist>`, whose popup looks like browser autofill). It shows names containing the typed text, with arrow keys, Enter and Escape. Typing or picking a listed name fills in its sets, reps, rest and notes (`setExName`). `filledFrom` remembers which name the values came from, so fixing a typo in the name doesn't wipe the coach's own values. Save Plan and Copy to a Student then call `addToMasterList()`, which adds names not on the list yet with the plan's values (upsert on `name_key`, ignoring ones that exist).

## Conventions

- Colors are tokens on `:root`, with dark mode under `prefers-color-scheme` and `[data-theme]`. Don't hard-code colors.
- Fonts: Space Grotesk for headings, Inter for body text.
- Must work at phone width (~400px). Exercise tables become stacked cards under 600px.
- Buttons, headings and labels use title case; hints and messages use sentence case.
- Confirmations use `ask()` (one `<dialog>`), which settles on submit.
