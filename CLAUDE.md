# VSApps

A personal website that holds several small apps. Each app is its own folder with its own `index.html` and its own `CLAUDE.md`. The root `index.html` is a home page with one card per app.

## Apps

- `sitstart/`: Sit Start, bouldering coaching. The coach manages students and plans; students sign in to see only their own. Uses Supabase. See `sitstart/CLAUDE.md` and `sitstart/SETUP.md`.

## Conventions

- Static files only, with no build step. The whole repo root is published as is (GitHub Pages from `main`, root folder; `.nojekyll` makes Pages serve files as they are).
- Adding an app: create a folder with an `index.html`, then add a card for it on the root `index.html`.
- Apps link with relative paths (`sitstart/`, not `/sitstart/`), so the site works under the GitHub Pages subfolder (`/vsapps/`) or a custom domain.
- Apps that need a backend can share one Supabase project. Give each app's tables a name that won't clash (the coaching tables are `staff`, `students`, `plans`, `sessions`, `notes`, `goals`, `coach_notes`, `exercises`), and keep row-level security on every table.
- Shared basics: tokens on `:root` with a dark theme, and a layout that works at about 400px wide. Each app picks its own colors and fonts (Sit Start: moss green on warm sand/bark, Bricolage Grotesque + DM Sans; see its `CLAUDE.md`). The root home page keeps its own look.
- Buttons, headings and labels use title case. Hints and messages use sentence case.
- Never commit secret keys. A Supabase publishable (anon) key is fine to commit.
