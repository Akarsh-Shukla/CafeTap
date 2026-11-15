// Checks the push function's signing, endpoint allow-list and secret check. Run: node tests/push.test.mjs
import assert from 'node:assert/strict'
import { webcrypto as crypto } from 'node:crypto'
globalThis.crypto ??= crypto
const { vapidHeader, okEndpoint } = await import('../functions/_push.js')
const { onRequestPost } = await import('../functions/api/push-notify.js')
const b64u = b => Buffer.from(b).toString('base64url')
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
const env = { VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)), VAPID_PUBLIC_KEY: b64u(pubRaw), VAPID_SUBJECT: 'mailto:test@example.com', PUSH_SECRET: 's3cret' }

// 1. the signed token verifies with the public key and has the right claims
const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', env, 1_700_000_000_000)
const m = /^vapid t=([^,]+), k=(.+)$/.exec(h); assert.ok(m, 'header format'); assert.equal(m[2], env.VAPID_PUBLIC_KEY)
const [hd, pl, sg] = m[1].split('.'), claims = JSON.parse(Buffer.from(pl, 'base64url'))
assert.deepEqual(JSON.parse(Buffer.from(hd, 'base64url')), { typ: 'JWT', alg: 'ES256' })
assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, env.VAPID_SUBJECT); assert.equal(claims.exp, 1_700_000_000 + 43200)
const pubKey = await crypto.subtle.importKey('raw', pubRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, Buffer.from(sg, 'base64url'), new TextEncoder().encode(hd + '.' + pl)), 'signature verifies')
// 2. only real push services are allowed
for (const ok of ['https://fcm.googleapis.com/x', 'https://updates.push.services.mozilla.com/x', 'https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/x']) assert.ok(okEndpoint(ok), ok)
for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com@evil.com/x', 'not a url', '']) assert.ok(!okEndpoint(bad), bad)
// 3. the handler: wrong secret refused; allowed endpoints are called with the signed header, others are skipped
const calls = []; globalThis.fetch = async (u, o) => { calls.push([u, o]); return { status: 201 } }
const req = (secret, body) => new Request('https://x/api/push-notify', { method: 'POST', headers: { 'x-push-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify(body) })
assert.equal((await onRequestPost({ request: req('nope', { endpoints: [] }), env })).status, 403)
assert.equal((await onRequestPost({ request: req('s3cret', 'garbage'), env })).status, 200)
const r = await onRequestPost({ request: req('s3cret', { endpoints: ['https://fcm.googleapis.com/a', 'https://evil.com/b'] }), env })
assert.deepEqual(await r.json(), { sent: 1, gone: 0 }); assert.equal(calls.length, 1); assert.match(calls[0][1].headers.Authorization, /^vapid t=/); assert.equal(calls[0][1].headers['Content-Length'], '0')
console.log('push tests: all passed')
