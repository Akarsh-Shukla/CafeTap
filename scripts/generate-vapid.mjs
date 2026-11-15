// Run once:  node scripts/generate-vapid.mjs   then paste the values where the output says. Keep the private values secret.
import { webcrypto as crypto } from 'node:crypto'
const b64u = b => Buffer.from(b).toString('base64url')
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey))
const secret = b64u(crypto.getRandomValues(new Uint8Array(32)))
console.log(`\nCloudflare Pages > Settings > Variables and Secrets (set as SECRET unless noted):\n  VAPID_PRIVATE_JWK = ${jwk}\n  VAPID_PUBLIC_KEY  = ${pub}   (plain text is fine)\n  VAPID_SUBJECT     = mailto:you@example.com   (plain text)\n  PUSH_SECRET       = ${secret}\n\nCloudflare Pages build variable and your .env.local (public):\n  VITE_VAPID_PUBLIC_KEY = ${pub}\n\nSupabase SQL Editor (same PUSH_SECRET, your real site address):\n  insert into app_settings (key, value) values ('push_url', 'https://YOUR-SITE/api/push-notify'), ('push_secret', '${secret}')\n  on conflict (key) do update set value = excluded.value;\n`)
