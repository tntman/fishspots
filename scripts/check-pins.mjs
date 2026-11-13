// Kontrollerar kartnålarna mot det ställena själva anger.
//   node scripts/check-pins.mjs [fil.json]          skriver rapport till pin-report.json
//   node scripts/check-pins.mjs [fil.json] --apply  flyttar nålar med säker källa
// Källor i prioritetsordning:
//   1. en Google Maps-länk eller karta på ställets egen webbplats (där verksamheten själv satt sin plats)
//   2. adressen från ställets egen webbplats (fältet address), om den ger en exakt träff med rätt postnummer
// Varje nål kontrolleras också mot sjön: ligger den mer än 3 km från sjön flaggas den.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--')) ?? 'data/spots.json';
const spots = JSON.parse(readFileSync(file, 'utf8'));
const UA = { 'User-Agent': 'spot-geocoder/1.0' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const inSweden = (lat, lng) => lat >= 55 && lat <= 69.5 && lng >= 10.5 && lng <= 24.5;

function km(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function get(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

// Koordinater ur kartlänkar och inbäddade kartor, säkraste formen först.
function mapCoords(html) {
  const text = html.replaceAll('&amp;', '&').replaceAll('%2C', ',');
  const forms = [
    [/!3d(-?\d+\.\d{3,})!4d(-?\d+\.\d{3,})/g, (m) => [m[1], m[2]]], // plats i en Google Maps-länk
    [/!2d(-?\d+\.\d{3,})!3d(-?\d+\.\d{3,})/g, (m) => [m[2], m[1]]], // inbäddad Google-karta (lng först)
    [/[?&](?:q|ll|query|center|daddr|destination)=(-?\d+\.\d{3,}),\s*(-?\d+\.\d{3,})/g, (m) => [m[1], m[2]]],
    [/@(-?\d+\.\d{3,}),(-?\d+\.\d{3,}),\d+(?:\.\d+)?z/g, (m) => [m[1], m[2]]], // kartvyns mitt
  ];
  for (const [re, pick] of forms) {
    for (const m of text.matchAll(re)) {
      const [lat, lng] = pick(m).map(Number);
      if (inSweden(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

// Startsidan plus de undersidor som brukar ha karta eller adress.
async function siteCoords(site) {
  if (!site) return null;
  const home = await get(site);
  const found = mapCoords(home);
  if (found) return { ...found, page: site };
  const links = [...home.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1])
    .filter((h) => /hitta|kontakt|contact|find|karta|map|vagbeskrivning|vägbeskrivning|adress|om-oss|about/i.test(h));
  for (const href of [...new Set(links)].slice(0, 5)) {
    let url;
    try { url = new URL(href, site).href; } catch { continue; }
    const c = mapCoords(await get(url));
    if (c) return { ...c, page: url };
  }
  return null;
}

// Nominatim: högst ett anrop per sekund enligt deras villkor.
let last = 0;
async function nominatim(params) {
  await sleep(Math.max(0, last + 1100 - Date.now()));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=se&limit=5&${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

// Avstånd från nålen till sjöns utbredning (0 om nålen ligger inom den).
async function lakeDistance(s) {
  const hits = (await nominatim({ q: s.lake.replace(/\s*\(.*\)$/, '') }))
    .filter((h) => (h.category === 'natural' || h.category === 'water') && h.display_name.includes(s.county));
  if (!hits.length) return null;
  return Math.min(...hits.map((h) => {
    const [s1, n1, w1, e1] = h.boundingbox.map(Number);
    const lat = Math.min(Math.max(s.lat, s1), n1);
    const lng = Math.min(Math.max(s.lng, w1), e1);
    return km(s, { lat, lng });
  }));
}

const PRECISE = new Set(['house', 'building', 'farm', 'isolated_dwelling', 'camp_site', 'caravan_site', 'chalet',
  'hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'residential', 'yes']);

async function addressCoords(s) {
  if (!s.address) return null;
  const postcode = s.address.match(/\b(\d{3})\s?(\d{2})\b/);
  const hits = await nominatim({ q: s.address });
  const hit = hits.find((h) => PRECISE.has(h.type) && h.display_name.includes(s.county)
    && (!postcode || (h.address?.postcode || '').replace(/\s/g, '') === postcode[1] + postcode[2]));
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), type: hit.type } : null;
}

const report = [];
const queue = [...spots.entries()];
// Webbplatserna hämtas sex åt gången; Nominatim-anropen köas av nominatim().
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [i, s] = next;
    const site = await siteCoords(s.website || s.sourceUrl);
    const addr = site ? null : await addressCoords(s);
    const lake = await lakeDistance(s);
    const best = site ? { ...site, source: 'karta på egen sida' } : addr ? { ...addr, source: 'adress' } : null;
    const moveKm = best ? km(s, best) : null;
    const verdict = best ? (moveKm > 0.3 ? 'FLYTTA' : 'ok')
      : lake == null ? 'GRANSKA (sjön hittades inte)'
      : lake > 3 ? `GRANSKA (${lake.toFixed(1)} km från sjön)` : 'ok (nära sjön, ingen exakt källa)';
    report[i] = { name: s.name, lake: s.lake, address: s.address || '', pin: [s.lat, s.lng], best, moveKm, lakeKm: lake, verdict };
    console.log(`${verdict.padEnd(34)} ${s.name}${best ? `  ${moveKm.toFixed(1)} km, ${best.source}` : ''}`);
  }
}));

writeFileSync('pin-report.json', `${JSON.stringify(report, null, 2)}\n`);
const moves = report.filter((r) => r.verdict === 'FLYTTA');
console.log(`\n${moves.length} att flytta, ${report.filter((r) => r.verdict.startsWith('GRANSKA')).length} att granska. Rapport: pin-report.json`);

if (apply) {
  for (const r of moves) {
    const s = spots.find((x) => x.name === r.name);
    s.lat = Number(r.best.lat.toFixed(5));
    s.lng = Number(r.best.lng.toFixed(5));
  }
  writeFileSync(file, `${JSON.stringify(spots, null, 2)}\n`);
  console.log(`${moves.length} nålar flyttade i ${file}.`);
}
