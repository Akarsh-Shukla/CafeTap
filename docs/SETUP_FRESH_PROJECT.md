# Setting up from nothing (about 30 minutes)

## 1. Supabase
1. Create a new project. Save the **Project URL** and the **anon public key** (Settings, API).
2. Authentication, Providers, Email: turn **off** "Allow new users to sign up". Under URL Configuration set the Site URL to your website and add `https://YOUR-SITE/welcome` to the redirect URLs.
3. SQL Editor: run these files **in order, each once**: `schema.sql`, `migration-2.sql` … `migration-13.sql` (inside `supabase/`). The last four end with a check that must show **zero rows**. Then run `check_setup.sql`: every line must say true.
4. Database, Extensions: enable **pg_net** (needed only for phone notifications).
5. Create yourself: Authentication, Users, Add user (email and password). Then in the SQL Editor:
   `insert into admins (user_id) select id from auth.users where email = 'YOUR-EMAIL';`
6. Later, to add a café: log in at `/admin`, create it, and send the owner an invite.

## 2. Cloudflare Pages
Connect the GitHub repository. Build command `npm run build`, output folder `dist`. Add variables (Production): `NODE_VERSION=20`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_URL` (your site address), the `VITE_CONTACT_*` values, `VITE_DEMO_SLUG`, and (for notifications) `VITE_VAPID_PUBLIC_KEY`. The `functions/` folder is deployed automatically.

## 3. Notifications (optional)
Follow `docs/PUSH_SETUP.md`.

## 4. Backups
Follow `docs/BACKUPS_AND_HOSTING.md`.

## 5. Test on a separate project, not on live data
Run `supabase/tests/pos_tests.sql` and `supabase/tests/billing_tests.sql` (each ends with a list of PASS/FAIL lines and rolls everything back). Then follow `docs/TEST_PLAN.md` on real phones.
