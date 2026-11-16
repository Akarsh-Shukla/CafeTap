import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { rpc } from '../lib/pos'
import BillDoc from '../components/BillDoc'

// The guest's own bill. The link works for 7 days, updates itself until it is paid, and can be printed or saved as a PDF.
export default function Bill() {
  const { token } = useParams(), nav = useNavigate(), [bill, setBill] = useState(null), [gone, setGone] = useState(false), [copied, setCopied] = useState(false)
  useEffect(() => {
    document.title = 'Your bill'; let live = true
    const load = () => rpc('pos_my_bill', { p_receipt: token }).then(r => { if (!live) return; if (r.ok) setBill(r); else if (r.reason === 'none') setGone(true) })
    load(); const id = setInterval(() => { if (!document.hidden) load() }, 12000); return () => { live = false; clearInterval(id) }
  }, [token])
  const print = () => { document.body.classList.add('printing-bill'); window.print(); setTimeout(() => document.body.classList.remove('printing-bill'), 800) }
  const share = async () => {
    const url = location.href
    try { if (navigator.share) await navigator.share({ title: 'My bill', url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } } catch {}
  }
  const slug = bill?.cafe?.slug, back = () => (window.history.length > 1 ? nav(-1) : nav(slug ? '/' + slug : '/'))
  if (gone) return <main className="msg"><h1>This bill isn’t available</h1><p>Bill links work for 7 days after your order. Please ask the café if you need a copy.</p><button onClick={() => nav('/')}>Close</button></main>
  if (!bill) return <main className="msg" role="status"><p>Loading your bill…</p></main>
  return (<main className="billpage" data-theme={bill.cafe.theme}>
    <div className="billtop noprint"><button className="ghost" onClick={back} aria-label="Back">← Back</button><button className="ghost" onClick={back} aria-label="Close the bill">✕ Close</button></div>
    <BillDoc bill={bill} />
    <div className="billact noprint"><button onClick={print}>Print or save as PDF</button><button className="ghost" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>{slug && <Link className="btn" to={'/' + slug}>Back to the menu</Link>}</div>
    <p className="muted noprint" style={{ textAlign: 'center' }}>This page updates by itself when your payment is recorded.</p>
  </main>)
}
