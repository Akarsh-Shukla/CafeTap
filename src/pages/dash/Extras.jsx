import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const inr = m => '₹' + (m / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const errText = e => e ? (/foreign key|restrict|violates/i.test(e.message) ? 'That item is part of a combo, so it can’t be removed. Remove it from the combo first.' : 'Could not save. Please check what you entered.') : ''

// Combos (fixed bundles at one price) and add-ons (extra shot, size, no sugar...). Prices and rules are enforced by the database at order time.
export default function Extras({ cafe }) {
  const [d, setD] = useState({ cats: [], items: [], groups: [], links: [], combo: [] }), [msg, setMsg] = useState('')
  const load = async () => {
    const [c, i, g, l, k] = await Promise.all([
      supabase.from('menu_categories').select('id,name').eq('cafe_id', cafe.id).order('sort_order'), supabase.from('menu_items').select('id,name,category_id,is_combo,price_paise').eq('cafe_id', cafe.id).order('name'),
      supabase.from('addon_groups').select('id,name,min_select,max_select,addons(id,name,price_minor,is_available,sort_order)').eq('cafe_id', cafe.id).order('sort_order'),
      supabase.from('item_addon_groups').select('item_id,group_id').eq('cafe_id', cafe.id), supabase.from('combo_items').select('combo_id,item_id,qty').eq('cafe_id', cafe.id)])
    setD({ cats: c.data || [], items: i.data || [], groups: g.data || [], links: l.data || [], combo: k.data || [] })
  }
  useEffect(() => { load() }, [cafe.id])
  const run = async p => { const { error } = await p; setMsg(errText(error)); await load(); return !error }
  return (<>
    {msg && <p className="err" role="alert">{msg}</p>}
    <Combos cafe={cafe} d={d} run={run} setMsg={setMsg} load={load} />
    <AddonGroups cafe={cafe} d={d} run={run} />
  </>)
}

function Combos({ cafe, d, run, setMsg, load }) {
  const plain = d.items.filter(i => !i.is_combo), combos = d.items.filter(i => i.is_combo), name = id => d.items.find(i => i.id === id)?.name || '…'
  const [f, setF] = useState({ name: '', price: '', category: '', description: '' }), [parts, setParts] = useState([{ item: '', qty: 1 }]), [add, setAdd] = useState({})
  const create = async e => {
    e.preventDefault(); const rows = parts.filter(p => p.item)
    if (!f.name.trim() || !(Number(f.price) >= 0) || !f.category || !rows.length) { setMsg('Give the combo a name, a price, a category and at least one item.'); return }
    if (new Set(rows.map(p => p.item)).size !== rows.length) { setMsg('Each item can appear only once in a combo. Use the quantity instead.'); return }
    const { data, error } = await supabase.from('menu_items').insert({ cafe_id: cafe.id, category_id: f.category, name: f.name.trim(), description: f.description.trim() || null, price_paise: Math.round(Number(f.price) * 100), is_combo: true }).select('id').single()
    if (error) { setMsg('Could not create the combo.'); return }
    const r = await supabase.from('combo_items').insert(rows.map(p => ({ cafe_id: cafe.id, combo_id: data.id, item_id: p.item, qty: Number(p.qty) || 1 })))
    if (r.error) { await supabase.from('menu_items').delete().eq('id', data.id); setMsg('Could not add those items to the combo.'); return }
    setMsg(''); setF({ name: '', price: '', category: '', description: '' }); setParts([{ item: '', qty: 1 }]); load()
  }
  return (<>
    <form className="panel" onSubmit={create}><h2>Combos</h2><p className="muted">A combo is one menu item sold at one price that contains fixed items, like “Burger + Fries + Drink”. Guests order it like any dish, and the kitchen sees what is inside.</p>
      <label>Combo name</label><input maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Burger meal" />
      <div className="row"><div><label>Price (₹, tax included)</label><input type="number" min="0" step="1" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></div>
        <div><label>Shows under</label><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}><option value="">Choose…</option>{d.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
      <label>Description (optional)</label><input maxLength={200} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
      <label>What’s inside</label>
      {parts.map((p, k) => <div key={k} className="row"><select value={p.item} onChange={e => setParts(ps => ps.map((x, j) => j === k ? { ...x, item: e.target.value } : x))}><option value="">Choose an item…</option>{plain.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <input type="number" min="1" max="10" style={{ width: 70 }} value={p.qty} onChange={e => setParts(ps => ps.map((x, j) => j === k ? { ...x, qty: e.target.value } : x))} aria-label="Quantity" />
        {parts.length > 1 && <button type="button" className="link danger" onClick={() => setParts(ps => ps.filter((_, j) => j !== k))}>Remove</button>}</div>)}
      <div className="row"><button type="button" className="ghost" onClick={() => setParts(ps => [...ps, { item: '', qty: 1 }])}>+ Another item</button><button>Create combo</button></div>
      <p className="muted">Change the photo, price or availability of a combo in the Menu tab. A combo is shown as sold out when any item inside it is sold out.</p></form>
    {combos.map(c => { const mine = d.combo.filter(x => x.combo_id === c.id); return <div key={c.id} className="panel"><b>{c.name}</b> <span className="muted">{inr(c.price_paise)}</span>
      {mine.map(m => <div key={m.item_id} className="row"><span style={{ flex: 1 }}>{m.qty} × {name(m.item_id)}</span><button className="link danger" onClick={() => run(supabase.from('combo_items').delete().eq('combo_id', c.id).eq('item_id', m.item_id))}>Remove</button></div>)}
      <div className="row"><select value={add[c.id] || ''} onChange={e => setAdd({ ...add, [c.id]: e.target.value })}><option value="">Add an item…</option>{plain.filter(i => !mine.some(m => m.item_id === i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <button className="ghost" disabled={!add[c.id]} onClick={() => run(supabase.from('combo_items').insert({ cafe_id: cafe.id, combo_id: c.id, item_id: add[c.id], qty: 1 })).then(ok => ok && setAdd({ ...add, [c.id]: '' }))}>Add</button></div></div> })}
  </>)
}

function AddonGroups({ cafe, d, run }) {
  const [g, setG] = useState({ name: '', required: false, max: 1 }), [a, setA] = useState({})
  const create = async e => { e.preventDefault(); if (!g.name.trim()) return; if (await run(supabase.from('addon_groups').insert({ cafe_id: cafe.id, name: g.name.trim(), min_select: g.required ? 1 : 0, max_select: Math.max(1, Math.min(8, Number(g.max) || 1)) }))) setG({ name: '', required: false, max: 1 }) }
  const addOne = async gr => { const x = a[gr.id] || {}; if (!(x.name || '').trim()) return; if (await run(supabase.from('addons').insert({ group_id: gr.id, cafe_id: cafe.id, name: x.name.trim(), price_minor: Math.round(Number(x.price || 0) * 100) }))) setA({ ...a, [gr.id]: { name: '', price: '' } }) }
  const linked = (gid, iid) => d.links.some(l => l.group_id === gid && l.item_id === iid)
  const toggle = (gid, iid) => run(linked(gid, iid) ? supabase.from('item_addon_groups').delete().eq('group_id', gid).eq('item_id', iid) : supabase.from('item_addon_groups').insert({ cafe_id: cafe.id, group_id: gid, item_id: iid }))
  return (<>
    <form className="panel" onSubmit={create}><h2>Add-ons</h2><p className="muted">Extras guests can pick on a dish, like “Extra shot +₹30” or “Size”. Create a group, add the choices, then tick the dishes it applies to.</p>
      <label>Group name</label><input maxLength={40} value={g.name} onChange={e => setG({ ...g, name: e.target.value })} placeholder="Size, Extras, Milk" />
      <div className="row"><label className="chk"><input type="checkbox" checked={g.required} onChange={e => setG({ ...g, required: e.target.checked })} /> Guest must choose</label><div><label>Most they can choose</label><input type="number" min="1" max="8" value={g.max} onChange={e => setG({ ...g, max: e.target.value })} /></div></div>
      <button>Create group</button></form>
    {d.groups.map(gr => <div key={gr.id} className="panel"><div className="row"><b style={{ flex: 1 }}>{gr.name}</b><span className="muted">{gr.min_select ? 'Required' : 'Optional'} · up to {gr.max_select}</span><button className="link danger" onClick={() => confirm('Delete this group and its choices?') && run(supabase.from('addon_groups').delete().eq('id', gr.id))}>Delete</button></div>
      {[...(gr.addons || [])].sort((x, y) => x.sort_order - y.sort_order).map(o => <div key={o.id} className="row"><span style={{ flex: 1 }}>{o.name} <span className="muted">{o.price_minor ? '+' + inr(o.price_minor) : 'Free'}</span></span>
        <label className="chk"><input type="checkbox" checked={o.is_available} onChange={e => run(supabase.from('addons').update({ is_available: e.target.checked }).eq('id', o.id))} /> Available</label><button className="link danger" onClick={() => run(supabase.from('addons').delete().eq('id', o.id))}>Remove</button></div>)}
      <div className="row"><input placeholder="Choice, e.g. Extra shot" maxLength={40} value={a[gr.id]?.name || ''} onChange={e => setA({ ...a, [gr.id]: { ...a[gr.id], name: e.target.value } })} /><input type="number" min="0" step="1" style={{ width: 90 }} placeholder="₹" value={a[gr.id]?.price || ''} onChange={e => setA({ ...a, [gr.id]: { ...a[gr.id], price: e.target.value } })} aria-label="Extra price in rupees" /><button className="ghost" type="button" onClick={() => addOne(gr)}>Add choice</button></div>
      <details><summary>Applies to ({d.links.filter(l => l.group_id === gr.id).length} dishes)</summary><div className="pickbox">{d.items.map(i => <label key={i.id} className="chk"><input type="checkbox" checked={linked(gr.id, i.id)} onChange={() => toggle(gr.id, i.id)} /> {i.name}{i.is_combo ? ' (combo)' : ''}</label>)}</div></details></div>)}
  </>)
}
