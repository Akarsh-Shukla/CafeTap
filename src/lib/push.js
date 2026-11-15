import { useEffect } from 'react'
import { rpc } from './pos'

// Installable app + background notifications. Works only on the owner, staff and admin screens, never for customers.
const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
const bytes = b64 => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)) }
export const pushSupported = () => !!KEY && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () => { try { return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && navigator.standalone === true) } catch { return false } }

export async function registerSW() { if (!('serviceWorker' in navigator)) return null; try { return await navigator.serviceWorker.register('/sw.js') } catch { return null } }
export function usePwa() {
  useEffect(() => {
    if (!document.querySelector('link[rel=manifest]')) { const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/manifest.webmanifest'; document.head.appendChild(l) }
    registerSW()
    const f = e => { e.preventDefault(); window.__ctInstall = e; window.dispatchEvent(new Event('ct-install')) }
    addEventListener('beforeinstallprompt', f); return () => removeEventListener('beforeinstallprompt', f)
  }, [])
}
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try { const reg = await navigator.serviceWorker.getRegistration(); return Notification.permission === 'granted' && reg && await reg.pushManager.getSubscription() ? 'on' : 'off' } catch { return 'off' }
}
export async function enablePush(cafeId) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (await Notification.requestPermission() !== 'granted') return { ok: false, reason: 'denied' }
  await registerSW(); const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(KEY) })
  const j = sub.toJSON(); return rpc('push_subscribe', { p_cafe: cafeId, p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth })
}
export async function disablePush() {
  try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription(); if (sub) { await rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe() } } catch {}
}
// re-registers quietly each time the app opens so the server knows this device is still in use
export async function refreshPush(cafeId) { if (await pushState() === 'on') enablePush(cafeId) }
