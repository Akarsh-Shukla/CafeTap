import { supabase } from './supabase'

// Add-on groups, combo contents and live offers for a café. Every call fails softly, so a menu never breaks because of an extra.
export async function loadExtras(cafeId, byId) {
  const [g, l, c, k] = await Promise.all([
    supabase.from('addon_groups').select('id,name,min_select,max_select,sort_order,addons(id,name,price_minor,is_available,sort_order)').eq('cafe_id', cafeId).order('sort_order'),
    supabase.from('item_addon_groups').select('item_id,group_id').eq('cafe_id', cafeId),
    supabase.from('combo_items').select('combo_id,item_id,qty').eq('cafe_id', cafeId),
    supabase.from('menu_items').select('id').eq('cafe_id', cafeId).eq('is_combo', true)])
  const gm = Object.fromEntries((g.data || []).map(x => [x.id, { ...x, addons: [...(x.addons || [])].sort((a, b) => a.sort_order - b.sort_order) }]))
  const groups = {}, addonById = {}, combo = {}, isCombo = {}
  Object.values(gm).forEach(x => x.addons.forEach(a => { addonById[a.id] = a }))
  ;(l.data || []).forEach(r => { if (gm[r.group_id]) (groups[r.item_id] ||= []).push(gm[r.group_id]) })
  ;(c.data || []).forEach(r => { const n = byId?.[r.item_id]?.name; if (n) (combo[r.combo_id] ||= []).push(r.qty > 1 ? `${r.qty}× ${n}` : n) })
  ;(k.data || []).forEach(r => { isCombo[r.id] = true })
  return { groups, addonById, combo, isCombo }
}

export async function loadOffers(cafeId) {
  const r = await supabase.rpc('public_offers', { p_cafe: cafeId })
  if (!r.error && Array.isArray(r.data)) return r.data
  const today = new Date().toISOString().slice(0, 10)   // before the database update is applied: plain announcements only
  const d = await supabase.from('offers').select('id,title,details,valid_until').eq('cafe_id', cafeId).eq('is_active', true).order('created_at', { ascending: false })
  return (d.data || []).filter(o => !o.valid_until || o.valid_until >= today).map(o => ({ ...o, kind: 'info', rule: null }))
}
