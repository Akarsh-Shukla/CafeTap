// Safety checks that need no database: run with  npm run test:static  (add --list to see every function's exposure)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
let fails = 0
const bad = msg => { fails++; console.log('FAIL ' + msg) }
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
const src = walk('src').filter(f => /\.(jsx?|css)$/.test(f))

// ---------- SQL install files, in the order they must be run ----------
const sqlFiles = ['schema.sql', ...Array.from({ length: 11 }, (_, i) => `migration-${i + 2}.sql`)].map(f => 'supabase/' + f)
const strip = sql => sql.split('\n').map(l => { let q = 0; for (let i = 0; i < l.length - 1; i++) { if (l[i] === "'") q ^= 1; if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i) } return l }).join('\n')
const T = { integer: 'int', boolean: 'bool', 'character varying': 'varchar' }
const norm = t => { t = t.toLowerCase().replace(/\s+/g, ' ').trim(); return T[t] || t }
function splitTop(str) { const out = []; let d = 0, cur = ''; for (const ch of str) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = '' } else cur += ch } if (cur.trim()) out.push(cur); return out }
const args = (str, named) => splitTop(str).map(p => { p = p.trim().replace(/^(in|inout|variadic)\s+/i, '').replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, ''); if (named) { const m = p.match(/^[a-z_][a-z0-9_]*\s+([\s\S]+)$/i); if (m) p = m[1] } return norm(p) }).join(',')
const sigList = text => splitTop(text).map(x => { const m = x.trim().match(/^([a-z_0-9.]+)\s*\(([\s\S]*)\)$/i); return m ? m[1].toLowerCase().replace(/^public\./, '') + '(' + args(m[2], false) + ')' : null }).filter(Boolean)
const events = []
let tables = new Set(), rls = new Set()
sqlFiles.forEach((f, fi) => {
  if (!fs.existsSync(path.join(root, f))) return bad('missing install file ' + f)
  const s = strip(read(f)); let m
  const base = fi * 1e7
  const fn = /create\s+(?:or\s+replace\s+)?function\s+([a-z_0-9.]+)\s*\(/gi
  while ((m = fn.exec(s))) {
    let d = 1, i = fn.lastIndex; while (d && i < s.length) { if (s[i] === '(') d++; if (s[i] === ')') d--; i++ }
    const header = s.slice(i, s.indexOf('$', i)), name = m[1].toLowerCase().replace(/^public\./, '')
    events.push({ at: base + m.index, t: 'create', sig: name + '(' + args(s.slice(fn.lastIndex, i - 1), true) + ')', name, secdef: /security\s+definer/i.test(header), path: /set\s+search_path/i.test(header), trig: /returns\s+trigger/i.test(header), f })
  }
  const dr = /drop\s+function\s+(?:if\s+exists\s+)?([^;]+);/gi
  while ((m = dr.exec(s))) sigList(m[1].replace(/\s+cascade\s*$/i, '')).forEach(sig => events.push({ at: base + m.index, t: 'drop', sig }))
  const ac = /(revoke|grant)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+([^;]*?)\s+(from|to)\s+([^;]+);/gi
  while ((m = ac.exec(s))) sigList(m[2]).forEach(sig => events.push({ at: base + m.index, t: m[1].toLowerCase(), sig, roles: m[4].split(',').map(x => x.trim().toLowerCase()), f }))
  for (const t of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi)) tables.add(t[1].toLowerCase())
  for (const t of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+enable\s+row\s+level\s+security/gi)) rls.add(t[1].toLowerCase())
})
events.sort((a, b) => a.at - b.at)
const fns = new Map()
for (const e of events) {
  if (e.t === 'create') { const o = fns.get(e.sig) || { publicRevoked: false, anonRevoked: false, anonGranted: false }; fns.set(e.sig, { ...o, name: e.name, secdef: e.secdef, path: e.path, trig: e.trig, f: e.f }) }
  else if (e.t === 'drop') fns.delete(e.sig)
  else { const s = fns.get(e.sig); if (!s) { bad(`${e.t} on a function that does not exist at that point: ${e.sig} (${e.f})`); continue }
    if (e.t === 'revoke') { if (e.roles.includes('public')) s.publicRevoked = true; if (e.roles.includes('anon')) { s.anonRevoked = true; s.anonGranted = false } if (e.roles.includes('public')) s.anonGranted = false }
    else if (e.roles.includes('anon') || e.roles.includes('public')) s.anonGranted = true }
}
const exposed = [...fns].filter(([, s]) => !s.trig && (!(s.publicRevoked && s.anonRevoked) || s.anonGranted)).map(([sig, s]) => ({ sig, ...s }))   // trigger functions cannot be called directly, so they are not counted
if (process.argv.includes('--list')) { console.log('Functions callable by anonymous visitors:'); exposed.forEach(s => console.log('  ' + s.sig)) }

// 1. every definer function pins its search path
for (const [sig, s] of fns) if (s.secdef && !s.path) bad(`security definer without "set search_path": ${sig} (${s.f})`)
// 2. no duplicate versions of a function (they cause "not unique" errors and old, unsafe copies)
const byName = new Map(); for (const [sig, s] of fns) byName.set(s.name, [...(byName.get(s.name) || []), sig])
for (const [n, l] of byName) if (l.length > 1) bad(`two versions of ${n}: ${l.join('  |  ')}`)
// 3. only these are callable without logging in; everything else must be locked
const FRONT = f => new Set([...read(f).matchAll(/rpc\(\s*'([a-z_0-9]+)'/g)].map(m => m[1]))
const guestRpc = new Set(['src/pages/Guest.jsx', 'src/pages/Order.jsx', 'src/pages/Bill.jsx', 'src/lib/menu.js', 'src/lib/util.js'].flatMap(f => [...FRONT(f)]))
const HELPERS = new Set(['is_published', 'is_owner', 'owns_cafe', 'is_admin', 'staff_can', 'cafe_has_pos', 'register_access', 'item_cafe'])   // used inside security policies
const allowedAnon = new Set([...guestRpc, ...HELPERS])
for (const s of exposed) if (!allowedAnon.has(s.name)) bad(`callable without login but not on the allow-list: ${s.sig} (${s.f})`)
for (const n of guestRpc) if (!exposed.some(s => s.name === n)) bad(`guests need ${n} but it is not callable by them`)
// 4. the app only calls functions and tables that exist
const allSrc = src.map(f => [f, read(f)]), names = new Set([...fns.values()].map(s => s.name))
for (const [f, t] of allSrc) { for (const m of t.matchAll(/rpc\(\s*'([a-z_0-9]+)'/g)) if (!names.has(m[1])) bad(`${f} calls ${m[1]}, which is not in the SQL`)
  for (const m of t.matchAll(/\.from\(\s*'([a-z_0-9]+)'/g)) if (!tables.has(m[1])) bad(`${f} reads table ${m[1]}, which is not in the SQL`) }
// 5. row level security on every table
for (const t of tables) if (!rls.has(t)) bad(`row level security not enabled on ${t}`)
// 6. things that must never come back
for (const [f, t] of allSrc) { if (/get_public_bill|pos_order_status|qrcode\.react|dangerouslySetInnerHTML/.test(t)) bad(`${f} uses something removed for safety`)
  if (/Guest\.jsx|Bill\.jsx/.test(f) && /from\('cafes'\)\.select\('\*'\)/.test(t)) bad(`${f} reads every column of cafes (owner_id would leak)`) }
for (const f of [...walk('public'), ...walk('functions'), ...src].filter(f => /\.(js|jsx|html|json|webmanifest)$/.test(f))) if (/service_role/.test(read(f))) bad(`service_role found in ${f}`)
// 6b. audit log entries must use a category the database accepts
for (const f of sqlFiles) for (const m of strip(read(f)).matchAll(/_audit\(\s*[^,]+,\s*'([a-z_]+)'/g)) if (!['platform', 'pos'].includes(m[1])) bad(`${f}: _audit uses category '${m[1]}', the database only accepts platform or pos`)
// 7. imports: packages are declared, files exist
const pkg = JSON.parse(read('package.json')), deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const [f, t] of allSrc.filter(([f]) => /\.jsx?$/.test(f))) for (const m of t.matchAll(/(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
  const spec = m[1] || m[2]
  if (spec.startsWith('.')) { const p = path.join(path.dirname(f), spec); if (!['', '.js', '.jsx', '.css', '/index.js', '/index.jsx'].some(x => fs.existsSync(path.join(root, p + x)) && fs.statSync(path.join(root, p + x)).isFile())) bad(`${f}: missing file ${spec}`) }
  else if (!spec.startsWith('/')) { const n = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]; if (!deps[n]) bad(`${f}: package ${n} is not in package.json`) } }
console.log(`${fns.size} SQL functions, ${tables.size} tables, ${exposed.length} callable without login. ${fails ? fails + ' PROBLEM(S) FOUND' : 'static checks: all passed'}`)
process.exit(fails ? 1 : 0)
