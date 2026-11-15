import { useEffect } from 'react'
import { Link } from 'react-router-dom'
const NAME = import.meta.env.VITE_LEGAL_NAME || 'CafeTap'
const MAIL = import.meta.env.VITE_CONTACT_EMAIL || ''
const H = { fontSize: 24, margin: '30px 0 8px' }

// Plain-language privacy notice. Have a lawyer review it before you rely on it.
export default function Privacy() {
  useEffect(() => { document.title = 'Privacy | CafeTap' }, [])
  return (<main className="lp"><div className="lpw" style={{ maxWidth: 720, padding: '40px 20px 70px' }}>
    <Link className="logo2" to="/">CafeTap</Link>
    <h1 style={{ fontSize: 40, margin: '24px 0 8px' }}>Privacy</h1>
    <p className="lead2">Last updated 4 November 2026. {NAME} (“CafeTap”) runs the menu pages and ordering tools that cafés use. For a guest, the café is the one who decides why your order information is used, and CafeTap handles it for the café. We collect as little as we can.</p>

    <h2 style={H}>If you are a guest</h2>
    <ul><li><b>Browsing a café page:</b> we count visits (a number per day, with no name, phone number or device identity). Anonymous feedback is stored without your name.</li>
      <li><b>Ordering from your table:</b> we store your items, notes, the table, the time and the bill. We never ask for your name, phone or email.</li>
      <li><b>Location:</b> if you order, your phone shares its position once so we can check you are inside the café. We do not store the position, only whether the check passed.</li>
      <li><b>Your bill link:</b> a private link kept in your browser so you can see your bill and payment status. It works for 7 days. Anyone who has the link can see your own items, so share it carefully.</li>
      <li><b>On your device:</b> favourites and your table session are kept in your browser. Clear your browser data to remove them.</li>
      <li><b>Payment:</b> you pay the café directly. CafeTap does not take card or UPI details, and the café’s staff record what you paid.</li></ul>

    <h2 style={H}>If you are a café owner or staff member</h2>
    <p>We store your email address and login, what your café enters (menu, offers, prices, bill details, register entries) and a log of important actions such as payments and logins to your café, so mistakes can be traced. If you turn on phone notifications, your browser gives us a notification address for that device, which we use only to tell you about new orders.</p>

    <h2 style={H}>Who else handles data</h2>
    <p>Supabase (database and logins), Cloudflare (website hosting and delivery) and Google Fonts (fonts). Your information is not sold and is not used for advertising.</p>

    <h2 style={H}>How long we keep it</h2>
    <ul><li>Orders, bills, payments, feedback and activity logs: 12 months, then deleted automatically. Cafés should keep their own copy of anything they need for their books; owners can download bills as a CSV.</li>
      <li>Daily visit counts: about 13 months. Bill links: 7 days. Table sessions: removed after use.</li>
      <li>When a café leaves CafeTap, its data is deleted on request.</li></ul>

    <h2 style={H}>Your choices</h2>
    <p>You can ask for a copy, a correction or deletion of information about you, and you can withdraw consent where we rely on it. Because guest orders carry no name, include the café, table and time so we can find them. Contact the café first, or write to us.</p>

    <h2 style={H}>Children</h2>
    <p>CafeTap is not meant for children to use on their own, and we do not knowingly collect information from them.</p>

    <h2 style={H}>Security and complaints</h2>
    <p>We protect data with encrypted connections, strict access rules between cafés, limited staff permissions and regular backups. If something goes wrong with your information, tell us and we will respond promptly.</p>
    <p>{MAIL ? <>Privacy questions and complaints: <a href={'mailto:' + MAIL}>{MAIL}</a>.</> : 'Please use the contact details on our home page.'} See also our <Link to="/terms">Terms</Link>.</p>
  </div></main>)
}
