import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { rpc } from '../lib/pos'
import BillDoc from '../components/BillDoc'

// The guest's own bill. The link works for 7 days, updates itself until it is paid, and can be printed or saved as a PDF.
export default function Bill() {
  const { token } = useParams(), nav = useNavigate(), [bill, setBill] = useState(null), [gone, setGone] = useState(false), [failed, setFailed] = useState(false), [copied, setCopied] = useState(false)
  const load = useCallback(() => rpc('pos_my_bill', { p_receipt: token }).then(r => { if (r.ok) { setBill(r); setFailed(false) } else if (r.reason === 'none') setGone(true); else setFailed(true) }), [token])
  useEffect(() => { document.title = 'Your bill'; load(); const id = setInterval(() => { if (!document.hidden) load() }, 12000); return () => clearInterval(id) }, [load])
  const print = () => { document.body.classList.add('printing-bill'); window.print(); setTimeout(() => document.body.classList.remove('printing-bill'), 800) }
  const share = async () => {
    const url = location.href
    try { if (navigator.share) await navigator.share({ title: 'My bill', url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } } catch {}
  }
  const slug = bill?.cafe?.slug, back = () => (window.history.length > 1 ? nav(-1) : nav(slug ? '/' + slug : '/'))
  if (gone) return <main className="msg"><h1>This bill isn’t available</h1><p>Bill links work for 7 days after your order. Please ask the café if you need a copy.</p><button onClick={() => nav('/')}>Close</button></main>
  if (!bill && failed) return <main className="msg" role="alert"><h1>We couldn’t load your bill</h1><p>Please check your connection and try again. If it keeps happening, ask the café’s staff.</p><button onClick={() => { setFailed(false); load() }}>Try again</button> <button className="ghost" onClick={() => nav('/')}>Close</button></main>
  if (!bill) return <main className="msg" role="status"><p>Loading your bill…</p></main>
  return (<main className="billpage" data-theme={bill.cafe.theme}>
    <div className="billtop noprint"><button className="ghost" onClick={back} aria-label="Back">← Back</button><button className="ghost" onClick={back} aria-label="Close the bill">✕ Close</button></div>
    {failed && <p className="err noprint" role="status" style={{ textAlign: 'center' }}>Can’t refresh right now. Showing the last update.</p>}
    <BillDoc bill={bill} />
    <div className="billact noprint"><button onClick={print}>Print or save as PDF</button><button className="ghost" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>{slug && <Link className="btn" to={'/' + slug}>Back to the menu</Link>}</div>
    <p className="muted noprint" style={{ textAlign: 'center' }}>This page updates by itself when your payment is recorded.</p>
  </main>)
}
