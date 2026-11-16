import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { rpc, MSG } from '../../lib/pos'

// The quick daily screen: mark dishes or add-on choices sold out and back. Open to the owner and every staff member.
// It changes availability only; prices, names and photos can only be edited by the owner in the Menu tab.
export default function Availability({ cafe }) {
  const [cats, setCats] = useState(null), [groups, setGroups] = useState([]), [q, setQ] = useState(''), [outOnly, setOutOnly] = useState(false), [msg, setMsg] = useState(''), [open, setOpen] = useState({})
  const load = async () => {
    const [c, g] = await Promise.all([supabase.from('menu_categories').select('id,name,sort_order,menu_items(id,name,is_available,sort_order)').eq('cafe_id', cafe.id).order('sort_order'),
      supabase.from('addon_groups').select('id,name,sort_order,addons(id,name,is_available,sort_order)').eq('cafe_id', cafe.id).order('sort_order')])
    setCats((c.data || []).map(x => ({ ...x, items: [...x.menu_items].sort((a, b) => a.sort_order - b.sort_order) }))); setGroups(g.data || [])
  }
  useEffect(() => { load() }, [cafe.id])
  const flip = async (kind, id, available) => {
    setMsg('')
    const patch = list => list.map(x => x.id === id ? { ...x, is_available: available } : x)   // show the change at once, then confirm with the server
    setCats(cs => cs.map(c => ({ ...c, items: patch(c.items) }))); setGroups(gs => gs.map(g => ({ ...g, addons: patch(g.addons) })))
    const r = await rpc('menu_set_availability', { p_cafe: cafe.id, p_kind: kind, p_id: id, p_available: available })
    if (!r.ok) { setMsg(MSG[r.reason] || 'Could not save that change. Please try again.'); load() }
  }
  const ql = q.trim().toLowerCase(), match = x => (!ql || x.name.toLowerCase().includes(ql)) && (!outOnly || !x.is_available)
  if (!cats) return <p className="muted" role="status">Loading…</p>
  const row = (kind, x) => <div key={x.id} className="avrow"><span>{x.name}</span>
    <button className={'avbtn' + (x.is_available ? '' : ' out')} aria-pressed={!x.is_available} onClick={() => flip(kind, x.id, !x.is_available)}>{x.is_available ? 'Available' : 'Sold out'}</button></div>
  const out = cats.reduce((n, c) => n + c.items.filter(i => !i.is_available).length, 0) + groups.reduce((n, g) => n + g.addons.filter(a => !a.is_available).length, 0)
  return (<>
    <div className="stickyfind"><input className="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a dish…" aria-label="Find a dish" />
      <div className="row"><button className={outOnly ? '' : 'ghost'} onClick={() => setOutOnly(!outOnly)} aria-pressed={outOnly}>Sold out only ({out})</button></div></div>
    {msg && <p className="err" role="alert">{msg}</p>}
    {cats.map(c => { const items = c.items.filter(match); if (!items.length) return null; const isOpen = ql || outOnly || open[c.id]
      return <div key={c.id} className="panel"><button className="acc" aria-expanded={!!isOpen} onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}><b>{c.name}</b><span className="muted">{c.items.filter(i => !i.is_available).length ? c.items.filter(i => !i.is_available).length + ' sold out · ' : ''}{c.items.length} items {isOpen ? '▾' : '▸'}</span></button>{isOpen && items.map(i => row('item', i))}</div> })}
    {groups.some(g => g.addons.some(match)) && <div className="panel"><b>Add-ons and versions</b><p className="muted">Mark an extra or a version (for example “Full plate”) sold out.</p>
      {groups.map(g => { const l = g.addons.filter(match); return l.length ? <div key={g.id}><small className="muted">{g.name}</small>{l.map(a => row('addon', a))}</div> : null })}</div>}
  </>)
}
