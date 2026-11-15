import { useEffect, useState } from 'react'
import { savePrefs, unlockAudio, chime, speak, notify, keepAwake } from '../lib/alerts'
import { pushSupported, pushState, enablePush, disablePush, refreshPush } from '../lib/push'

export default function AlertBar({ prefs, setPrefs, label, cafeId }) {
  const [push, setPush] = useState('off'), [msg, setMsg] = useState('')
  useEffect(() => { if (cafeId) { pushState().then(setPush); refreshPush(cafeId) } }, [cafeId])
  const togglePush = async () => {
    setMsg('')
    if (push === 'on') { await disablePush(); setPush('off'); return }
    const r = await enablePush(cafeId); setPush(await pushState())
    if (!r.ok) setMsg(r.reason === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser settings.' : 'Background notifications could not be turned on for this device.')
  }
  useEffect(() => {   // the screen lock is released by the browser when the tab is hidden, so ask again when it returns
    if (!prefs.on) return
    keepAwake(true)
    const v = () => { if (!document.hidden) keepAwake(true) }
    document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v)
  }, [prefs.on])
  const toggle = () => {
    const n = { ...prefs, on: !prefs.on }; setPrefs(n); savePrefs(n)
    if (n.on) { unlockAudio(); chime(); speak(label + ' alerts are on'); try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch {} } else keepAwake(false)
  }
  const mode = e => { const n = { ...prefs, mode: e.target.value }; setPrefs(n); savePrefs(n) }
  return (<div className="panel alertbar">
    <div className="row"><button className={prefs.on ? '' : 'ghost'} onClick={toggle} aria-pressed={prefs.on}>{prefs.on ? 'Sound alerts: ON' : 'Turn on sound alerts'}</button>
      {prefs.on && <><select value={prefs.mode} onChange={mode} aria-label="Alert sound"><option value="both">Chime and voice</option><option value="chime">Chime only</option><option value="voice">Voice only</option></select>
        <button className="link" onClick={() => notify(prefs, 'Test', label + ': new order arrived')}>Test</button></>}</div>
    {cafeId && pushSupported() && push !== 'unsupported' && <div className="row"><button className={push === 'on' ? '' : 'ghost'} onClick={togglePush}>{push === 'on' ? 'Phone notifications: ON' : 'Get notifications when the app is closed'}</button></div>}
    {msg && <p className="err" role="alert">{msg}</p>}
    <p className="muted">Keep this page open on the café tablet or phone with the screen on and the volume up. With the page closed, your phone shows a notification with its normal sound; the chime and voice play only while the page is open.</p></div>)
}
