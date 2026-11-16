globalThis.window = { location: { origin: 'http://localhost:5173' }, print() {} }
import React from 'react'
import { renderToString } from 'react-dom/server'
import { Home, MenuPage, Wifi, Review, Feedback, Offers, Dock, Card, Ph } from '../../src/pages/Guest.jsx'
import Landing from '../../src/pages/Landing.jsx'
import Privacy from '../../src/pages/Privacy.jsx'
import Login from '../../src/pages/Login.jsx'
import Welcome from '../../src/pages/Welcome.jsx'
import Admin from '../../src/pages/Admin.jsx'
import Dashboard, { Workspace, Overview } from '../../src/pages/Dashboard.jsx'
import Settings from '../../src/pages/dash/Settings.jsx'
import Business from '../../src/pages/dash/Business.jsx'
import MenuEditor from '../../src/pages/dash/MenuEditor.jsx'
import OffersEd from '../../src/pages/dash/Offers.jsx'
import Tables from '../../src/pages/dash/Tables.jsx'
import Board, { Detail, AddOrder } from '../../src/pages/pos/Board.jsx'
import Sales from '../../src/pages/pos/Sales.jsx'
import Kitchen from '../../src/pages/pos/Kitchen.jsx'
import Register from '../../src/pages/dash/Register.jsx'
import StaffAccess from '../../src/pages/dash/StaffAccess.jsx'
import AlertBar from '../../src/components/AlertBar.jsx'
import PosSettings from '../../src/pages/pos/PosSettings.jsx'
import { CartSheet, CartBar, Stepper, AddonSheet } from '../../src/pages/Order.jsx'
import DesignPreview from '../../src/components/DesignPreview.jsx'
import BillDoc from '../../src/components/BillDoc.jsx'
import Bill from '../../src/pages/Bill.jsx'
import Terms from '../../src/pages/Terms.jsx'
import Extras from '../../src/pages/dash/Extras.jsx'
import Availability from '../../src/pages/dash/Availability.jsx'
import BillSettings from '../../src/pages/pos/BillSettings.jsx'
import InstallButton from '../../src/components/Install.jsx'
import { QrPoster } from '../../src/components/QrPoster.jsx'
import Art from '../../src/components/Art.jsx'
import ErrorBoundary from '../../src/components/ErrorBoundary.jsx'

const STORE = 'https://x.supabase.co/storage/v1/object/public/cafe-images/u/a.webp'
const cafe = (over = {}) => ({ id: '11111111-1111-1111-1111-111111111111', slug: 'rsn-foods', name: 'RSN Foods', tagline: 'Chai and more', theme: 'roastery', about: 'Our story', hours: '9am to 9pm', cover_url: null, logo_url: null, published: true, plan_tier: 'pos', suspended: false,
  settings: { options: ['menu', 'offers', 'wifi', 'review', 'feedback'], insta: 'https://instagram.com/x', review_url: 'https://g.page/x', wifi_name: 'W', address: 'Kanpur', phone: '+91 99999 99999', maps: 'https://maps.app.goo.gl/x', design: { accent: '#aa3300', font: 'modern', radius: 'soft', art: 'chai', greeting: 'Hi', calm: false } }, ...over })
const item = (o = {}) => ({ id: 'i1', name: 'Masala Chai', description: 'Hot', price_paise: 3000, image_url: null, is_available: true, sort_order: 0, badge: 'bestseller', diet: 'veg', _cat: 'Chai', ...o })
const results = []
const t = (name, fn) => { try { const out = renderToString(fn()); results.push(['PASS', name, out.length]) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const withCtx = (c, node, params = {}) => { globalThis.__ctx = { cafe: c, slug: c.slug }; globalThis.__params = params; return node }

for (const theme of ['roastery', 'bakery', 'chai', 'sage', 'mocha']) t('Home theme ' + theme, () => withCtx(cafe({ theme }), <Home />))
t('Home with cover+logo', () => withCtx(cafe({ cover_url: STORE, logo_url: STORE }), <Home />))
t('Home table link', () => withCtx(cafe(), <Home />, { table: 'tok' }))
t('Home no settings', () => withCtx(cafe({ settings: null }), <Home />))
t('Home no options', () => withCtx(cafe({ settings: {} }), <Home />))
t('Dock', () => { globalThis.__path = '/rsn-foods/menu'; return <Dock cafe={cafe()} slug="rsn-foods" /> })
t('Menu (initial)', () => withCtx(cafe(), <MenuPage />))
t('Wifi', () => withCtx(cafe(), <Wifi />)); t('Review', () => withCtx(cafe(), <Review />)); t('Feedback', () => withCtx(cafe(), <Feedback />)); t('Offers', () => withCtx(cafe(), <Offers />))
const ord = (can = true) => ({ enabled: true, table: 't', can, hint: false, lines: [{ key: 'i1|', id: 'i1', adds: [], qty: 2 }], setLines() {}, addLine() {}, decKey() {}, qtyOf: () => 2, custom: () => false, pick() {}, sub() {}, price: i => '₹' + i.price_paise / 100, ex: { groups: {}, addonById: {}, combo: {}, isCombo: {}, from: {}, diets: {} }, setEx() {}, picker: null, setPicker() {} })
t('Card photo', () => <Card i={item({ image_url: STORE })} cls="gcard wide" onOpen={() => {}} fav toggle={() => {}} ord={ord()} />)
t('Card no photo, sold out', () => <Card i={item({ is_available: false })} cls="pick" onOpen={() => {}} fav={false} toggle={() => {}} ord={ord(false)} />)
for (const k of ['latte', 'iced', 'croissant', 'cake', 'sandwich', 'chai', 'dish', 'egg', 'beans']) t('Art ' + k, () => <Art kind={k} />)
t('Stepper custom', () => <Stepper qty={2} onAdd={() => {}} onSub={() => {}} name="x" custom />)
t('AddonSheet versions', () => <AddonSheet vegOnly item={item()} groups={[{ id: 'v1', name: 'Portion', kind: 'variant', min_select: 1, max_select: 1, addons: [{ id: 'a1', name: 'Half', price_minor: 8000, is_available: true, diet: 'veg' }, { id: 'a2', name: 'Full', price_minor: 15000, is_available: true, diet: 'nonveg' }] }]} onClose={() => {}} onAdd={() => {}} />)
t('AddonSheet', () => <AddonSheet item={item()} groups={[{ id: 'g1', name: 'Size', min_select: 1, max_select: 1, addons: [{ id: 'a1', name: 'Large', price_minor: 2000, is_available: true }, { id: 'a2', name: 'Small', price_minor: 0, is_available: false }] }, { id: 'g2', name: 'Extras', min_select: 0, max_select: 3, addons: [{ id: 'a3', name: 'Extra shot', price_minor: 3000, is_available: true }] }]} onClose={() => {}} onAdd={() => {}} />)
t('Stepper', () => <><Stepper qty={0} onAdd={() => {}} onSub={() => {}} name="x" /><Stepper qty={3} onAdd={() => {}} onSub={() => {}} name="x" /></>)
t('CartBar+CartSheet', () => { const byId = { i1: item() }; return <><CartBar ord={ord()} byId={byId} onOpen={() => {}} /><CartSheet cafe={cafe()} ord={ord()} byId={byId} open onClose={() => {}} onRefresh={() => {}} /></> })
t('Landing', () => <Landing />); t('Privacy', () => <Privacy />); t('Login', () => <Login />); t('Welcome', () => <Welcome />); t('Admin', () => <Admin />); t('Dashboard', () => <Dashboard />)
t('Workspace owner POS', () => <Workspace cafe={cafe()} uid="u" reload={() => {}} />)
t('Workspace admin', () => <Workspace cafe={cafe({ cafe_admin: { plan: 'trial' } })} uid="u" isAdmin reload={() => {}} onBack={() => {}} />)
t('Workspace suspended', () => <Workspace cafe={cafe({ suspended: true })} uid="u" reload={() => {}} />)
t('Overview', () => <Overview cafe={cafe()} go={() => {}} publish={() => {}} isAdmin={false} />)
t('Settings', () => <Settings cafe={cafe()} uid="u" reload={() => {}} />); t('Settings empty', () => <Settings cafe={cafe({ settings: {} })} uid="u" reload={() => {}} />)
t('Business', () => <Business cafe={cafe({ cafe_admin: [{ plan: 'trial', owner_email: 'a@b.c' }] })} reload={() => {}} onDeleted={() => {}} />)
t('MenuEditor', () => <MenuEditor cafe={cafe()} uid="u" />); t('Offers editor', () => <OffersEd cafe={cafe()} pos />); t('Offers editor Basic', () => <OffersEd cafe={cafe({ plan_tier: 'basic' })} />); t('Extras', () => <Extras cafe={cafe()} />); t('Availability', () => <Availability cafe={cafe()} />); t('BillSettings', () => <BillSettings cafe={cafe()} />); t('Tables', () => <Tables cafe={cafe()} />)
t('Board (initial)', () => <Board cafe={cafe()} perms={{ orders: true, payments: true, close: true, owner: true }} />)
const detailProps = { cafe: cafe(), perms: { orders: true, payments: true, close: true, owner: true }, act: async () => ({}), msg: '', back: () => {},
  items: [{ order_id: 'o1', name_snapshot: 'Chai', quantity: 2, line_total_minor: 6000, addons: [{ id: 'a1', name: 'Less sugar' }], combo: null }, { order_id: 'o1', name_snapshot: 'Burger meal', quantity: 1, line_total_minor: 24900, addons: [], combo: [{ name: 'Burger', qty: 1 }, { name: 'Fries', qty: 1 }] }], pays: [{ id: 'p1', bill_id: 'b1', amount_minor: 1000, method: 'cash', event_type: 'payment', recorded_at: new Date().toISOString(), note: 'x' }],
  v: { t: { id: 't1', display_name: 'Table 1' }, s: { id: 's1', opened_at: new Date().toISOString() }, b: { id: 'b1', subtotal_minor: 6600, discount_minor: 600, offer: { title: '10% off', rule: '10% off for orders above ₹500', free_items: [{ name: 'Chai', qty: 1 }] }, total_minor: 6000, paid_minor: 1000 }, os: [{ id: 'o1', ref: 'ABC123', status: 'received', source: 'customer', note: 'less sugar', total_minor: 6000, created_at: new Date().toISOString() }], bal: 5000, state: 'Active', live: true } }
t('Board Detail', () => <Detail {...detailProps} />)
t('Board Detail empty table', () => <Detail {...detailProps} v={{ t: { id: 't1', display_name: 'Table 1' }, s: undefined, b: undefined, os: [], bal: 0, state: 'Available', live: false }} />)
t('AddOrder', () => <AddOrder cafe={cafe()} table={{ id: 't1', display_name: 'Table 1' }} act={async () => ({})} done={() => {}} />)
t('Kitchen', () => <Kitchen cafe={cafe()} />); t('Register owner', () => <Register cafe={cafe({ plan_tier: 'basic' })} owner />); t('Register staff', () => <Register cafe={cafe({ plan_tier: 'basic' })} owner={false} />)
t('StaffAccess POS', () => <StaffAccess cafe={cafe()} />); t('StaffAccess Basic', () => <StaffAccess cafe={cafe({ plan_tier: 'basic' })} />)
t('AlertBar on/off', () => <><AlertBar prefs={{ on: true, mode: 'both' }} setPrefs={() => {}} label="Order" /><AlertBar prefs={{ on: false, mode: 'both' }} setPrefs={() => {}} label="Order" /></>)
t('Workspace owner Basic', () => <Workspace cafe={cafe({ plan_tier: 'basic' })} uid="u" reload={() => {}} />)
t('Sales', () => <Sales cafe={cafe()} />); t('PosSettings owner', () => <PosSettings cafe={cafe()} isAdmin={false} />); t('PosSettings admin', () => <PosSettings cafe={cafe()} isAdmin />)
t('DesignPreview', () => <DesignPreview name="RSN" tagline="x" theme="sage" design={{ accent: '#123456', font: 'elegant', radius: 'round', art: '', greeting: '' }} />)
const bill = (o = {}) => ({ ok: true, cafe: { name: 'RSN Foods', address: 'Kanpur', phone: '+91 99999 99999', footer: 'Thank you!', theme: 'roastery', design: {} }, bill_no: 7, label: 'B-00007', date: new Date().toISOString(), table: 'Table 4',
  lines: [{ name: 'Cappuccino', qty: 2, unit_minor: 9500, total_minor: 19000, addons: [{ id: 'a', name: 'Extra shot', price_minor: 500 }], combo: null }, { name: 'Burger meal', qty: 1, unit_minor: 24900, total_minor: 24900, addons: [], combo: [{ name: 'Burger', qty: 1 }, { name: 'Fries', qty: 1 }] }],
  subtotal_minor: 43900, bill_subtotal_minor: 43900, discount_minor: 4390, offer: { title: '10% off', rule: '10% off for orders above ₹300', free_items: null }, total_minor: 39510, tax: [{ name: 'CGST', rate: 2.5, amount_minor: 940 }, { name: 'SGST', rate: 2.5, amount_minor: 940 }], taxable_minor: 37630,
  payment: { state: 'paid', methods: [{ method: 'upi' }] }, orders: [{ ref: 'AB12CD', status: 'completed' }], shared: false, guest_only: true, ...o })
t('BillDoc paid with offer and tax', () => <BillDoc bill={bill()} />)
t('BillDoc pending, no offer, no tax', () => <BillDoc bill={bill({ offer: null, discount_minor: 0, total_minor: 43900, tax: [], label: null, bill_no: null, payment: { state: 'pending', methods: [] } })} />)
t('BillDoc free items offer', () => <BillDoc bill={bill({ offer: { title: 'Buy 1 Get 1', rule: 'Buy 1, get 1 free on Coffee', free_items: [{ name: 'Cappuccino', qty: 1 }] }, payment: { state: 'partial', methods: [{ method: 'cash', amount_minor: 1000 }] } })} />)
t('BillDoc shared table', () => <BillDoc bill={bill({ shared: true, bill_subtotal_minor: 90000, tax: [] })} />)
t('BillDoc empty', () => <BillDoc bill={bill({ lines: [], subtotal_minor: 0 })} />)
t('Bill page (loading)', () => withCtx(cafe(), <Bill />, { token: 'a'.repeat(64) }))
t('Terms', () => <Terms />); t('Install button', () => <InstallButton />)
for (const style of ['arch', 'blush', 'fresh', 'noir']) t('QrPoster ' + style, () => <QrPoster id="x" qr="data:image/svg+xml;base64,AAAA" name="RSN Foods" label="Table 4" style={style} tagline="Scan to view the menu" />)
t('QrPoster loading', () => <QrPoster id="x" qr={null} name="A very long café name that is cut" label="Table 12" />)
t('ErrorBoundary', () => <ErrorBoundary><Home /></ErrorBoundary>)
let bad = 0; for (const r of results) { if (r[0] === 'FAIL') bad++; console.log(r.join(' | ')) } console.log('\nFAILED:', bad, 'of', results.length)
