# Coaching App Setup

About 30 minutes, once. Everything here is free.

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick a region near you (e.g. US East) and save the database password somewhere safe. The site doesn't need it.
2. Wait a minute or two for the project to finish setting up.

## 2. Create the tables and access rules

1. Open **SQL Editor → New query**.
2. Paste in all of `supabase/schema.sql`.
3. At the very bottom, change `you@example.com` to the email you'll sign in with as the coach.
4. Press **Run**. You should see "Success. No rows returned".

## 3. Create your account

**Authentication → Users → Add user → Create new user**: your email (the same one as step 2), a password, and tick **Auto Confirm User**.

## 4. Set up email (needed for invites)

Supabase's built-in email only sends to members of your Supabase team, so students won't get invites until you connect your own sender.

**Authentication → Emails → SMTP Settings → Enable custom SMTP.** The easiest options:

- **Gmail:** turn on 2-step verification for your Google account, create an **App password** (Google Account → Security → App passwords), then use host `smtp.gmail.com`, port `465`, username = your Gmail address, password = the app password.
- **Brevo** (free, 300 emails a day): sign up, verify your sender email, and copy the SMTP details from **SMTP & API**.

Then, under **Authentication → Emails → Templates**, replace **Confirm signup**, **Magic Link** and **Reset Password** with `supabase/emails/confirm-signup.html`, `supabase/emails/magic-link.html` and `supabase/emails/reset-password.html`. Each file starts with a note giving its subject line. Change the name in them to yours.

## 5. Tell Supabase where the site lives

**Authentication → URL Configuration:**

- **Site URL:** your site's address, e.g. `https://your-name.github.io/vsapps/sitstart/` (use `http://localhost:3000` until it's hosted).
- **Redirect URLs:** add `http://localhost:3000/**` and, once hosted, `https://your-site-address/**`.

Leave **Authentication → Sign In / Providers → Email** on, and leave "Allow new users to sign up" **on**. The database only lets emails on your student list create an account, so strangers can't sign up.

## 6. Connect the site

**Project Settings → API Keys.** Copy the **Project URL** and the **publishable key** (or the key labelled `anon`), and paste them into `CONFIG` at the top of `sitstart/js/core.js`:

```js
const CONFIG = {
  siteName: "Sit Start",
  supabaseUrl: "https://abcd1234.supabase.co",
  supabaseKey: "sb_publishable_…",
};
```

The publishable key is meant to be public. **Never** paste the secret or `service_role` key into the site.

## 7. Try it locally

Sign-in links need a real web address, so run the site with a local server rather than double-clicking the file. With Node.js installed, run this from the repo root (the folder above `sitstart/`):

```bash
npx serve .
```

Open http://localhost:3000/sitstart/, sign in as the coach, and add a test student by name. On their page, send the invite to a second address of yours (a Gmail alias like `you+student@gmail.com` works). Open the invite in a private window to check you only see that student's plan.

## 8. Put it online

GitHub Pages publishes the site straight from the repo, free, and every push to `main` updates the live site:

1. The repo must be **public** (free GitHub accounts only get Pages on public repos). That's safe: the only key in it is the publishable key.
2. In the repo on GitHub: **Settings → Pages → Build and deployment**. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. After a minute or two the page shows the address, like `https://your-name.github.io/vsapps/`. The Sit Start app is at `/vsapps/sitstart/`. The `.nojekyll` file in the repo root tells Pages to serve the files as they are.

Then go back to step 5 and add the new address, and set `siteUrl` in `CONFIG` (in `sitstart/js/core.js`) to it, e.g. `https://your-name.github.io/vsapps/sitstart/`. Invite links then go to the live site even when you send them from localhost, so students can open them on a phone.

## Good to know

- **Updates to the database:** `schema.sql` is for a new project. If your project was set up earlier, run any new files in `supabase/migrations` (oldest first) in the SQL Editor.
- **Ending coaching** is how you archive a student: everything is kept and they can still sign in. **Deleting a student** (only offered once coaching has ended) removes their plans, notes and login, so you can add the same email again and they get a fresh invite.
- **Staff who leave:** deactivate them on their user page. They can't get in: signing in with their password just shows an "Account Deactivated" message, but keep their details and history and can be reactivated. Delete Staff appears only once someone is deactivated.
- **Free-plan pause:** Supabase pauses free projects after a week with no activity. Signing in once a week keeps it awake, or restore it from the dashboard in a click.
- **Backups:** **Database → Backups** on paid plans. On free, you can export tables as CSV from the Table Editor.
