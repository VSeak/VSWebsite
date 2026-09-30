# Top Out Setup

Top Out uses the **same Supabase project as Sit Start**, so there's no new project, key or email sender. About 15 minutes, once.

## 1. Update Sit Start's database for shared logins

**SQL Editor → New query**, paste all of `sitstart/supabase/migrations/2026-09-30-shared-logins.sql`, then **Run**. Sit Start keeps working exactly as before. This only lets another app's staff sign up, and stops Sit Start from deleting a login that another app uses.

## 2. Create Top Out's tables

**SQL Editor → New query**, paste all of `topout/supabase/schema.sql`. At the very bottom, change `you@example.com` to the email you sign in to Sit Start with (you become Top Out's owner and admin). Then **Run**. You should see "Success. No rows returned".

It creates the Minneapolis and St. Paul locations, the circuit colors and the rating areas.

## 3. Replace the three email templates

Both apps share each email, so the templates now hold a Sit Start version and a Top Out version.

**Authentication → Emails → Templates.** For **Confirm signup**, **Magic Link** and **Reset Password**, paste in `supabase-emails/confirm-signup.html`, `supabase-emails/magic-link.html` and `supabase-emails/reset-password.html` (from the repo root, not the app folders). Set each subject to the line after "Subject:" in the file's first comment. Save each one.

## 4. Allow Top Out's address for sign-in links

**Authentication → URL Configuration → Redirect URLs.** If `https://vseak.github.io/vsapps/**` is already there, you're done. Otherwise add `https://vseak.github.io/vsapps/topout/**`. Leave the Site URL as it is.

## 5. Put it online

Push to `main`. GitHub Pages publishes it at `https://vseak.github.io/vsapps/topout/`, and the home page has a Top Out card.

## 6. Try it

Sign in with your usual email and password. You'll see the two locations. Then:

1. **Staff** (Home): add your coaches with their location ticked. Each gets an invite email. Someone who already uses Sit Start gets a sign-in link and keeps their password.
2. **Settings**: check the circuit colors and V ranges, and the rating areas.
3. Open a location, add a team member, fill in their intake, and add a check-in and an event.

## Good to know

- **One sign-in, separate access.** A Sit Start student or coach can't open Top Out unless they're on Top Out's Staff page, and the other way around. Being on both lists means one email and one password for both.
- **Removing staff** takes away their Top Out access but keeps their login (they may use Sit Start). Their notes and check-ins stay, signed with their name.
- **Left the Team** keeps a member's history and moves them to Former. Delete Member is only for someone added by mistake.
