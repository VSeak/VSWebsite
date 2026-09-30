# VSApps

A personal website that holds several small apps. Each app is its own folder with its own `index.html` and its own `CLAUDE.md`. The root `index.html` is a home page with one card per app.

## Apps

- `sitstart/`: Sit Start, bouldering coaching. The coach manages students and plans; students sign in to see only their own. Uses Supabase. See `sitstart/CLAUDE.md` and `sitstart/SETUP.md`.
- `topout/`: Top Out (Adult Team), group coaching by location: rosters, check-ins, calendar. Staff only. Same Supabase project as Sit Start (tables `team_*`, shared logins). See `topout/CLAUDE.md` and `topout/SETUP.md`.

## Conventions

- Static files only, with no build step. The whole repo root is published as is (GitHub Pages from `main`, root folder; `.nojekyll` makes Pages serve files as they are).
- Adding an app: create a folder with an `index.html`, then add a card for it on the root `index.html`.
- Apps link with relative paths (`sitstart/`, not `/sitstart/`), so the site works under the GitHub Pages subfolder (`/vsapps/`) or a custom domain.
- Apps that need a backend can share one Supabase project. Give each app's tables a name that won't clash (Sit Start: `staff`, `students`, `plans`, `sessions`, `notes`, `goals`, `coach_notes`, `exercises`; Top Out: `team_*`), and keep row-level security on every table. Logins (`auth.users`) and the three auth email templates are shared by every app: access comes from each app's own staff table, `login_in_other_app()` keeps one app from blocking or deleting another's logins, and the pasted templates are built by `supabase-emails/build.sh`.
- Shared basics: tokens on `:root` with a dark theme, and a layout that works at about 400px wide. Each app picks its own colors and fonts (Sit Start: moss green on warm sand/bark, Bricolage Grotesque + DM Sans; Top Out: chalk white, navy and rope orange, Space Grotesk + Figtree; see each app's `CLAUDE.md`). The root home page keeps its own look.
- Buttons, headings and labels use title case. Hints and messages use sentence case.
- Never commit secret keys. A Supabase publishable (anon) key is fine to commit.
