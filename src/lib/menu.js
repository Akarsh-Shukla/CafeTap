import { supabase } from './supabase'

// Add-on groups, dish versions (Half/Full, Veg/Non-veg), combo contents and live offers for a café. Every call fails softly, so a menu never breaks because of an extra.
export async function loadExtras(cafeId, byId) {
  const groupsQ = cols => supabase.from('addon_groups').select(cols).eq('cafe_id', cafeId).order('sort_order')
  const [g0, l, c, k] = await Promise.all([groupsQ('id,name,kind,min_select,max_select,sort_order,addons(id,name,price_minor,is_available,sort_order,diet)'),
    supabase.from('item_addon_groups').select('item_id,group_id').eq('cafe_id', cafeId), supabase.from('combo_items').select('combo_id,item_id,qty').eq('cafe_id', cafeId),
    supabase.from('menu_items').select('id').eq('cafe_id', cafeId).eq('is_combo', true)])
  const g = g0.error ? await groupsQ('id,name,min_select,max_select,sort_order,addons(id,name,price_minor,is_available,sort_order)') : g0
  const gm = Object.fromEntries((g.data || []).map(x => [x.id, { ...x, kind: x.kind || 'addon', addons: [...(x.addons || [])].sort((a, b) => a.sort_order - b.sort_order) }]))
  const groups = {}, addonById = {}, combo = {}, isCombo = {}, from = {}, diets = {}
  Object.values(gm).forEach(x => x.addons.forEach(a => { addonById[a.id] = { ...a, variant: x.kind === 'variant' } }))
  ;(l.data || []).forEach(r => { const x = gm[r.group_id]; if (!x) return; (groups[r.item_id] ||= []).push(x)
    if (x.kind === 'variant') { const live = x.addons.filter(a => a.is_available); if (live.length) from[r.item_id] = Math.min(...live.map(a => a.price_minor)); const ds = [...new Set(x.addons.map(a => a.diet).filter(Boolean))]; if (ds.length) diets[r.item_id] = ds } })
  ;(c.data || []).forEach(r => { const n = byId?.[r.item_id]?.name; if (n) (combo[r.combo_id] ||= []).push(r.qty > 1 ? `${r.qty}× ${n}` : n) })
  ;(k.data || []).forEach(r => { isCombo[r.id] = true })
  return { groups, addonById, combo, isCombo, from, diets }
}

export async function loadOffers(cafeId) {
  const r = await supabase.rpc('public_offers', { p_cafe: cafeId })
  if (!r.error && Array.isArray(r.data)) return r.data
  const today = new Date().toISOString().slice(0, 10)   // before the database update is applied: plain announcements only
  const d = await supabase.from('offers').select('id,title,details,valid_until').eq('cafe_id', cafeId).eq('is_active', true).order('created_at', { ascending: false })
  return (d.data || []).filter(o => !o.valid_until || o.valid_until >= today).map(o => ({ ...o, kind: 'info', rule: null }))
}
