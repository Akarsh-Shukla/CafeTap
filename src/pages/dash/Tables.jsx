import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { okImg } from '../../lib/util'
import { QrPoster, POSTER_STYLES, SHAPES, badgeImage, contrast, hexOk, fetchDataUrl, useQrImage, downloadPng, downloadSvg } from '../../components/QrPoster'

const DEFAULT = { style: 'noir', shape: 'rounded', center: 'logo', color: '', brand: true, tagline: '', text: '' }
const initials = n => (n || 'C').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('')

// One poster: builds its own QR so a slow one never blocks the others.
function Card({ item, q, cafe, logo, tagline, arch }) {
  const color = hexOk(q.color) ? q.color : POSTER_STYLES[q.style].qr
  const image = q.center === 'none' ? null : q.center === 'logo' && logo ? logo : badgeImage(q.text || initials(cafe.name), color)
  const qr = useQrImage({ value: item.url, color, shape: q.shape, cornerDot: 'dot', image })
  const file = `${cafe.slug}-${item.label}`.replace(/\s+/g, '-')
  return (<div className={'qrp panel' + (item.on ? '' : ' off')}>
    <QrPoster id={item.id} qr={qr} name={cafe.name} label={item.label} style={q.style} tagline={tagline} brand={q.brand} /><small className="muted noprint">{item.url}</small>
    <div className="row noprint"><button className="ghost" disabled={!qr} onClick={() => downloadPng(document.getElementById(item.id), file)}>PNG</button><button className="ghost" disabled={!qr} onClick={() => downloadSvg(document.getElementById(item.id), file)}>SVG</button>
      {item.row && <button className="link" onClick={() => arch(item.row)}>{item.on ? 'Archive' : 'Restore'}</button>}</div></div>)
}

// Admin: designs the QR posters (style, colours, centre logo or name) and prints one for the café and one for each table.
export default function Tables({ cafe, reload }) {
  const [rows, setRows] = useState([]), [name, setName] = useState(''), [q, setQ] = useState({ ...DEFAULT, ...(cafe.settings?.qr || {}) }), [msg, setMsg] = useState(''), [logo, setLogo] = useState(null)
  const base = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, ''), local = /localhost|127\.0\.0\.1|192\.168\./.test(base)
  const load = async () => { const { data } = await supabase.from('cafe_tables').select('*').eq('cafe_id', cafe.id).order('created_at'); setRows(data || []) }
  useEffect(() => { load() }, [cafe.id])
  useEffect(() => { const u = okImg(cafe.logo_url); if (u) fetchDataUrl(u).then(setLogo); else setLogo(null) }, [cafe.logo_url])
  const set = (k, v) => { setQ(x => ({ ...x, [k]: v })); setMsg('') }
  const add = async e => { e.preventDefault(); if (!name.trim()) return; await supabase.from('cafe_tables').insert({ cafe_id: cafe.id, display_name: name.trim() }); setName(''); load() }
  const arch = async r => { await supabase.from('cafe_tables').update({ is_active: !r.is_active }).eq('id', r.id); load() }
  const saveDesign = async () => { const { error } = await supabase.from('cafes').update({ settings: { ...(cafe.settings || {}), qr: q } }).eq('id', cafe.id); setMsg(error ? 'Could not save the design.' : 'Design saved for this café.'); if (!error && reload) reload() }
  const printAll = () => { document.body.classList.add('printing-qr'); window.print(); setTimeout(() => document.body.classList.remove('printing-qr'), 900) }
  const tagline = q.tagline || (cafe.plan_tier === 'pos' ? 'Scan · Order · Enjoy' : 'Scan to view the menu')
  const useCol = hexOk(q.color) ? q.color : POSTER_STYLES[q.style].qr, low = contrast(useCol) < 4
  const items = [{ id: 'main', label: 'Menu', url: `${base}/${cafe.slug}`, on: true }, ...rows.map(r => ({ id: 'q' + r.id, label: r.display_name, url: `${base}/${cafe.slug}/t/${r.token}`, on: r.is_active, row: r }))]
  const card = i => <Card key={i.id} item={i} q={q} cafe={cafe} logo={logo} tagline={tagline} arch={arch} />
  return (<>
    {local && <p className="err">These links point to your own computer. Open this page on your live website before downloading or printing any QR code.</p>}
    <div className="panel noprint"><h2>QR design</h2>
      <label>Poster style</label><div className="row">{Object.entries(POSTER_STYLES).map(([k, s]) => <button key={k} className={q.style === k ? '' : 'ghost'} onClick={() => set('style', k)} aria-pressed={q.style === k}>{s.label}</button>)}</div>
      <div className="row"><div><label>Dots</label><select value={q.shape} onChange={e => set('shape', e.target.value)}>{SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label>Centre</label><select value={q.center} onChange={e => set('center', e.target.value)}><option value="logo">Café logo</option><option value="name">Short name</option><option value="none">Nothing</option></select></div></div>
      {q.center === 'name' && <><label>Letters in the centre (up to 3)</label><input maxLength={3} value={q.text} onChange={e => set('text', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} placeholder={initials(cafe.name).toUpperCase()} /></>}
      {q.center === 'logo' && !logo && <p className="muted">No café logo uploaded yet, so the short name is used. Upload a logo in My page.</p>}
      <div className="row"><div><label>QR colour</label><input type="color" value={useCol} onChange={e => set('color', e.target.value)} /></div><button className="link" onClick={() => set('color', '')}>Use the style’s colour</button></div>
      {low && <p className="err" role="alert">This colour is too light and may not scan well. Pick a darker one.</p>}
      <label>Line under the QR</label><input maxLength={34} value={q.tagline} onChange={e => set('tagline', e.target.value)} placeholder={tagline} />
      <label className="chk"><input type="checkbox" checked={q.brand} onChange={e => set('brand', e.target.checked)} /> Show “Powered by CafeTap”</label>
      <div className="row"><button onClick={saveDesign}>Save design</button>{msg && <span role="status">{msg}</span>}</div>
      <p className="muted">The codes use the strongest error correction, a small logo and square corner frames so every phone can read them. Always test a printed code with two different phones before you hand it over.</p></div>
    <div className="qrposters"><div className="qrgrid">{card(items[0])}</div></div>
    <div className="panel noprint"><b>Put it on an NFC tag</b><p className="muted">Open a free app such as NFC Tools, choose Write, add a URL record with the café link, and tap a blank tag. Write the same link on every tag, and keep the printed QR as a backup.</p></div>
    <details className="panel"><summary>Optional: a separate poster for each table</summary>
      <p className="muted noprint">Each table poster opens the same page and shows the table’s name. Table posters are needed for table ordering.</p>
      <form className="noprint" onSubmit={add}><div className="row"><input value={name} onChange={e => setName(e.target.value)} placeholder="Table 4 or Patio 1" /><button>Add table</button></div></form>
      <div className="qrposters"><div className="qrgrid">{items.slice(1).map(card)}</div></div></details>
    <button className="ghost noprint" onClick={printAll}>Print all posters</button>
  </>)
}
