import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { rpc, rupees, ago, clock, newKey, STATUS_LABEL, MSG } from '../../lib/pos'
import { readPrefs, notify } from '../../lib/alerts'
import { loadExtras } from '../../lib/menu'
import AlertBar from '../../components/AlertBar'
import BillDoc from '../../components/BillDoc'
import { useCart, AddonSheet, lineUnit, lineLabel } from '../Order.jsx'

const NEXT = { pending: ['received', 'Approve order'], received: ['preparing', 'Start preparing'], preparing: ['ready', 'Mark ready'], ready: ['completed', 'Mark completed'] }
export const OrderLine = ({ i }) => <div className="row"><span style={{ flex: 1 }}>{i.quantity} × {i.name_snapshot}{i.combo?.length > 0 && <small className="inc"> Includes {i.combo.map(x => (x.qty > 1 ? x.qty + '× ' : '') + x.name).join(', ')}</small>}{i.addons?.length > 0 && <small className="inc"> + {i.addons.map(a => a.name).join(', ')}</small>}</span><span>{rupees(i.line_total_minor)}</span></div>

// Live table board for owner and staff. One request every few seconds; if it fails the last good picture stays on screen.
export default function Board({ cafe, perms }) {
  const [d, setD] = useState(null), [err, setErr] = useState(false), [sel, setSel] = useState(null), [msg, setMsg] = useState(''), [prefs, setPrefs] = useState(readPrefs), seen = useRef(null)
  const load = useCallback(async () => { const r = await rpc('pos_board', { p_cafe: cafe.id, p_view: 'full' }); if (r && r.tables) { setD(r); setErr(false) } else setErr(true) }, [cafe.id])
  useEffect(() => { load(); const id = setInterval(() => { if (prefs.on || !document.hidden) load() }, prefs.on ? 5000 : 8000); return () => clearInterval(id) }, [load, prefs.on])
  const tables = d?.tables || [], sess = d?.sessions || [], bills = d?.bills || [], orders = d?.orders || []
  const tname = o => tables.find(t => t.id === sess.find(x => x.id === o.session_id)?.table_id)?.display_name || 'a table'
  const waiting = orders.filter(o => o.status === 'pending')
  useEffect(() => {   // announce guest orders that arrive while this screen is open
    if (!d) return
    if (seen.current === null) { seen.current = new Set(waiting.map(o => o.id)); return }
    const fresh = waiting.filter(o => !seen.current.has(o.id)); fresh.forEach(o => seen.current.add(o.id))
    if (fresh.length) notify(prefs, 'New order', fresh.length === 1 ? `New order at ${tname(fresh[0])}. Please approve it.` : `${fresh.length} new orders are waiting for approval.`)
  }, [d])
  useEffect(() => { document.title = waiting.length ? `(${waiting.length}) New order` : 'CafeTap'; return () => { document.title = 'CafeTap' } }, [waiting.length])
  const act = async p => { const r = await p; setMsg(r && r.ok === false ? (MSG[r.reason] || MSG.error) + (r.reason === 'unpaid' ? ' Balance: ' + rupees(r.balance_minor) : '') : ''); load(); return r }

  const view = t => {
    const s = sess.find(x => x.table_id === t.id), b = s && bills.find(x => x.session_id === s.id), os = s ? orders.filter(o => o.session_id === s.id) : []
    const live = os.some(o => ['pending', 'received', 'preparing', 'ready'].includes(o.status)), bal = b ? b.total_minor - b.paid_minor : 0
    const state = !s ? 'Available' : os.some(o => o.status === 'pending') ? 'Needs approval' : live ? 'Active' : bal > 0 ? 'Payment pending' : b && b.total_minor > 0 ? 'Paid, ready to close' : 'Open, no billable orders'
    return { t, s, b, os, bal, state, live }
  }
  if (!d) return <p className="muted" role="status">{err ? 'Can’t reach the server. Retrying…' : 'Loading tables…'}</p>
  const cur = sel && view(tables.find(x => x.id === sel) || {})
  if (cur && cur.t.id) return <Detail key={cur.t.id} cafe={cafe} perms={perms} v={cur} items={d.items} pays={d.payments} act={act} msg={msg} err={err} back={() => { setSel(null); setMsg('') }} />
  const grid = tables.filter(t => t.is_active).map(view)
  return (<>
    <AlertBar prefs={prefs} setPrefs={setPrefs} label="Order" cafeId={cafe.id} />
    {err && <p className="err" role="status">Can’t refresh right now. Showing the last update; retrying.</p>}
    {waiting.length > 0 && <p className="panel newwait" role="status"><b>{waiting.length} {waiting.length === 1 ? 'order is' : 'orders are'} waiting for your approval.</b> Open the table, check the order, then approve or reject it.</p>}
    <p className="muted">Updates every few seconds. Payment is collected at the counter and recorded by staff.</p>
    {!grid.length && <p className="panel">No tables yet. Ask CafeTap to add your tables.</p>}
    <div className="tboard">{grid.map(v => <button key={v.t.id} className={'tcell' + (v.s ? ' on' : '')} onClick={() => setSel(v.t.id)}>
      <b>{v.t.display_name}</b><span className="tstate">{v.state}</span>
      {v.s && <small>{v.os.filter(o => o.status !== 'cancelled').length} orders · {rupees(v.b?.total_minor)} · {ago(v.s.opened_at)}</small>}
      {v.os.some(o => o.status === 'pending') && <em className="newtag">New order</em>}</button>)}</div>
  </>)
}

function BillSheet({ billId, onClose }) {
  const [bill, setBill] = useState(null)
  useEffect(() => { rpc('pos_bill_view', { p_bill: billId }).then(r => setBill(r.ok ? r : false)); const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [billId])
  const print = () => { document.body.classList.add('printing-bill'); window.print(); setTimeout(() => document.body.classList.remove('printing-bill'), 800) }
  return (<div className="modal" role="dialog" aria-modal="true" aria-label="Bill"><div className="modalbody">
    {bill === null && <p className="muted">Loading bill…</p>}{bill === false && <p className="err">Couldn’t load the bill.</p>}
    {bill && <BillDoc bill={bill} />}
    <div className="billact noprint"><button onClick={print} disabled={!bill}>Print bill</button><button className="ghost" onClick={onClose}>Close</button></div>
  </div></div>)
}

function Detail({ cafe, perms, v, items, pays, act, msg, err, back }) {
  const { t, s, b, os, bal } = v
  const [amt, setAmt] = useState(''), [method, setMethod] = useState('cash'), [note, setNote] = useState(''), [adding, setAdding] = useState(false), [showBill, setShowBill] = useState(false)
  useEffect(() => { setAmt(bal > 0 ? String(bal / 100) : '') }, [bal])
  const bp = b ? pays.filter(p => p.bill_id === b.id) : []
  const pay = async () => { const m = Math.round(parseFloat(amt || 0) * 100); await act(rpc('pos_record_payment', { p_bill: b.id, p_amount: m, p_method: method, p_note: note })); setNote('') }
  const close = () => { if (confirm(`Close ${t.display_name}? Make sure the payment has been received. A new group will start a fresh bill.`)) act(rpc('pos_close_session', { p_session: s.id })).then(r => r?.ok && back()) }
  const free = (b?.offer?.free_items || []).map(f => (f.qty > 1 ? f.qty + '× ' : '') + f.name).join(', ')
  return (<div className="posdetail">
    <button className="link" onClick={back}>← All tables</button>
    <h2>{t.display_name} <span className="tstate">{v.state}</span></h2>
    {s && <p className="muted">Open for {ago(s.opened_at)}</p>}
    {err && <p className="err" role="status">Can’t refresh right now. Showing the last update.</p>}
    {msg && <p className="err" role="alert">{msg}</p>}
    {os.map(o => <div key={o.id} className={'panel oline' + (o.status === 'cancelled' ? ' void' : '')}>
      <div className="row"><b>#{o.ref}</b><span className="muted">{clock(o.created_at)} · {o.source === 'staff' ? 'counter' : 'customer'}</span><span className="tstate">{STATUS_LABEL[o.status]}</span></div>
      {items.filter(i => i.order_id === o.id).map((i, k) => <OrderLine key={k} i={i} />)}
      {o.note && <p className="muted">Note: {o.note}</p>}
      {o.status === 'pending' && <p className="newwait"><b>Waiting for staff approval.</b> It is not on the bill or in the kitchen yet.</p>}
      {perms.orders && NEXT[o.status] && <div className="row"><button onClick={() => act(rpc('pos_set_order_status', { p_order: o.id, p_status: NEXT[o.status][0] }))}>{NEXT[o.status][1]}</button>
        <button className="link danger" onClick={() => confirm((o.status === 'pending' ? 'Reject' : 'Cancel') + ' order #' + o.ref + '?') && act(rpc('pos_set_order_status', { p_order: o.id, p_status: 'cancelled' }))}>{o.status === 'pending' ? 'Reject order' : 'Cancel order'}</button></div>}
    </div>)}
    {b && <div className="panel"><h3 style={{ margin: 0 }}>Bill</h3>
      <div className="row"><span style={{ flex: 1 }}>Subtotal</span><b>{rupees(b.subtotal_minor)}</b></div>
      {b.discount_minor > 0 && <div className="row offerline"><span style={{ flex: 1 }}>Offer: {b.offer?.title}<small className="muted"> {b.offer?.rule}{free ? ' · Free: ' + free : ''}</small></span><b>−{rupees(b.discount_minor)}</b></div>}
      <div className="row"><span style={{ flex: 1 }}>Total to pay</span><b>{rupees(b.total_minor)}</b></div>
      <div className="row"><span style={{ flex: 1 }}>Paid</span><b>{rupees(b.paid_minor)}</b></div>
      <div className="row"><span style={{ flex: 1 }}>Balance due</span><b>{rupees(bal)}</b></div>
      {b.discount_minor > 0 && b.paid_minor === 0 && <p className="muted">The offer is worked out automatically and locks when the first payment is recorded.</p>}
      {bp.map(p => <div key={p.id} className="row muted"><span style={{ flex: 1 }}>{p.event_type === 'correction' ? 'Correction' : 'Payment'} ({p.method.toUpperCase()}) {clock(p.recorded_at)}{p.note ? ' · ' + p.note : ''}</span><span>{rupees(p.amount_minor)}</span>
        {perms.owner && p.event_type === 'payment' && !bp.some(x => x.corrects === p.id) && <button className="link danger" onClick={() => { const r = prompt('Reason for correcting this payment?'); if (r) act(rpc('pos_correct_payment', { p_event: p.id, p_reason: r })) }}>Correct</button>}</div>)}
      {perms.payments && bal > 0 && <div className="payform"><label>Amount received (₹)</label><input type="number" min="0" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} />
        <label>Method (check the money or your UPI app first)</label><select value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI (confirmed in my app)</option></select>
        <input placeholder="Note (optional)" maxLength={140} value={note} onChange={e => setNote(e.target.value)} /><button onClick={pay}>Record payment</button></div>}
      <p className="muted">CafeTap records what your staff confirm. It does not verify UPI or cash itself.</p>
      <div className="row"><button className="ghost" onClick={() => setShowBill(true)}>View / print bill</button>
        {perms.close && <button onClick={close} disabled={bal > 0}>{bal > 0 ? 'Settle balance to close' : 'Close table'}</button>}</div>
    </div>}
    {perms.orders && !adding && <button className="ghost" onClick={() => setAdding(true)}>+ Add counter order</button>}
    {adding && <AddOrder cafe={cafe} table={t} act={act} done={() => setAdding(false)} />}
    {showBill && b && <BillSheet billId={b.id} onClose={() => setShowBill(false)} />}
  </div>)
}

function AddOrder({ cafe, table, act, done }) {
  const [cats, setCats] = useState([]), [ex, setEx] = useState({ groups: {}, addonById: {}, combo: {}, isCombo: {} }), [note, setNote] = useState(''), [key] = useState(newKey), [picker, setPicker] = useState(null), [busy, setBusy] = useState(false)
  const { lines, addLine, decKey } = useCart()
  useEffect(() => { supabase.from('menu_categories').select('id,name,sort_order,menu_items(id,name,price_paise,is_available,sort_order)').eq('cafe_id', cafe.id).order('sort_order').then(({ data }) => { setCats(data || []); loadExtras(cafe.id, Object.fromEntries((data || []).flatMap(c => c.menu_items).map(i => [i.id, i]))).then(setEx) }) }, [cafe.id])
  const byId = Object.fromEntries(cats.flatMap(c => c.menu_items).map(i => [i.id, i])), n = lines.reduce((s, l) => s + l.qty, 0), total = lines.reduce((s, l) => s + lineUnit(l, byId, ex) * l.qty, 0)
  const pick = i => ex.groups[i.id]?.length ? setPicker(i) : addLine(i.id)
  const send = async () => { setBusy(true); const r = await act(rpc('pos_staff_add_order', { p_cafe: cafe.id, p_table: table.id, p_idem: key, p_items: lines.map(l => ({ id: l.id, qty: l.qty, addons: l.adds })), p_note: note })); setBusy(false); if (r?.ok) done() }
  return (<div className="panel"><h3 style={{ marginTop: 0 }}>Counter order for {table.display_name}</h3>
    {cats.map(c => <div key={c.id}><b>{c.name}</b>{[...c.menu_items].sort((a, b) => a.sort_order - b.sort_order).filter(i => i.is_available).map(i => <div key={i.id} className="row"><span style={{ flex: 1 }}>{i.name}{ex.isCombo[i.id] && ' (combo)'} <span className="muted">{rupees(i.price_paise)}</span></span>
      <button onClick={() => pick(i)} aria-label={'Add ' + i.name}>{ex.groups[i.id]?.length ? 'Options' : 'Add'}</button></div>)}</div>)}
    {lines.length > 0 && <div className="panel">{lines.map(l => <div key={l.key} className="row"><span style={{ flex: 1 }}>{l.qty} × {byId[l.id]?.name}{lineLabel(l, ex) && <small className="inc"> + {lineLabel(l, ex)}</small>}</span><span>{rupees(lineUnit(l, byId, ex) * l.qty)}</span><button className="ghost" onClick={() => decKey(l.key)} aria-label={'Remove one ' + byId[l.id]?.name}>−</button></div>)}</div>}
    <input placeholder="Note (optional)" maxLength={140} value={note} onChange={e => setNote(e.target.value)} />
    <div className="row"><button disabled={!n || busy} onClick={send}>Add order · {rupees(total)}</button><button className="link" onClick={done}>Cancel</button></div>
    {picker && <AddonSheet item={picker} groups={ex.groups[picker.id] || []} onClose={() => setPicker(null)} onAdd={ids => { addLine(picker.id, ids); setPicker(null) }} />}</div>)
}

export { Detail, AddOrder }
