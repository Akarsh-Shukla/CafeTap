import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, ago, clock, STATUS_LABEL, MSG } from '../../lib/pos'
import { readPrefs, notify } from '../../lib/alerts'
import AlertBar from '../../components/AlertBar'

// Kitchen screen: only approved orders appear here. Big text, two buttons, and an alert when a new order arrives.
export default function Kitchen({ cafe }) {
  const [d, setD] = useState(null), [err, setErr] = useState(false), [msg, setMsg] = useState(''), [prefs, setPrefs] = useState(readPrefs), seen = useRef(null)
  const load = useCallback(async () => { const r = await rpc('pos_board', { p_cafe: cafe.id, p_view: 'kitchen' }); if (r && r.tables) { setD(r); setErr(false) } else setErr(true) }, [cafe.id])
  useEffect(() => { load(); const id = setInterval(() => { if (prefs.on || !document.hidden) load() }, prefs.on ? 5000 : 8000); return () => clearInterval(id) }, [load, prefs.on])
  const orders = d?.orders || [], items = d?.items || []
  const tname = o => d.tables.find(t => t.id === d.sessions.find(s => s.id === o.session_id)?.table_id)?.display_name || 'a table'
  const fresh = orders.filter(o => o.status === 'received')
  useEffect(() => {
    if (!d) return
    if (seen.current === null) { seen.current = new Set(fresh.map(o => o.id)); return }
    const nw = fresh.filter(o => !seen.current.has(o.id)); nw.forEach(o => seen.current.add(o.id))
    if (nw.length) notify(prefs, 'Kitchen', nw.length === 1 ? `New order for the kitchen. ${tname(nw[0])}.` : `${nw.length} new orders for the kitchen.`)
  }, [d])
  useEffect(() => { document.title = fresh.length ? `(${fresh.length}) Kitchen` : 'Kitchen'; return () => { document.title = 'CafeTap' } }, [fresh.length])
  const go = async (o, status) => { const r = await rpc('pos_set_order_status', { p_order: o.id, p_status: status }); setMsg(r.ok === false ? MSG[r.reason] || MSG.error : ''); load() }
  if (!d) return <p className="muted" role="status">{err ? 'Can’t reach the server. Retrying…' : 'Loading…'}</p>
  return (<>
    <AlertBar prefs={prefs} setPrefs={setPrefs} label="Kitchen" cafeId={cafe.id} />
    {err && <p className="err" role="status">Can’t refresh right now. Showing the last update; retrying.</p>}
    {msg && <p className="err" role="alert">{msg}</p>}
    {!orders.length && <p className="panel">No orders to cook right now.</p>}
    <div className="kgrid">{orders.map(o => <div key={o.id} className={'panel kcard k-' + o.status}>
      <div className="row"><b className="ktable">{tname(o)}</b><span className="tstate">{STATUS_LABEL[o.status]}</span><span className="muted">#{o.ref} · {clock(o.created_at)} · {ago(o.created_at)}</span></div>
      {items.filter(i => i.order_id === o.id).map((i, k) => <div key={k} className="kline">{i.quantity} × {i.name_snapshot}
        {i.combo?.length > 0 && <small className="kmods">Includes: {i.combo.map(x => (x.qty > 1 ? x.qty + '× ' : '') + x.name).join(', ')}</small>}
        {i.addons?.length > 0 && <small className="kmods">+ {i.addons.map(a => a.name).join(', ')}</small>}</div>)}
      {o.note && <p className="knote">Note: {o.note}</p>}
      {o.status === 'received' && <button onClick={() => go(o, 'preparing')}>Start cooking</button>}
      {o.status === 'preparing' && <button onClick={() => go(o, 'ready')}>Mark ready</button>}
      {o.status === 'ready' && <p className="muted">Ready. Waiting for service.</p>}
    </div>)}</div>
  </>)
}
