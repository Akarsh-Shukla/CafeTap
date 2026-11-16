import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc, rupees, newKey, getPosition, MSG } from '../lib/pos'

const capKey = id => 'ct_cap_' + id, refsKey = id => 'ct_refs_' + id
const read = k => { try { return JSON.parse(sessionStorage.getItem(k)) } catch { return null } }
const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch {} }
const keyOf = (id, adds) => id + '|' + [...adds].sort().join(',')
// A chosen "version" (Half/Full, Veg/Non-veg) sets the dish price; ordinary add-ons are added on top. The server does the same sum when it prices the order.
export const lineUnit = (l, byId, ex) => { let base = byId[l.id]?.price_paise || 0, extra = 0; for (const a of l.adds) { const x = ex.addonById[a]; if (!x) continue; if (x.variant) base = x.price_minor; else extra += x.price_minor } return base + extra }
export const lineName = (l, byId, ex) => { const v = l.adds.map(a => ex.addonById[a]).find(x => x?.variant); return (byId[l.id]?.name || '') + (v ? ` (${v.name})` : '') }
export const lineLabel = (l, ex) => l.adds.map(a => ex.addonById[a]).filter(x => x && !x.variant).map(x => x.name).join(', ')

// The cart: a list of lines, each an item plus its chosen add-ons. Shared by the guest menu and the staff counter order.
export function useCart() {
  const [lines, setLines] = useState([])
  const addLine = (id, adds = []) => setLines(ls => {
    const k = keyOf(id, adds); if (ls.reduce((s, l) => s + l.qty, 0) >= 60) return ls
    return ls.some(l => l.key === k) ? ls.map(l => l.key === k ? { ...l, qty: Math.min(l.qty + 1, 20) } : l) : [...ls, { key: k, id, adds: [...adds].sort(), qty: 1 }]
  })
  const decKey = k => setLines(ls => ls.flatMap(l => l.key !== k ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))
  return { lines, setLines, addLine, decKey }
}

// Tells the menu whether this guest can order (café has the POS plan, ordering is on, and they arrived through a table link).
export function useOrdering(cafe) {
  let table = null; try { table = sessionStorage.getItem('ct_tbl_' + cafe.id) } catch {}
  const { lines, setLines, addLine, decKey } = useCart()
  const [enabled, setEnabled] = useState(false), [ex, setEx] = useState({ groups: {}, addonById: {}, combo: {}, isCombo: {}, from: {}, diets: {} }), [picker, setPicker] = useState(null)
  useEffect(() => { rpc('pos_ordering_state', { p_cafe: cafe.id }).then(r => setEnabled(!!r.enabled)) }, [cafe.id])
  const qtyOf = id => lines.filter(l => l.id === id).reduce((s, l) => s + l.qty, 0)
  const custom = id => !!ex.groups[id]?.length
  const pick = item => custom(item.id) ? setPicker(item) : addLine(item.id)
  const sub = id => { const l = lines.find(x => x.key === keyOf(id, [])) || lines.find(x => x.id === id); if (l) decKey(l.key) }
  const price = i => (ex.from[i.id] != null ? 'from ' : '') + rupees(ex.from[i.id] ?? i.price_paise)
  return { enabled, table, can: enabled && !!table, hint: enabled && !table, lines, setLines, addLine, decKey, qtyOf, custom, pick, sub, price, ex, setEx, picker, setPicker }
}

export const Stepper = ({ qty, onAdd, onSub, name, custom }) => custom
  ? <button className="step add" onClick={onAdd} aria-label={'Customise and add ' + name}>{qty ? <i className="qbadge">{qty}</i> : null}Add</button>
  : qty ? <div className="step" role="group" aria-label={'Quantity of ' + name}><button onClick={onSub} aria-label={'Remove one ' + name}>−</button><b key={qty} aria-live="polite">{qty}</b><button onClick={onAdd} aria-label={'Add one ' + name}>+</button></div>
  : <button className="step add" onClick={onAdd} aria-label={'Add ' + name}>Add</button>

// Choose a version (Half/Full, Veg/Non-veg: sets the price) and add-ons (extra shot, size, no sugar: added to the price) for one dish.
export function AddonSheet({ item, groups, onClose, onAdd, vegOnly }) {
  const [sel, setSel] = useState({}), ordered = [...groups].sort((a, b) => (a.kind === 'variant' ? 0 : 1) - (b.kind === 'variant' ? 0 : 1))
  const shown = g => { const all = g.addons; if (g.kind !== 'variant' || !vegOnly) return all; const v = all.filter(a => a.diet !== 'nonveg' && a.diet !== 'egg'); return v.length ? v : all }
  const toggle = (g, id) => setSel(s => { const cur = s[g.id] || []; const nx = g.max_select === 1 ? (cur[0] === id ? [] : [id]) : cur.includes(id) ? cur.filter(x => x !== id) : cur.length < g.max_select ? [...cur, id] : cur; return { ...s, [g.id]: nx } })
  const ids = Object.values(sel).flat(), vIds = ordered.filter(g => g.kind === 'variant').flatMap(g => g.addons.map(a => a.id)), chosen = ordered.flatMap(g => g.addons).filter(a => ids.includes(a.id))
  const ok = groups.every(g => (sel[g.id] || []).length >= g.min_select), variant = chosen.find(a => vIds.includes(a.id))
  const total = (variant ? variant.price_minor : item.price_paise || 0) + chosen.filter(a => !vIds.includes(a.id)).reduce((s, a) => s + a.price_minor, 0)
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  return (<><div className="scrim on" onClick={onClose} />
    <div className="sheet on" role="dialog" aria-modal="true" aria-label={'Customise ' + item.name}><div className="sheetbody">
      <button className="x" onClick={onClose} aria-label="Close">×</button><span className="script">Make it yours</span><h3>{item.name}</h3>
      {ordered.map(g => <fieldset key={g.id} className="optgrp"><legend>{g.name}<small className="mut"> {g.kind === 'variant' ? 'Choose one' : (g.min_select ? 'Required' : 'Optional') + ' · choose ' + (g.max_select === 1 ? 'one' : 'up to ' + g.max_select)}</small></legend>
        {shown(g).map(a => { const on = (sel[g.id] || []).includes(a.id); return <button type="button" key={a.id} className={'opt' + (on ? ' on' : '')} aria-pressed={on} disabled={!a.is_available} onClick={() => toggle(g, a.id)}>
          <span className="optl">{a.diet && <i className={'diet ' + a.diet} aria-hidden="true" />}<span>{a.name}{!a.is_available && <em> · Sold out</em>}</span></span><b>{g.kind === 'variant' ? rupees(a.price_minor) : a.price_minor ? '+' + rupees(a.price_minor) : 'Free'}</b></button> })}</fieldset>)}
      <button className="btn" disabled={!ok} onClick={() => onAdd(ids)}>Add to order · {rupees(total)}</button>
    </div></div></>)
}

export function CartBar({ ord, byId, onOpen }) {
  const n = ord.lines.reduce((s, l) => s + l.qty, 0), total = ord.lines.reduce((s, l) => s + lineUnit(l, byId, ord.ex) * l.qty, 0)
  if (!ord.can || !n) return null
  return <button className="cartbar" onClick={onOpen}><span>{n} {n === 1 ? 'item' : 'items'}</span><b>View order · {rupees(total)}</b></button>
}

const STATUS = { pending: 'Sent. Waiting for the café to confirm it', received: 'Confirmed by the café', preparing: 'Being prepared', ready: 'Ready', completed: 'Completed', cancelled: 'Not accepted by the café' }

export function CartSheet({ cafe, ord, byId, open, onClose, onRefresh }) {
  const [st, setSt] = useState('idle'), [msg, setMsg] = useState(''), [note, setNote] = useState(''), [done, setDone] = useState(null), [bill, setBill] = useState(null), [prev, setPrev] = useState(null)
  const idem = useRef(null)
  const lines = ord.lines.filter(l => byId[l.id]), total = lines.reduce((s, l) => s + lineUnit(l, byId, ord.ex) * l.qty, 0), payload = lines.map(l => ({ id: l.id, qty: l.qty, addons: l.adds }))
  useEffect(() => { idem.current = null }, [JSON.stringify(payload), note])   // a changed order gets a new duplicate-protection key
  useEffect(() => {   // the server prices the cart and shows which offer would apply
    if (!open || !payload.length || st === 'done') { setPrev(null); return }
    const t = setTimeout(() => { const cap = read(capKey(cafe.id)); rpc('pos_preview', { p_cafe: cafe.id, p_cap: cap?.token || null, p_items: payload }).then(r => setPrev(r.ok ? r : null)) }, 350)
    return () => clearTimeout(t)
  }, [open, JSON.stringify(payload), st])
  useEffect(() => {   // live status and payment of the order just placed
    if (!done) return
    const t = () => { const cap = read(capKey(cafe.id)); if (cap?.receipt) rpc('pos_my_bill', { p_receipt: cap.receipt }).then(r => r.ok && setBill(r)) }
    t(); const id = setInterval(t, 8000); return () => clearInterval(id)
  }, [done, cafe.id])

  const place = async (retry = false) => {
    setSt('working'); setMsg('')
    let cap = read(capKey(cafe.id))
    if (cap && (!cap.receipt || Date.parse(cap.exp) < Date.now() + 30000)) cap = null
    if (!cap) {
      let pos
      try { pos = await getPosition() } catch (e) {
        setSt('error'); setMsg(e && e.code === 1 ? 'Location permission was denied. You can still browse the menu. To order, allow location for this site and try again, or ask our staff to take your order.' : 'We couldn’t get your location. Please check that GPS is on and try again, or ask our staff.'); return
      }
      const r = await rpc('pos_start_session', { p_cafe: cafe.id, p_table: ord.table, p_lat: pos.latitude, p_lng: pos.longitude, p_accuracy: pos.accuracy })
      if (!r.ok) { setSt('error'); setMsg(MSG[r.reason] || MSG.error); return }
      cap = { token: r.capability, exp: r.expires_at, receipt: r.receipt }; write(capKey(cafe.id), cap)
    }
    idem.current = idem.current || newKey()
    const r = await rpc('pos_submit_order', { p_cap: cap.token, p_idem: idem.current, p_items: payload, p_note: note, p_expected: total })
    if (r.ok) {
      const refs = read(refsKey(cafe.id)) || []; write(refsKey(cafe.id), [r.ref, ...refs].slice(0, 10))
      ord.setLines([]); setNote(''); setBill(null); setDone({ ref: r.ref, total: r.total_minor }); setSt('done'); idem.current = null; return
    }
    if (r.reason === 'expired' && !retry) { try { sessionStorage.removeItem(capKey(cafe.id)) } catch {}; return place(true) }
    if (r.reason === 'price_changed') { onRefresh(); setSt('error'); setMsg('Prices changed while you were browsing. The new total is ' + rupees(r.total_minor) + '. Please review and place the order again.'); return }
    if (r.reason === 'unavailable') { onRefresh(); setSt('error'); setMsg('Some items just became unavailable' + (r.names?.length ? ': ' + r.names.join(', ') : '') + '. Please remove them and try again.'); return }
    if (r.reason === 'options') { setSt('error'); setMsg('Please choose the required options for: ' + (r.names || []).join(', ') + '. Remove the item and add it again.'); return }
    setSt('error'); setMsg(MSG[r.reason] || MSG.error)
  }
  const close = () => { onClose(); if (st === 'done') { setSt('idle'); setDone(null); setBill(null) } }
  const needLoc = !read(capKey(cafe.id))
  const mine = bill?.orders?.find(o => o.ref === done?.ref), pay = bill?.payment?.state, receipt = read(capKey(cafe.id))?.receipt
  return (<>
    <div className={'scrim' + (open ? ' on' : '')} onClick={close} />
    <div className={'sheet' + (open ? ' on' : '')} role="dialog" aria-modal="true" aria-label="Your order" aria-hidden={!open}>
      <div className="sheetbody">
        <button className="x" onClick={close} aria-label="Close">×</button>
        {st === 'done' && done ? <>
          <span className="script">Thank you</span><h3>Order {done.ref}</h3>
          <p className="price big">{rupees(bill && !bill.shared ? bill.total_minor : done.total)}</p>
          {bill?.offer && !bill.shared && <p className="offerline"><b>{bill.offer.title}</b> applied · you saved {rupees(bill.discount_minor)}</p>}
          <p><b>Status:</b> {STATUS[mine?.status] || STATUS.pending}</p>
          {mine?.status !== 'cancelled' && (pay === 'paid' ? <p className="badge paid">✓ Paid · Thank you</p> : pay === 'partial' ? <p className="badge">Partly paid · pay the rest at the counter</p> : <p className="badge">Pay at the counter · Payment pending</p>)}
          {receipt && <Link className="btn" to={'/bill/' + receipt} onClick={close}>{pay === 'paid' ? 'View your bill' : 'View bill so far'}</Link>}
          <p className="mut small">Keep this reference: {done.ref}. Your staff record your payment when you pay at the counter, and this screen updates by itself.</p>
        </> : <>
          <span className="script">Table order</span><h3>Your order</h3>
          {!lines.length && <p className="mut">Your order is empty.</p>}
          {lines.map(l => <div key={l.key} className="cl"><span>{lineName(l, byId, ord.ex)}{ord.ex.isCombo[l.id] && ord.ex.combo[l.id] && <small className="inc"> Includes {ord.ex.combo[l.id].join(', ')}</small>}{lineLabel(l, ord.ex) && <small className="inc"> + {lineLabel(l, ord.ex)}</small>}<small className="mut"> {rupees(lineUnit(l, byId, ord.ex))}</small></span>
            <span className="clq"><button onClick={() => ord.decKey(l.key)} aria-label={'Remove one ' + byId[l.id].name}>−</button><b>{l.qty}</b><button onClick={() => ord.addLine(l.id, l.adds)} aria-label={'Add one ' + byId[l.id].name}>+</button></span></div>)}
          <label className="mut small" htmlFor="ordnote">Note for the kitchen (optional)</label>
          <input id="ordnote" className="search" maxLength={140} value={note} onChange={e => setNote(e.target.value)} placeholder="Less sugar, no onions…" />
          {prev?.offer && prev.discount_minor > 0 && <div className="offerbox"><b>{prev.offer.title}</b><small>{prev.offer.rule}</small>
            {prev.offer.free_items?.length > 0 && <small>Free: {prev.offer.free_items.map(f => (f.qty > 1 ? f.qty + '× ' : '') + f.name).join(', ')}</small>}<span>You save {rupees(prev.discount_minor)}</span></div>}
          {prev?.next_offer && <p className="nudge">Add {rupees(prev.next_offer.need_minor)} more to get {prev.next_offer.title}<small> {prev.next_offer.rule}</small></p>}
          <p className="cl total"><b>{prev?.discount_minor > 0 ? 'Estimated total' : 'Total'}</b><b>{rupees(prev?.discount_minor > 0 ? (prev.includes_table ? prev.cart_total_minor - Math.min(prev.discount_minor, prev.cart_total_minor) : prev.payable_minor) : total)}</b></p>
          {prev?.discount_minor > 0 && <p className="mut small">Offers are worked out on your whole table’s bill, so the final amount may differ slightly. Your bill shows exactly what was applied.</p>}
          {needLoc && <p className="mut small">To order from your table we check that you’re inside the café. Your location is used once for this check and isn’t stored. You can keep browsing without sharing it.</p>}
          {msg && <p className="ordmsg" role="alert">{msg}</p>}
          <button className="btn" disabled={!lines.length || st === 'working'} onClick={() => place()}>{st === 'working' ? 'Please wait…' : needLoc ? 'Share location and place order' : 'Place order'}</button>
          <p className="mut small">Pay at the counter. The café confirms your payment; nothing is charged online.</p>
        </>}
      </div>
    </div>
  </>)
}
