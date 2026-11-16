import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { upload } from '../../lib/util'

// Owner's menu editor. Sections fold away, a search box finds any dish, and each dish shows only name, price and availability until you open "More".
export default function MenuEditor({ cafe, uid }) {
  const [cats, setCats] = useState([]), [msg, setMsg] = useState(''), [q, setQ] = useState(''), [open, setOpen] = useState({}), [more, setMore] = useState({})
  const load = async () => {
    const { data } = await supabase.from('menu_categories').select('*,menu_items(*)').eq('cafe_id', cafe.id).order('sort_order')
    setCats((data || []).map(c => ({ ...c, menu_items: [...c.menu_items].sort((a, b) => a.sort_order - b.sort_order) })))
  }
  useEffect(() => { load() }, [cafe.id])
  const run = async p => { const { error } = await p; setMsg(error ? (/foreign key|violates/i.test(error.message) ? 'That dish is part of a combo. Remove it from the combo first.' : error.message) : ''); load() }
  const addCat = async () => { const { data } = await supabase.from('menu_categories').insert({ cafe_id: cafe.id, name: 'New category', sort_order: cats.length }).select('id').single(); if (data) setOpen(o => ({ ...o, [data.id]: true })); load() }
  const upCat = (id, f) => run(supabase.from('menu_categories').update(f).eq('id', id))
  const delCat = id => confirm('Delete this category and all items in it?') && run(supabase.from('menu_categories').delete().eq('id', id))
  const addItem = c => run(supabase.from('menu_items').insert({ cafe_id: cafe.id, category_id: c.id, name: 'New item', price_paise: 0, sort_order: c.menu_items.length }))
  const upItem = (id, f) => run(supabase.from('menu_items').update(f).eq('id', id))
  const delItem = id => confirm('Remove this item?') && run(supabase.from('menu_items').delete().eq('id', id))
  const photo = async (id, file) => { if (!file) return; try { upItem(id, { image_url: await upload(file, uid) }) } catch (e) { setMsg(e.message) } }
  const ql = q.trim().toLowerCase(), searching = !!ql
  const jump = id => { setOpen(o => ({ ...o, [id]: true })); setTimeout(() => document.getElementById('cat-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) }
  const item = i => <div key={i.id} className="sub">
    <input defaultValue={i.name} placeholder="Item name" aria-label="Item name" onBlur={e => e.target.value !== i.name && upItem(i.id, { name: e.target.value })} />
    <div className="row"><label className="rs">₹<input type="number" min="0" step="1" defaultValue={i.price_paise / 100} aria-label="Price in rupees" onBlur={e => { const p = Math.round(parseFloat(e.target.value || 0) * 100); if (p >= 0 && p !== i.price_paise) upItem(i.id, { price_paise: p }) }} /></label>
      <button className={'avbtn' + (i.is_available ? '' : ' out')} aria-pressed={!i.is_available} onClick={() => upItem(i.id, { is_available: !i.is_available })}>{i.is_available ? 'Available' : 'Sold out'}</button>
      <button className="link" onClick={() => setMore({ ...more, [i.id]: !more[i.id] })} aria-expanded={!!more[i.id]}>{more[i.id] ? 'Less' : 'More'}</button></div>
    {more[i.id] && <>
      <input defaultValue={i.description || ''} placeholder="Short description" aria-label="Description" onBlur={e => e.target.value !== (i.description || '') && upItem(i.id, { description: e.target.value })} />
      <div className="row"><select value={i.diet || ''} onChange={e => upItem(i.id, { diet: e.target.value || null })} aria-label="Veg or non-veg"><option value="">Veg / non-veg: not set</option><option value="veg">Veg</option><option value="nonveg">Non-veg</option><option value="egg">Contains egg</option></select>
        <select value={i.badge || ''} onChange={e => upItem(i.id, { badge: e.target.value || null })} aria-label="Badge"><option value="">No badge</option><option value="bestseller">Bestseller</option><option value="chefs">Chef’s pick</option><option value="new">New</option><option value="popular">Popular</option></select></div>
      <p className="muted">Dish comes in Half and Full, or Veg and Non-veg? Set that up in the “Combos &amp; add-ons” tab under Versions.</p>
      <div className="row">{i.image_url && <img className="thumb" src={i.image_url} alt="" />}
        <label className="filebtn">{i.image_url ? 'Change photo' : 'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => photo(i.id, e.target.files[0])} /></label>
        {i.image_url && <button className="link" onClick={() => upItem(i.id, { image_url: null })}>Remove photo</button>}<button className="link danger" onClick={() => delItem(i.id)}>Delete item</button></div></>}
  </div>
  return (<>
    <div className="stickyfind"><input className="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a dish to edit…" aria-label="Find a dish to edit" />
      {!searching && cats.length > 1 && <div className="jumps" role="navigation" aria-label="Jump to a section">{cats.map(c => <button key={c.id} onClick={() => jump(c.id)}>{c.name}</button>)}</div>}</div>
    <p className="muted">Edit a field and tap outside it to save. Tap a section to open it. To mark things sold out quickly, use the “Sold out” tab.</p>
    {msg && <p className="err" role="alert">{msg}</p>}
    {cats.map(c => { const items = searching ? c.menu_items.filter(i => (i.name + ' ' + (i.description || '')).toLowerCase().includes(ql)) : c.menu_items; if (searching && !items.length) return null; const isOpen = searching || open[c.id]
      return <div key={c.id} id={'cat-' + c.id} className="panel">
        <button className="acc" aria-expanded={!!isOpen} onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}><b>{c.name}</b><span className="muted">{c.menu_items.length} items {!c.is_visible ? '· hidden ' : ''}{isOpen ? '▾' : '▸'}</span></button>
        {isOpen && <>
          {!searching && <div className="row"><input defaultValue={c.name} onBlur={e => e.target.value !== c.name && upCat(c.id, { name: e.target.value })} aria-label="Category name" />
            <label className="chk"><input type="checkbox" checked={c.is_visible} onChange={e => upCat(c.id, { is_visible: e.target.checked })} /> Visible</label><button className="link danger" onClick={() => delCat(c.id)}>Delete</button></div>}
          {items.map(item)}{!searching && <button className="ghost" onClick={() => addItem(c)}>+ Add item</button>}</>}
      </div> })}
    {!searching && <button onClick={addCat}>+ Add category</button>}
  </>)
}
