# Phone notifications for new orders

**What works.** Owners and staff can install the app and turn on notifications on their phone. When a guest places an order, front staff get a notification; when an order is approved, the kitchen gets one. It works with the app closed.
**What does not.** With the app closed the phone plays its normal notification sound. The chime and spoken alert work only while the app is open (keep it open on the counter or kitchen tablet, screen on). iPhone and iPad need iOS 16.4 or newer and "Add to Home Screen" first. The admin receives no order notifications.

## Setup
1. On your computer run `node scripts/generate-vapid.mjs`. It prints the values for the next steps.
2. Cloudflare Pages, Settings, Variables and Secrets: add `VAPID_PRIVATE_JWK` and `PUSH_SECRET` as **secrets**, plus `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (`mailto:you@yourmail.com`). Add `VITE_VAPID_PUBLIC_KEY` as a normal variable (also in `.env.local`). Redeploy.
3. Supabase: make sure the `pg_net` extension is on, then run the `insert into app_settings …` statement the script printed (use your real site address).
4. Open the app on a phone, log in as staff, open Orders, and press "Get notifications when the app is closed". Place a test order from a table link.

## How it is built
The database trigger calls `/api/push-notify` on Cloudflare, which checks a shared secret, only talks to the real push services (Google, Mozilla, Apple, Microsoft), signs the request with your private key and sends an empty "wake up". The app shows the message. If sending fails, the order still goes through. Tests: `npm run test:push`.
