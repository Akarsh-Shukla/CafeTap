// The guest's private bill link, kept on their own device for 7 days so the running bill survives closing the browser.
const key = id => 'ct_receipt_' + id
export const getReceipt = id => { try { const v = JSON.parse(localStorage.getItem(key(id))); return v && v.t && Date.now() - v.at < 7 * 864e5 ? v.t : null } catch { return null } }
export const setReceipt = (id, t) => { try { localStorage.setItem(key(id), JSON.stringify({ t, at: Date.now() })) } catch {} }
export const clearReceipt = id => { try { localStorage.removeItem(key(id)) } catch {} }
