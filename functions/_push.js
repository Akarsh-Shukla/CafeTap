// Web Push helpers (no libraries). We send "wake-up" pushes without a message body; the service worker shows the notification text.
const enc = new TextEncoder()
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uJson = o => b64u(enc.encode(JSON.stringify(o)))

// Only the real browser push services are allowed, so this function can never be used to call arbitrary websites.
const ALLOWED = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)web\.push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]
export const okEndpoint = u => { try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED.some(r => r.test(x.hostname)) } catch { return false } }

export async function vapidHeader(endpoint, env, now = Date.now()) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const body = b64uJson({ typ: 'JWT', alg: 'ES256' }) + '.' + b64uJson({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body))
  return `vapid t=${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`
}
