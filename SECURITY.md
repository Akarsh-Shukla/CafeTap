# Security

**Model.** Guests are anonymous and can only call a short list of database functions. Owners and staff log in; the database checks what each person may do. The platform admin manages cafés but cannot read orders, payments or feedback. Nothing secret is in the website code (the Supabase anon key is meant to be public).

**Checked automatically (`npm run check`).** Every database function is locked unless on the allow-list, none can be created twice with different arguments, every table has row-level security, every function that runs with extra rights pins its search path, the app only calls functions and tables that exist, and no secret names appear in the code.

**Money.** Prices, add-ons, combos, offers, discounts and tax are worked out in the database. Receipts use a long random private link (7 days, read only). A guest never sees another guest’s items.

**You must do.**
- Turn on two-factor sign-in for GitHub, Cloudflare, Supabase and the email you use for them.
- In Supabase turn **off** public sign-ups. Create logins only for owners, staff and yourself.
- Keep the GitHub repository private. Store keys only in Cloudflare and GitHub secrets.
- Test the nightly backup and practise one restore (`docs/BACKUPS_AND_HOSTING.md`).
- Run `supabase/tests/*.sql` on a separate test project after every database change.

**Reporting a problem.** Email the address on the website. Please do not post details publicly first.
