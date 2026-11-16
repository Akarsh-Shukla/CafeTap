# Phone notifications for new orders

**What works.** Owners and staff can install the app and turn on notifications on their phone. When a guest places an order, front staff get a notification; when an order is approved, the kitchen gets one. It works with the app closed.
**What does not.** With the app closed the phone plays its normal notification sound. The chime and spoken alert work only while the app is open (keep it open on the counter or kitchen tablet, screen on). iPhone and iPad need iOS 16.4 or newer and "Add to Home Screen" first. The admin receives no order notifications.

## Where every value goes (this is the part people get wrong)
Run `node scripts/generate-vapid.mjs` once. It prints five values. **All of them are needed**, not only the public key.

| Value | Where | Type |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | Cloudflare Pages, Settings, Variables and Secrets, **Production** | Plain text. It is read when the site is *built*, so after adding it open Deployments and **Retry deployment**. Also put it in `.env.local` for local use. |
| `VAPID_PUBLIC_KEY` | same place | Plain text (the same public key again) |
| `VAPID_PRIVATE_JWK` | same place | **Secret** (the long `{"key_ops"…}` text, pasted exactly) |
| `VAPID_SUBJECT` | same place | Plain text, like `mailto:you@yourmail.com` |
| `PUSH_SECRET` | same place | **Secret** |
| the `insert into app_settings …` line | Supabase SQL Editor | Uses your real site address and the **same** `PUSH_SECRET` |

Also turn on **pg_net** in Supabase (Database, Extensions).

## Check it
1. Open `https://YOUR-SITE/api/push-notify` in a browser. "method not allowed" means the function is deployed. "Not found" means it is not (the `functions` folder must be in the repository).
2. Log in as staff on a phone, open **Orders**. The button "Get notifications when the app is closed" must appear. If it does not, `VITE_VAPID_PUBLIC_KEY` was missing at build time: add it and retry the deployment.
3. Press it and allow notifications. Place a test order from a table link, with the app closed.

## How it is built
The database trigger calls `/api/push-notify` on Cloudflare, which checks the shared secret, only talks to the real push services (Google, Mozilla, Apple, Microsoft), signs the request with your private key and sends an empty "wake up". The app shows the message. If sending fails, the order still goes through. Tests: `npm run test:push`.
