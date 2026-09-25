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

## 3. Create your coach account

**Authentication → Users → Add user → Create new user**: your email (the same one as step 2), a password, and tick **Auto Confirm User**.

## 4. Set up email (needed for invites)

Supabase's built-in email only sends to members of your Supabase team, so students won't get invites until you connect your own sender.

**Authentication → Emails → SMTP Settings → Enable custom SMTP.** The easiest options:

- **Gmail:** turn on 2-step verification for your Google account, create an **App password** (Google Account → Security → App passwords), then use host `smtp.gmail.com`, port `465`, username = your Gmail address, password = the app password.
- **Brevo** (free, 300 emails a day): sign up, verify your sender email, and copy the SMTP details from **SMTP & API**.

Then, under **Authentication → Emails → Templates**, edit **Confirm signup** and **Magic Link** so they sound like you. For example: subject "Your bouldering training plan", with a line like "Click below to open your plan and choose a password." Keep the `{{ .ConfirmationURL }}` link in both.

## 5. Tell Supabase where the site lives

**Authentication → URL Configuration:**

- **Site URL:** your site's address, e.g. `https://your-site.netlify.app` (use `http://localhost:3000` until it's hosted).
- **Redirect URLs:** add `http://localhost:3000/**` and, once hosted, `https://your-site-address/**`.

Leave **Authentication → Sign In / Providers → Email** on, and leave "Allow new users to sign up" **on**. The database only lets emails on your student list create an account, so strangers can't sign up.

## 6. Connect the site

**Project Settings → API Keys.** Copy the **Project URL** and the **publishable key** (or the key labelled `anon`), and paste them into `CONFIG` near the top of the script in `coaching/index.html`:

```js
const CONFIG = {
  siteName: "Bouldering Coaching",
  supabaseUrl: "https://abcd1234.supabase.co",
  supabaseKey: "sb_publishable_…",
};
```

The publishable key is meant to be public. **Never** paste the secret or `service_role` key into the site.

## 7. Try it locally

Sign-in links need a real web address, so run the site with a local server rather than double-clicking the file. With Node.js installed, run this from the repo root (the folder above `coaching/`):

```bash
npx serve .
```

Open http://localhost:3000/coaching/, sign in as the coach, and add yourself as a test student with a second address (a Gmail alias like `you+student@gmail.com` works). Open the invite in a private window to check you only see that student's plan.

## 8. Put it online

Since the site is on GitHub, let Netlify publish it straight from there, and every push updates the live site:

1. Sign up at [netlify.com](https://www.netlify.com) with your GitHub account.
2. **Add new site → Import an existing project → GitHub**, and pick `VSWebsite`. Netlify needs permission to read that repo; for a private repo, grant it just that one.
3. Leave the build command empty and set the publish directory to `.` (the repo root). Deploy.

You get an address like `something.netlify.app`, which you can rename or point your own domain at. The coaching app is at `/coaching/`.

Then go back to step 5 and add the new address.

## Good to know

- **Removing a student** removes their plans and notes. Their login still exists but sees nothing. To remove the login too: **Authentication → Users**, find the email, and delete it.
- **Free-plan pause:** Supabase pauses free projects after a week with no activity. Signing in once a week keeps it awake, or restore it from the dashboard in a click.
- **Backups:** **Database → Backups** on paid plans. On free, you can export tables as CSV from the Table Editor.
