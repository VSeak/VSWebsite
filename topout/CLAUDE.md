# Top Out (Adult Team)

Coaching for the gym's Adult Team, a group instead of one student at a time. Staff sign in; team members don't (yet). Each location (Minneapolis, St. Paul, more added by admins) has a roster and a calendar. Each member has an Intake, Goals, Coach Notes and Check-ins.

## How it's built

- Same shape as Sit Start: `index.html` (header and shell), `styles.css`, plain JS in `js/` loaded as classic `<script>` tags that share one global scope, in the order listed in `index.html`; `boot()` runs last. Don't declare the same top-level name in two files. No build step. supabase-js pinned from jsDelivr.
  - `core.js`: `CONFIG`, page state (`me`), helpers (`esc`, `para`, `flash`, `ask`, `busy`, `crumbs`, field errors), pronouns, dates, grades (`V_GRADES`, `ROUTE_GRADES`, `circuitRange`, `swatch`), `sendLink`.
  - `app.js`: `boot`, `loadMe`, `route`, the leave check and Unsaved marks, sign-in pages, Home (`homePage`), `eventRow` / `KINDS`.
  - `location.js`: `#/loc/<id>` (Team tab: members with chips, Active / Former, + Add Member).
  - `calendar.js`: `#/loc/<id>/calendar` (month grid, the picked day, Coming Up, the event dialogs).
  - `member.js`: `#/member/<id>` (Intake, Goals, Coach Notes, Details).
  - `checkins.js`: the Check-Ins card and its dialog.
  - `admin.js`: `#/staff` and `#/settings` (admins only).
- **Same Supabase project as Sit Start** (same URL and key in `CONFIG`). Tables are all `team_*`; `supabase/schema.sql` creates them. Security is in the database: every table checks `team_staff` through `team_is_staff()`, `team_is_admin()`, `team_can_location()` and `team_can_member()`, so a login that is only a Sit Start account signs in and sees nothing (the page shows "No Access").
- **Shared logins:** `auth.users` is shared. Sit Start's sign-up gate, Delete Student, Delete Staff and Deactivate call `login_in_other_app(email)`, which Top Out's schema defines (is the email on `team_staff`?), so Top Out staff can create a login and Sit Start never deletes or signs out one Top Out uses. Removing someone from Top Out staff keeps their login. Sign Out here is this device only (`scope: 'local'`).
- **Shared emails:** Supabase has one template per email for the project. `supabase-emails/build.sh` (repo root) joins `topout/supabase/emails/*.html` and `sitstart/supabase/emails/*.html` into `supabase-emails/*.html` with `{{ if .Data.topout }}`; those are what get pasted into Supabase. `sendLink` passes `topout: true` for a new login and `team_stamp_sender()` writes it (and `sent_by`) on an existing one; Sit Start's `stamp_sender()` sets it back to false.
- `redraw()` re-runs the route after a save, without the Loading step and keeping the scroll (`redrawing` in `view`). `navToken` stops a slow page drawing over a newer one.

## Accounts

- `team_staff(id, email, first_name, last_name, name, pronouns, roles, invited_at, owner)`: `roles` ⊆ {admin, coach}. Admins see every location, the Staff page and Settings. Coaches see the locations in `team_staff_locations(staff_id, location_id)`. The owner (set only in the SQL Editor) always keeps Admin and can't be removed (`team_protect_owner`); there is always an admin (`team_keep_an_admin`); nobody removes themselves or takes Admin off themselves.
- Staff page: + Add Staff inserts the row, ticks locations and sends the invite (`sendLink`, then `invited_at`). Typing an email Sit Start knows (`team_staff_lookup`, admins only: Sit Start staff, else students) fills in any empty name and pronoun fields (`watchLookup`, `setPronouns`), and if that login already has a password (`encrypted_password` set) there is no invite: they are added, `invited_at` is stamped, and they sign in with the password they have (the user asked for no password change). Sit Start's Add User does the same the other way, through `person_in_other_app()`, which this schema replaces to read `team_staff`. Clicking a person opens the same dialog to change name, roles and locations, Remove them, or use the Resend Invite / Email a Sign-In Link button (sends at once; the result shows in the dialog, since a flash would sit behind it; the user wanted a button, not a checkbox). Status: Active (has signed in), Invited, Not Invited.
- **One name everywhere:** `person_pull` / `person_push` triggers (this schema) keep first name, last name and pronouns the same on `staff`, `students` (Sit Start) and `team_staff` rows with the same email (the user asked for this). A row that newly gets an email someone already has, or has no first name, adopts the existing name; after that any change copies to the others (last save wins). `team_members` are not logins and are not synced.
- Sign-in pages copy Sit Start's: password sign-in, Forgot Password (same answer either way), Choose a Password after a link (`?setpw=1`).

## Data

- `team_locations(id, name, position)`: Home's cards in `position` order. A location with members can't be deleted (FK restrict).
- `team_members(id, location_id, first_name, last_name, name, pronouns, email, joined_on, left_on, intake_*)`: `left_on` set = Former (Left the Team; Back on the Team clears it). Intake is filled in by a coach: why they joined, what they want from Adult Team, comps (yes/maybe/no/''), injuries or limits, anything else. The user said no availability (practice days are fixed). An empty intake (why and wants) shows Needs Intake.
- `team_goals`: current / achieved / archived; `team_goal_done` sets `done_at`.
- `team_coach_notes`: `note_date` (practice) or empty (general). Author or admin edits/deletes. `team_stamp_author` signs notes, check-ins and events.
- `team_circuits(name, color, position, v_min, v_max)`: the gym's circuit colors, easiest first, same at every location: Yellow V0, Red V0–2, Green V1–3, Purple V2–4, Orange V3–5, Black V4–6, Blue V5–7, Pink V6–8, White V8–10, Mint V11+. Admins edit them in Settings; one used by a check-in can't be deleted.
- `team_rating_areas(name, position, active)`: 1–5 ratings (Technique, Strength, Endurance, Mental Game, Footwork). Hide keeps old ratings; one in use can't be deleted.
- `team_checkins`: any cadence (the user wasn't sure: monthly to yearly). Hardest circuit, Tension Board 2 and Kilter (V grade + angle), outdoor/other boulder V, route YDS (the gym is bouldering only, but members climb ropes), `ratings` jsonb `{area id: 1..5}`, notes. The newest shows in full with ↑/↓ against the newest older check-in that has that value; older ones fold into History. A new check-in starts with the last board angles.
- `team_events`: calendar, `kind` competition / practice / open_house / other, one day or several (`end_date`), all day or timed, place, notes. `location_id` null = every location (admins only). No attendance (the user said the calendar is for coaches to know the plan).

## Conventions

- Look: "Chalk & Rope": chalk-white page, deep navy ink, rope-orange accent; Space Grotesk headings, Figtree body. Tokens on `:root` with dark mode. The user's fallback if they go off it: "Granite & Sky" (cool grays, slate-blue accent).
- Logo: a boulder with a flag on top (inline SVG in the header and on the root home card; `icon.svg` is the favicon). `apple-touch-icon.png` (180px, chalk mountain and orange flag on navy) is for phone home screens, drawn with PowerShell System.Drawing from the same points as the SVG, so redraw it if the mark changes.
- Works at ~400px wide. Title case for buttons, headings and labels; sentence case for hints and messages.
- Dialogs use `ask()` (`wide` for big forms, `extra` for a Delete/Remove button, `onOpen` to wire fields).
