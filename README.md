# CafeTap

A personalised café page (QR + NFC) with an optional POS plan: table ordering with staff approval, kitchen screen, combos, add-ons and dish versions (Half/Full, Veg/Non-veg), automatic offers, bills with live payment status, and an installable staff app with notifications.

**Stack:** React + Vite, Supabase (database, logins, storage), Cloudflare Pages (hosting and one small function for notifications).

## First time
1. Follow `docs/SETUP_FRESH_PROJECT.md` (new Supabase project, run the SQL files in order, environment variables, Cloudflare Pages).
2. `npm install`, copy `.env.example` to `.env.local`, fill it in, then `npm run dev`.
3. `npm run check` runs the safety checks, renders every screen and tests the notification function. Run it before every deploy.

## Release routine (every database change)
1. Run the new SQL file(s) in Supabase.
2. Run `supabase/tests/billing_tests.sql` on a test project. Every line must say PASS. Do not deploy the app while any line says FAIL.
3. `npm run check`, then commit and push.

## Rules the code follows
- **The database is the only place money is calculated.** The browser never sends a price, discount or offer.
- Menu prices already include tax. A bill can show how much tax it contains, never adds more.
- Every database function is locked unless it is on the allow-list in `tests/static.test.mjs`.

## Where things are
See `docs/ARCHITECTURE.md`. Fixes and the reasons for them: `docs/CHANGELOG_FIXES.md`. Future ideas: `docs/ROADMAP.md`.
