import { rupees } from '../lib/pos'
import { designVars } from '../lib/util'

const when = s => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const free = o => (o?.free_items || []).map(f => (f.qty > 1 ? f.qty + '× ' : '') + f.name).join(', ')

// One bill layout for guests and staff. All numbers come from the database; this component only displays them.
export default function BillDoc({ bill }) {
  const c = bill.cafe, pay = bill.payment, paid = pay.state === 'paid', off = bill.offer && bill.discount_minor > 0 ? bill.offer : null
  return (<div className="billwrap" data-theme={c.theme} style={designVars(c.design)}><article className="bill">
    <header className="bill-h"><h1>{c.name}</h1>{c.address && <p>{c.address}</p>}{c.phone && <p>{c.phone}</p>}</header>
    <div className="bill-meta"><span><small>Bill no.</small><b>{bill.label || 'Issued when paid'}</b></span><span><small>Date</small><b>{when(bill.date)}</b></span><span><small>Table</small><b>{bill.table}</b></span></div>
    {bill.shared && <p className="bill-note">These are your own items. Other guests at your table have ordered too, so the table totals are shown below.</p>}
    <table className="bill-t"><thead><tr><th scope="col">Qty</th><th scope="col">Item</th><th scope="col">Price</th><th scope="col">Total</th></tr></thead>
      <tbody>{bill.lines.map((l, k) => <tr key={k}><td>{l.qty}</td><td>{l.name}{l.combo?.length > 0 && <small>Includes {l.combo.map(x => (x.qty > 1 ? x.qty + '× ' : '') + x.name).join(', ')}</small>}{l.addons?.length > 0 && <small>+ {l.addons.map(a => a.name).join(', ')}</small>}</td><td>{rupees(l.unit_minor)}</td><td>{rupees(l.total_minor)}</td></tr>)}
        {!bill.lines.length && <tr><td colSpan="4" className="mut">No confirmed items yet.</td></tr>}</tbody></table>
    <dl className="bill-sum">
      <div><dt>{bill.shared ? 'Your items' : 'Subtotal'}</dt><dd>{rupees(bill.subtotal_minor)}</dd></div>
      {bill.shared && <div><dt>Table subtotal</dt><dd>{rupees(bill.bill_subtotal_minor)}</dd></div>}
      {off && <div className="bill-off"><dt>Offer applied: {off.title}<small>{off.rule}{free(off) ? ' · Free: ' + free(off) : ''}</small></dt><dd>−{rupees(bill.discount_minor)}</dd></div>}
      <div className="bill-tot"><dt>{bill.shared ? 'Table total' : 'Total'}</dt><dd>{rupees(bill.total_minor)}</dd></div>
      {bill.tax?.length > 0 && <><div className="bill-tax"><dt>Taxable value</dt><dd>{rupees(bill.taxable_minor)}</dd></div>{bill.tax.map(t => <div key={t.name} className="bill-tax"><dt>{t.name} {t.rate}% (included)</dt><dd>{rupees(t.amount_minor)}</dd></div>)}</>}
    </dl>
    <p className={'bill-pay' + (paid ? ' paid' : '')} role="status">{paid ? '✓ PAID' + (pay.methods?.length ? ' · ' + pay.methods.map(m => m.method.toUpperCase()).join(' + ') : '') : pay.state === 'partial' ? 'Partly paid · balance at the counter' : pay.state === 'none' ? 'Nothing to pay yet' : 'Payment pending · pay at the counter'}</p>
    {c.footer && <p className="bill-foot">{c.footer}</p>}
    <p className="bill-fine">Thank you for visiting {c.name}. Prices are inclusive of applicable taxes. This is a receipt of your order and is not a GST tax invoice.</p>
  </article></div>)
}
