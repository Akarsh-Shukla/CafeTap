import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const blank = { title: '', details: '', kind: 'info', percent: '', flat: '', buy: '1', get: '1', min: '', max: '', scope: 'all', ids: [], starts_on: '', valid_until: '', days: [], from_time: '', to_time: '' }
const inr = m => '₹' + (m / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const KINDS = [['info', 'Announcement only (staff apply it by hand)'], ['percent', 'Percentage off the bill'], ['flat', 'Flat amount off the bill'], ['bogo', 'Buy some, get some free']]

// Owner's offers. Percent, flat and buy-X-get-Y offers are applied automatically on table bills (POS plan): the single best offer wins.
export default function Offers({ cafe, pos }) {
  const [rows, setRows] = useState([]), [f, setF] = useState(blank), [edit, setEdit] = useState(null), [msg, setMsg] = useState(''), [cats, setCats] = useState([])
  const load = async () => { const { data } = await supabase.from('offers').select('*').eq('cafe_id', cafe.id).order('created_at', { ascending: false }); setRows(data || []) }
  useEffect(() => { load(); supabase.from('menu_categories').select('id,name,menu_items(id,name)').eq('cafe_id', cafe.id).order('sort_order').then(({ data }) => setCats(data || [])) }, [cafe.id])
  const names = Object.fromEntries(cats.flatMap(c => [[c.id, c.name], ...c.menu_items.map(i => [i.id, i.name])]))
  const set = (k, v) => setF(x => ({ ...x, [k]: v })), tog = (k, v) => setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }))
  const rule = o => o.kind === 'info' ? (o.details || '') : (o.kind === 'percent' ? `${o.percent}% off` : o.kind === 'flat' ? `${inr(o.flat_minor)} off` : `Buy ${o.buy_qty}, get ${o.get_qty} free`)
    + (o.scope !== 'all' ? ' on ' + o.scope_ids.map(i => names[i] || '…').slice(0, 3).join(', ') : '') + (o.min_subtotal_minor ? ` for orders above ${inr(o.min_subtotal_minor)}` : '') + (o.max_discount_minor ? ` (up to ${inr(o.max_discount_minor)})` : '')
  const status = o => { const t = new Date().toISOString().slice(0, 10); return !o.is_active ? 'Paused' : o.valid_until && o.valid_until < t ? 'Expired' : o.starts_on && o.starts_on > t ? 'Scheduled' : 'Live' }
  const body = () => {
    const k = f.kind, n = x => Number(x), minM = Math.round(n(f.min || 0) * 100)
    if (!f.title.trim()) return 'Please give the offer a title.'
    if (k === 'percent' && !(n(f.percent) > 0 && n(f.percent) <= 100)) return 'Enter a percentage between 1 and 100.'
    if (k === 'flat' && !(n(f.flat) > 0)) return 'Enter the amount to take off.'
    if (k === 'bogo' && !(n(f.buy) >= 1 && n(f.get) >= 1)) return 'Enter how many to buy and how many are free.'
    if ((k === 'bogo' && f.scope === 'all') || (f.scope !== 'all' && !f.ids.length)) return 'Choose which items or categories this applies to.'
    if (!(minM >= 0)) return 'Check the minimum order amount.'
    return { cafe_id: cafe.id, title: f.title.trim(), details: f.details.trim() || null, kind: k, percent: k === 'percent' ? n(f.percent) : null, flat_minor: k === 'flat' ? Math.round(n(f.flat) * 100) : null,
      min_subtotal_minor: k === 'info' ? 0 : minM, max_discount_minor: k === 'percent' && f.max ? Math.round(n(f.max) * 100) : null, buy_qty: k === 'bogo' ? n(f.buy) : null, get_qty: k === 'bogo' ? n(f.get) : null,
      scope: k === 'info' ? 'all' : f.scope, scope_ids: k === 'info' || f.scope === 'all' ? [] : f.ids, starts_on: f.starts_on || null, valid_until: f.valid_until || null, days: f.days.length && f.days.length < 7 ? f.days.map(Number) : null, from_time: f.from_time || null, to_time: f.from_time && f.to_time ? f.to_time : null }
  }
  const save = async e => {
    e.preventDefault(); const b = body(); if (typeof b === 'string') { setMsg(b); return }
    const { error } = edit ? await supabase.from('offers').update(b).eq('id', edit) : await supabase.from('offers').insert(b)
    if (error) { setMsg('Could not save. Please check the numbers and dates.'); return }
    setMsg(''); setF(blank); setEdit(null); load()
  }
  const start = o => { setEdit(o.id); setMsg(''); setF({ title: o.title, details: o.details || '', kind: o.kind, percent: o.percent ?? '', flat: o.flat_minor ? o.flat_minor / 100 : '', buy: String(o.buy_qty || 1), get: String(o.get_qty || 1), min: o.min_subtotal_minor ? o.min_subtotal_minor / 100 : '', max: o.max_discount_minor ? o.max_discount_minor / 100 : '', scope: o.scope, ids: o.scope_ids || [], starts_on: o.starts_on || '', valid_until: o.valid_until || '', days: (o.days || []).map(String), from_time: (o.from_time || '').slice(0, 5), to_time: (o.to_time || '').slice(0, 5) }); window.scrollTo(0, 0) }
  const up = async (id, v) => { await supabase.from('offers').update(v).eq('id', id); load() }
  const del = async id => { if (confirm('Delete this offer?')) { await supabase.from('offers').delete().eq('id', id); load() } }
  const auto = f.kind !== 'info'
  return (<>
    <form className="panel" onSubmit={save}><h2>{edit ? 'Edit offer' : 'New offer'}</h2>
      <label>Title customers will see</label><input required maxLength={80} value={f.title} onChange={e => set('title', e.target.value)} placeholder="Buy 1 get 1 on cold coffee" />
      <label>Type</label><select value={f.kind} onChange={e => set('kind', e.target.value)}>{KINDS.filter(([k]) => pos || k === 'info').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {!pos && <p className="muted">Automatic discounts on bills are part of the POS plan.</p>}
      {f.kind === 'percent' && <><label>Percent off</label><input type="number" min="1" max="100" step="0.5" value={f.percent} onChange={e => set('percent', e.target.value)} /><label>Most you will give off (₹, optional)</label><input type="number" min="1" step="1" value={f.max} onChange={e => set('max', e.target.value)} /></>}
      {f.kind === 'flat' && <><label>Amount off (₹)</label><input type="number" min="1" step="1" value={f.flat} onChange={e => set('flat', e.target.value)} /></>}
      {f.kind === 'bogo' && <div className="row"><div><label>Customer buys</label><input type="number" min="1" max="10" value={f.buy} onChange={e => set('buy', e.target.value)} /></div><div><label>Gets free</label><input type="number" min="1" max="10" value={f.get} onChange={e => set('get', e.target.value)} /></div></div>}
      {auto && <><label>Applies to</label><select value={f.scope} onChange={e => setF({ ...f, scope: e.target.value, ids: [] })}><option value="all" disabled={f.kind === 'bogo'}>The whole bill</option><option value="items">Chosen items</option><option value="category">Chosen categories</option></select>
        {f.scope === 'items' && <div className="pickbox">{cats.map(c => <div key={c.id}><b>{c.name}</b>{c.menu_items.map(i => <label key={i.id} className="chk"><input type="checkbox" checked={f.ids.includes(i.id)} onChange={() => tog('ids', i.id)} /> {i.name}</label>)}</div>)}</div>}
        {f.scope === 'category' && <div className="pickbox">{cats.map(c => <label key={c.id} className="chk"><input type="checkbox" checked={f.ids.includes(c.id)} onChange={() => tog('ids', c.id)} /> {c.name}</label>)}</div>}
        <label>Only when the bill is at least (₹, optional)</label><input type="number" min="0" step="1" value={f.min} onChange={e => set('min', e.target.value)} />
        {f.kind === 'bogo' && <p className="muted">When a guest orders more than needed, the cheapest eligible units are the free ones.</p>}</>}
      <label>Details (optional)</label><input maxLength={300} value={f.details} onChange={e => set('details', e.target.value)} />
      <div className="row"><div><label>Starts (optional)</label><input type="date" value={f.starts_on} onChange={e => set('starts_on', e.target.value)} /></div><div><label>Valid until (optional)</label><input type="date" value={f.valid_until} onChange={e => set('valid_until', e.target.value)} /></div></div>
      <details><summary>Days and hours (optional, for happy hours)</summary>
        <div className="row">{DAYS.map((d, k) => <label key={d} className="chk"><input type="checkbox" checked={f.days.includes(String(k))} onChange={() => tog('days', String(k))} /> {d}</label>)}</div>
        <div className="row"><div><label>From</label><input type="time" value={f.from_time} onChange={e => set('from_time', e.target.value)} /></div><div><label>To</label><input type="time" value={f.to_time} onChange={e => set('to_time', e.target.value)} /></div></div>
        <p className="muted">Leave empty for every day and all hours. Times use Indian time.</p></details>
      {auto && <p className="muted">The single best live offer is applied to the table’s bill automatically. The bill shows which offer was used and what it took off. Prices already include tax, so the discount is taken from the final price.</p>}
      <div className="row"><button>{edit ? 'Save changes' : 'Add offer'}</button>{edit && <button type="button" className="link" onClick={() => { setEdit(null); setF(blank); setMsg('') }}>Cancel</button>}</div>{msg && <p className="err" role="alert">{msg}</p>}</form>
    {rows.map(o => <div key={o.id} className="panel"><div className="row"><b style={{ flex: 1 }}>{o.title}</b><span className="tstate">{status(o)}</span></div>
      {rule(o) && <p>{rule(o)}</p>}{o.kind !== 'info' && o.details && <p className="muted">{o.details}</p>}
      <p className="muted">{o.kind === 'info' ? 'Announcement' : 'Applied automatically'}{o.starts_on ? ` · from ${o.starts_on}` : ''}{o.valid_until ? ` · until ${o.valid_until}` : ''}{o.days ? ' · ' + o.days.map(d => DAYS[d]).join(', ') : ''}{o.from_time ? ` · ${o.from_time.slice(0, 5)}–${(o.to_time || '').slice(0, 5)}` : ''}</p>
      <label className="chk"><input type="checkbox" checked={o.is_active} onChange={e => up(o.id, { is_active: e.target.checked })} /> Showing to customers</label>
      <div className="row"><button className="ghost" onClick={() => start(o)}>Edit</button><button className="link danger" onClick={() => del(o.id)}>Delete</button></div></div>)}
  </>)
}
