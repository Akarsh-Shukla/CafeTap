import { useEffect, useState } from 'react'
import { isIos, isStandalone } from '../lib/push'

// "Install app" button for the header (Android and desktop), with a hint for iPhone and iPad.
export default function InstallButton() {
  const [can, setCan] = useState(false), [hint, setHint] = useState(false)
  useEffect(() => { const f = () => setCan(!!window.__ctInstall); f(); addEventListener('ct-install', f); return () => removeEventListener('ct-install', f) }, [])
  if (isStandalone()) return null
  if (can) return <button className="link" onClick={async () => { const e = window.__ctInstall; window.__ctInstall = null; setCan(false); e?.prompt() }}>Install app</button>
  if (isIos()) return <><button className="link" onClick={() => setHint(!hint)}>Install app</button>{hint && <span className="muted"> Tap Share, then “Add to Home Screen”.</span>}</>
  return null
}
