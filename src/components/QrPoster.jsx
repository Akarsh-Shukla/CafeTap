import { useEffect, useId, useState } from 'react'
import QRCodeStyling from 'qr-code-styling'

// Table posters with a styled QR code. The QR settings below were checked with a scanner: strong error correction, a small centre logo
// and plain square corner frames (rounded corner frames did not scan). Do not make them rounder or the logo bigger.
export const SHAPES = [['rounded', 'Rounded squares'], ['dots', 'Round dots'], ['extra-rounded', 'Soft blobs'], ['classy-rounded', 'Classy']]
const lum = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
export const contrast = (a, b = '#ffffff') => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
export const hexOk = c => /^#[0-9a-fA-F]{6}$/.test(c || '')

// A round badge with letters, used in the centre when the café has no logo.
export const badgeImage = (text, color) => {
  const t = String(text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'C', c = hexOk(color) ? color : '#333333'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="96" fill="#fff" stroke="${c}" stroke-width="8"/><text x="100" y="100" text-anchor="middle" dominant-baseline="central" font-family="Georgia,serif" font-weight="700" font-size="${t.length > 2 ? 64 : 84}" fill="${c}">${t}</text></svg>`
  return 'data:image/svg+xml;base64,' + btoa(svg)
}
const toDataUrl = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob) })

export function makeQr({ value, color, shape = 'rounded', cornerDot = 'dot', image }) {
  return new QRCodeStyling({ width: 300, height: 300, type: 'svg', data: value, margin: 18, qrOptions: { errorCorrectionLevel: 'H' }, image: image || undefined,
    dotsOptions: { color, type: shape }, backgroundOptions: { color: '#ffffff' }, imageOptions: { crossOrigin: 'anonymous', margin: 3, imageSize: 0.22, hideBackgroundDots: true },
    cornersSquareOptions: { color, type: 'square' }, cornersDotOptions: { color, type: cornerDot } })
}
// The finished QR as an image address (SVG), ready to place in a poster.
export function useQrImage(opts) {
  const [url, setUrl] = useState(null), key = JSON.stringify([opts.value, opts.color, opts.shape, opts.cornerDot, opts.image])
  useEffect(() => { let live = true; setUrl(null); makeQr(opts).getRawData('svg').then(b => b && toDataUrl(b)).then(u => live && setUrl(u)).catch(() => {}); return () => { live = false } }, [key])
  return url
}

export const POSTER_STYLES = {
  arch: { label: 'Olive arch', bg: '#7d8f3c', card: '#f8f2de', ink: '#4b3d17', accent: '#8a6a1f', qr: '#4b3d17', pattern: 'diamond', frame: 'arch' },
  blush: { label: 'Blush garden', bg: '#ee8f98', card: '#fffaf6', ink: '#6e2d3a', accent: '#c2456a', qr: '#6e2d3a', pattern: 'leaf', frame: 'round' },
  fresh: { label: 'Citrus fresh', bg: '#f1d04b', card: '#fffbe6', ink: '#3f5217', accent: '#6e8c1f', qr: '#3f5217', pattern: 'dots', frame: 'round' },
  noir: { label: 'Rose gold noir', bg: '#2d2d2d', card: '#f4ebe3', ink: '#5b3a2c', accent: '#c58f73', qr: '#5b3a2c', pattern: 'lines', frame: 'round' },
}
const FONT = "Georgia, 'Times New Roman', serif", SANS = 'Arial, Helvetica, sans-serif'
const Pattern = ({ id, kind, ink, accent }) => <pattern id={id} width="44" height="44" patternUnits="userSpaceOnUse">
  {kind === 'diamond' && <path d="M22 5L39 22L22 39L5 22Z" fill="none" stroke={ink} strokeOpacity=".22" strokeWidth="2" />}
  {kind === 'leaf' && <path d="M8 34C8 12 32 10 36 10C36 32 12 36 8 34Z" fill="#fff" fillOpacity=".2" />}
  {kind === 'dots' && <><circle cx="11" cy="11" r="4" fill="#fff" fillOpacity=".4" /><circle cx="33" cy="33" r="4" fill="#fff" fillOpacity=".4" /></>}
  {kind === 'lines' && <path d="M0 44L44 0" stroke={accent} strokeOpacity=".28" strokeWidth="2" />}</pattern>

// A 2:3 table poster: pattern background, café name, table label, the QR and an instruction line.
export function QrPoster({ id, qr, name, label, style = 'noir', tagline, brand = true }) {
  const s = POSTER_STYLES[style] || POSTER_STYLES.noir, pid = 'p' + useId().replace(/[^a-zA-Z0-9]/g, ''), arch = s.frame === 'arch', ny = arch ? 238 : 196
  const nm = (name || '').slice(0, 26), fs = nm.length > 20 ? 26 : nm.length > 14 ? 32 : 40
  return (<svg id={id} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="100%" role="img" aria-label={`QR poster for ${label}`} style={{ display: 'block', maxWidth: 300 }}>
    <defs><Pattern id={pid} kind={s.pattern} ink={s.ink} accent={s.accent} /></defs>
    <rect width="600" height="900" rx="34" fill={s.bg} /><rect width="600" height="900" rx="34" fill={`url(#${pid})`} />
    {style === 'noir' && <rect x="18" y="18" width="564" height="864" rx="22" fill="none" stroke={s.accent} strokeWidth="2" />}
    {style === 'fresh' && <g><circle cx="64" cy="72" r="52" fill="#f4a62a" /><circle cx="64" cy="72" r="43" fill="#ffe08a" /><path d="M64 29V115M21 72H107M33 41L95 103M95 41L33 103" stroke="#fff" strokeWidth="3" strokeOpacity=".8" /></g>}
    {style === 'blush' && <g fill={s.accent} fillOpacity=".85"><path d="M36 840C30 790 70 760 120 764C124 812 84 846 36 840Z" /><path d="M564 840C570 790 530 760 480 764C476 812 516 846 564 840Z" /></g>}
    {arch ? <><path d="M78 846V320A222 222 0 0 1 522 320V846Z" fill={s.card} /><path d="M92 832V320A208 208 0 0 1 508 320V832Z" fill="none" stroke={s.accent} strokeWidth="3" /></>
      : <><rect x="58" y="74" width="484" height="772" rx="46" fill={s.card} /><rect x="72" y="88" width="456" height="744" rx="34" fill="none" stroke={s.accent} strokeWidth="3" /></>}
    <text x="300" y={ny} textAnchor="middle" fontFamily={FONT} fontWeight="700" fontSize={fs} fill={s.ink}>{nm}</text>
    <g stroke={s.accent} strokeWidth="2"><path d={`M190 ${ny + 24}H278M322 ${ny + 24}H410`} /><path d={`M300 ${ny + 16}l8 8l-8 8l-8 -8z`} fill={s.accent} /></g>
    <rect x="212" y="300" width="176" height="46" rx="23" fill={s.accent} /><text x="300" y="331" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="22" letterSpacing="2" fill="#fff">{(label || '').toUpperCase().slice(0, 14)}</text>
    {qr ? <image href={qr} x="150" y="366" width="300" height="300" /> : <rect x="150" y="366" width="300" height="300" fill="#fff" />}
    <text x="300" y="720" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="19" letterSpacing="3" fill={s.ink}>{(tagline || 'SCAN TO VIEW THE MENU').toUpperCase().slice(0, 34)}</text>
    <text x="300" y="750" textAnchor="middle" fontFamily={SANS} fontSize="15" letterSpacing="2" fill={s.ink} fillOpacity=".7">POINT YOUR CAMERA OR TAP YOUR PHONE</text>
    {brand && <text x="300" y="806" textAnchor="middle" fontFamily={SANS} fontSize="13" letterSpacing="2" fill={s.ink} fillOpacity=".55">POWERED BY CAFETAP</text>}
  </svg>)
}

export const fetchDataUrl = async u => { try { return await toDataUrl(await (await fetch(u)).blob()) } catch { return null } }
export const svgText = el => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el)
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }
export const downloadSvg = (el, name) => save(new Blob([svgText(el)], { type: 'image/svg+xml' }), name + '.svg')
export async function downloadPng(el, name, w = 1800) {
  const img = new Image(), url = URL.createObjectURL(new Blob([svgText(el)], { type: 'image/svg+xml' }))
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url })
  const c = document.createElement('canvas'); c.width = w; c.height = w * 1.5; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url)
  c.toBlob(b => save(b, name + '.png'), 'image/png')
}
