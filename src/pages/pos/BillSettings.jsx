import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { rpc, MSG } from '../../lib/pos'
import BillDoc from '../../components/BillDoc'

const sample = (c, f) => {   // a made-up bill so the owner can see exactly how their settings look
  const total = 25000, rates = f.confirmed ? f.lines.filter(l => l.name.trim() && Number(l.rate) > 0) : [], sum = rates.reduce((s, l) => s + Number(l.rate), 0)
  const tax = rates.map(l => ({ name: l.name.trim(), rate: Number(l.rate), amount_minor: Math.round(total * Number(l.rate) / (100 + sum)) })), taxed = tax.reduce((s, t) => s + t.amount_minor, 0)
  return { ok: true, cafe: { name: f.display.trim() || c.name, address: f.address || null, phone: f.phone || null, footer: f.footer || null, theme: c.theme, design: c.settings?.design || {} }, label: 'B-00001', date: new Date().toISOString(), table: 'Table 4',
    lines: [{ name: 'Cappuccino', qty: 2, unit_minor: 9000, total_minor: 18000, addons: [], combo: null }, { name: 'Brownie', qty: 1, unit_minor: 7000, total_minor: 7000, addons: [], combo: null }],
    subtotal_minor: total, bill_subtotal_minor: total, discount_minor: 0, offer: null, total_minor: total, tax, taxable_minor: total - taxed, payment: { state: 'paid', methods: [{ method: 'upi' }] }, shared: false }
}

// What appears on the bills guests and staff see. Prices already include tax, so tax lines only show how much tax a bill contains. Nothing is ever added on top.
export default function BillSettings({ cafe }) {
  const [f, setF] = useState({ display: '', address: '', phone: '', footer: '', confirmed: false, lines: [] }), [msg, setMsg] = useState(''), [ok, setOk] = useState(false), [featureOn, setFeatureOn] = useState(false)
  useEffect(() => { supabase.from('cafe_bill_settings').select('*').eq('cafe_id', cafe.id).maybeSingle().then(({ data }) => data && (setFeatureOn(!!data.tax_feature_enabled), setF({ display: data.display_name || '', address: data.address || '', phone: data.phone || '', footer: data.footer || '', confirmed: data.tax_confirmed, lines: (data.tax_lines || []).map(l => ({ name: l.name, rate: String(l.rate) })) }))) }, [cafe.id])
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setOk(false) }
  const save = async e => {
    e.preventDefault(); setMsg(''); setOk(false)
    const r = await rpc('bill_settings_save', { p_cafe: cafe.id, p_display: f.display, p_address: f.address, p_phone: f.phone, p_footer: f.footer, p_confirmed: featureOn && f.confirmed, p_lines: !featureOn ? [] : f.lines.filter(l => l.name.trim()).map(l => ({ name: l.name.trim(), rate: String(l.rate) })) })
    if (r.ok) setOk(true); else setMsg(r.reason === 'invalid' ? 'Check the tax names (letters and numbers) and rates (0 to 28, total up to 28).' : MSG[r.reason] || MSG.error)
  }
  return (<>
    <form className="panel" onSubmit={save}><h2>Bill details</h2>
      <label>Name on the bill (optional, defaults to your café name)</label><input maxLength={80} value={f.display} onChange={e => set('display', e.target.value)} />
      <label>Address (optional)</label><input maxLength={160} value={f.address} onChange={e => set('address', e.target.value)} />
      <label>Phone (optional)</label><input maxLength={20} value={f.phone} onChange={e => set('phone', e.target.value)} />
      <label>Message at the bottom (optional)</label><input maxLength={140} value={f.footer} onChange={e => set('footer', e.target.value)} placeholder="Follow us on Instagram @yourcafe" />
      {featureOn ? <>
      <h3>Tax shown on the bill (only if it applies to you)</h3>
      <p className="muted">Menu prices are final prices and already include tax. If your café is registered for a tax such as GST, add its lines here and each bill will show how much tax the total includes. We never add tax on top, and we don’t create GST tax invoices. Ask your accountant for the right rates, and don’t add service charge as a compulsory extra.</p>
      <label className="chk"><input type="checkbox" checked={f.confirmed} onChange={e => set('confirmed', e.target.checked)} /> My café is registered and allowed to charge the tax I enter below.</label>
      {f.lines.map((l, k) => <div key={k} className="row"><input placeholder="Name, e.g. CGST" maxLength={20} value={l.name} onChange={e => set('lines', f.lines.map((x, j) => j === k ? { ...x, name: e.target.value } : x))} /><input type="number" min="0" max="28" step="0.01" style={{ width: 90 }} placeholder="%" value={l.rate} onChange={e => set('lines', f.lines.map((x, j) => j === k ? { ...x, rate: e.target.value } : x))} aria-label="Rate in percent" /><button type="button" className="link danger" onClick={() => set('lines', f.lines.filter((_, j) => j !== k))}>Remove</button></div>)}
      {f.lines.length < 3 && <button type="button" className="ghost" onClick={() => set('lines', [...f.lines, { name: '', rate: '' }])}>+ Add a tax line</button>}
      </> : <p className="muted">Tax lines on bills are switched off for your café, so no tax is shown on bills. If your café is registered for GST and you want it shown, ask CafeTap to switch it on.</p>}
      <button>Save bill settings</button>{ok && <p role="status">Saved. New bills use these details. Bills already paid keep the tax lines they were issued with.</p>}{msg && <p className="err" role="alert">{msg}</p>}</form>
    <h3>Preview</h3><BillDoc bill={sample(cafe, { ...f, confirmed: featureOn && f.confirmed })} />
  </>)
}
