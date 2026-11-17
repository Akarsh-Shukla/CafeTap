import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc, rupees } from '../lib/pos'
import { getReceipt, clearReceipt } from '../lib/receipt'

// Always-visible summary of the guest's table bill: order progress, amount and payment. It stays until the table is closed.
const progress = os => {
  const s = os.map(o => o.status)
  if (!s.length || s.every(x => x === 'cancelled')) return null
  return s.includes('pending') ? 'Waiting for the café to confirm' : s.some(x => x === 'received' || x === 'preparing') ? 'Your order is being prepared' : s.includes('ready') ? 'Your order is ready' : 'Your order has been served'
}
export default function RunningBill({ cafe }) {
  const [b, setB] = useState(null)
  useEffect(() => {
    let live = true
    const load = async () => {
      const t = getReceipt(cafe.id); if (!t) { live && setB(null); return }
      const r = await rpc('pos_my_bill', { p_receipt: t }); if (!live) return
      if (r.ok && r.open) setB({ ...r, token: t }); else { setB(null); if (!r.ok && r.reason === 'none') clearReceipt(cafe.id) }
    }
    load(); const id = setInterval(() => { if (!document.hidden) load() }, 10000)
    addEventListener('ct-receipt', load); addEventListener('focus', load); document.addEventListener('visibilitychange', load)
    return () => { live = false; clearInterval(id); removeEventListener('ct-receipt', load); removeEventListener('focus', load); document.removeEventListener('visibilitychange', load) }
  }, [cafe.id])
  const p = b && progress(b.orders); if (!b || !p) return null
  const pay = b.payment.state
  return (<Link to={'/bill/' + b.token} className="runbill" aria-live="polite"><span><b>{p}</b><small>{pay === 'paid' ? 'Paid ✓' : pay === 'partial' ? 'Partly paid' : 'Pay at the counter'} · {b.shared ? 'Table total ' : ''}{rupees(b.total_minor)}</small></span><span className="rbgo">View bill →</span></Link>)
}
