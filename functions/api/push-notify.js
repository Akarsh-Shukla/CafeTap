import { okEndpoint, vapidHeader } from '../_push.js'

// Called only by the database (it knows the shared secret). Secrets live in Cloudflare Pages settings, never in the browser.
const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }

export async function onRequestPost({ request, env }) {
  if (!env.PUSH_SECRET || !same(request.headers.get('x-push-secret') || '', env.PUSH_SECRET)) return new Response('forbidden', { status: 403 })
  let body; try { body = await request.json() } catch { return new Response('bad request', { status: 400 }) }
  const eps = (Array.isArray(body.endpoints) ? body.endpoints : []).filter(okEndpoint).slice(0, 50)
  const codes = await Promise.all(eps.map(async e => {
    try { return (await fetch(e, { method: 'POST', headers: { Authorization: await vapidHeader(e, env), TTL: '3600', Urgency: 'high', 'Content-Length': '0' } })).status } catch { return 0 }
  }))
  return Response.json({ sent: codes.filter(c => c >= 200 && c < 300).length, gone: codes.filter(c => c === 404 || c === 410).length })
}
export const onRequest = () => new Response('method not allowed', { status: 405 })
