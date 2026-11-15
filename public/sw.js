// CafeTap service worker: keeps the staff app opening fast and shows a notification when the database pings us about a new order.
const V = 'ct-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V) await caches.delete(k); await self.clients.claim() })()))
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return
  const u = new URL(r.url); if (u.origin !== location.origin) return
  if (u.pathname.startsWith('/assets/')) {   // files with a fingerprint in their name never change: cache first
    e.respondWith(caches.open(V).then(async c => (await c.match(r)) || fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res })))
  } else if (r.mode === 'navigate') {   // pages: network first, and the last good copy of the app when offline
    e.respondWith(fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put('/index.html', copy)) } return res })
      .catch(() => caches.match('/index.html').then(x => x || new Response('You are offline. Please reconnect and try again.', { status: 503 }))))
  }
})
self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('CafeTap: new order', {
  body: 'Tap to open the orders screen.', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: 'ct-order', renotify: true, requireInteraction: true,
  vibrate: [300, 120, 300, 120, 600], data: { url: '/dashboard' } })))
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil((async () => { const all = await clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const c of all) if ('focus' in c) return c.focus(); return clients.openWindow((e.notification.data && e.notification.data.url) || '/dashboard') })())
})
