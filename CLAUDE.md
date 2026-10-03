# VSApps

A personal website that holds several small apps. Each app is its own folder with its own `index.html` and its own `CLAUDE.md`. The root `index.html` is a home page with one card per app.

## Apps

- `sitstart/`: Sit Start, bouldering coaching. The coach manages students and plans; students sign in to see only their own. Uses Supabase. See `sitstart/CLAUDE.md` and `sitstart/SETUP.md`.
- `topout/`: Top Out (Adult Team), group coaching by location: rosters, check-ins, calendar. Staff only. Same Supabase project as Sit Start (tables `team_*`, shared logins). See `topout/CLAUDE.md` and `topout/SETUP.md`.

## Conventions

- Static files only, with no build step. The whole repo root is published as is (GitHub Pages from `main`, root folder; `.nojekyll` makes Pages serve files as they are).
- Adding an app: create a folder with an `index.html`, then add a card for it on the root `index.html`.
- Apps link with relative paths (`sitstart/`, not `/sitstart/`), so the site works under the GitHub Pages subfolder (`/vsapps/`) or a custom domain.
- Apps that need a backend can share one Supabase project. Give each app's tables a name that won't clash (Sit Start: `staff`, `students`, `plans`, `sessions`, `notes`, `goals`, `coach_notes`, `exercises`, `coaching_sessions`; Top Out: `team_*`), shared by all: `app_errors`, and keep row-level security on every table. Logins (`auth.users`) and the three auth email templates are shared by every app: access comes from each app's own staff table, `login_in_other_app()` keeps one app from blocking or deleting another's logins, and the pasted templates are built by `supabase-emails/build.sh`.
- Shared basics: tokens on `:root` with a dark theme, and a layout that works at about 400px wide. Each app picks its own colors and fonts (Sit Start: moss green on warm sand/bark, Bricolage Grotesque + DM Sans; Top Out: chalk white, navy and rope orange, Space Grotesk + Figtree; see each app's `CLAUDE.md`). The root home page has its own look (midnight blue and crimson, Fraunces + Inter; `icon.svg` is a VS favicon, and `apple-touch-icon.png` is the same drawn at 180px with PowerShell System.Drawing, so redraw it if the icon changes), and each app card there uses that app's own colors and fonts.
- Buttons, headings and labels use title case. Hints and messages use sentence case.
- A required field shows a small red * after its label in both apps (`markRequired` in each `core.js`).
- Both apps install to a phone home screen: each has `manifest.webmanifest` (standalone, its own scope) with `apple-touch-icon.png`, `icon-512.png` and `icon-maskable.png` (the mark smaller, for Android's round crop). The 512px ones were drawn from the SVG mark with headless Edge, so redraw them with `apple-touch-icon.png` if the mark changes. No service worker: pages always load fresh. On a phone, `installBanner` (core.js, `#installBar` under the header) offers it: Install opens Android's own box (`beforeinstallprompt`); both say "Install the <app> web app on your phone!" (the user's wording); iPhone Safari adds a small "Tap Share, then Add to Home Screen" line (Apple has no install box). Hidden once installed; Not Now hides it 30 days (`localStorage` `<app>.installLater`).
- Error log: both `core.js` files have `logError`, which adds unexpected errors (from `msgOf`, `window` error and unhandled rejections) and server calls over 4 seconds (`slowCheck` in `skewFetch`) to the shared `app_errors` table (`supabase-shared/2026-10-03-app-errors.sql`). Apps can only insert; read it in Supabase's Table Editor. SQL shared by every app lives in `supabase-shared/`.
- Never commit secret keys. A Supabase publishable (anon) key is fine to commit.
