# Architecture

```
src/landing/        public marketing page (copy in content.js, pictures in src/content/)
src/pages/          Guest.jsx (café pages), Order.jsx (cart, add-ons, offers), Bill.jsx (guest receipt), Dashboard.jsx, Admin.jsx, Login, Welcome, Terms, Privacy
src/pages/dash/     owner screens: Menu, Offers, Extras (combos and add-ons), Settings, Tables (QR posters), Register, Staff access, Business
src/pages/pos/      Board (tables), Kitchen, Sales, BillSettings, PosSettings
src/components/     BillDoc (one bill layout), QrPoster, AlertBar, Install, Art ...
src/lib/            supabase client, pos helpers and messages, menu loaders, push, alerts, util
functions/          Cloudflare function that sends notifications
supabase/           schema.sql and migration-2 … 11 (run in order), check_setup.sql, tests/
tests/              static.test.mjs (safety checks), smoke (renders every screen), push.test.mjs
```

## Money (the important rules)
- Integer paise. Prices include tax. All maths is in SQL: `_price_lines` (cart), `_offer_eval` (offers), `_bill_recalc` (table bill), `_bill_json` (what bills show).
- One best live offer is applied automatically to the **table bill**. It is recalculated until the first payment, then locked. Orders move through `pending → received → preparing → ready → completed`; only approved orders are on the bill.
- Bill numbers are sequential per café and issued at full payment. Tax lines are snapshotted at payment.

## Adding things
- **A database change:** never edit an old migration. Add `migration-12.sql`, lock every new function (`revoke all … from public, anon, authenticated`, then grant what is needed), enable row-level security on new tables, then add the file name to `tests/static.test.mjs`. Run `npm run test:static`.
- **A function guests may call:** add it to the allow-list and justify it in `docs/CHANGELOG_FIXES.md`.
- **An owner tab:** add a file in `src/pages/dash/`, then one line in `tabs` and one in the render list in `Dashboard.jsx`.
- **Landing page text:** `src/landing/content.js`. Pictures: `src/content/README.md`.
