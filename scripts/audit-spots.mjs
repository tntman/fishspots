// Går igenom varje ställes egen webbplats och jämför med datafilen.
//   node scripts/audit-spots.mjs [fil.json]              rapport till audit-report.json
//   node scripts/audit-spots.mjs [fil.json] --apply-pins flyttar nålar som har en säker källa
// Läser bara sidor på ställets egen domän (startsidan och undersidor som kontakt, hitta hit, boende, priser, fiske).
// Hittar: adresser med postnummer, telefonnummer, e-post och kartpositioner (Google Maps-länkar/inbäddade kartor).
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const applyPins = args.includes('--apply-pins');
const file = args.find((a) => !a.startsWith('--')) ?? 'data/spots.json';
const spots = JSON.parse(readFileSync(file, 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (spot-audit/1.0)' };
const FREEMAIL = /@(gmail|hotmail|outlook|live|yahoo|icloud|telia|spray|bredband|comhem|msn|me)\./i;
const inSweden = (lat, lng) => lat >= 55 && lat <= 69.5 && lng >= 10.5 && lng <= 24.5;
const MAX_PAGES = 12;

function km(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function get(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    return res.ok && type.includes('html') ? { html: await res.text(), url: res.url } : null;
  } catch {
    return null;
  }
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const text = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|h\d|td|span|a)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/[ \t]+/g, ' ');

// Kartpositioner i sidans HTML, säkraste formen först.
function mapCoords(html) {
  const t = html.replaceAll('&amp;', '&').replaceAll('%2C', ',');
  const forms = [
    [/!3d(-?\d+\.\d{3,})!4d(-?\d+\.\d{3,})/g, (m) => [m[1], m[2]], 'plats i Google Maps-länk'],
    [/!2d(-?\d+\.\d{3,})!3d(-?\d+\.\d{3,})/g, (m) => [m[2], m[1]], 'inbäddad Google-karta'],
    [/[?&](?:q|ll|query|center|daddr|destination)=(-?\d+\.\d{3,}),\s*(-?\d+\.\d{3,})/g, (m) => [m[1], m[2]], 'koordinater i kartlänk'],
    [/data-lat(?:itude)?=["'](-?\d+\.\d{3,})["'][^>]*data-(?:lng|lon|longitude)=["'](-?\d+\.\d{3,})/g, (m) => [m[1], m[2]], 'karta på sidan'],
  ];
  for (const [re, pick, kind] of forms) {
    for (const m of t.matchAll(re)) {
      const [lat, lng] = pick(m).map(Number);
      if (inSweden(lat, lng)) return { lat, lng, kind };
    }
  }
  return null;
}

// Adress = en rad med svenskt postnummer och ort, gärna med gata eller gårdsnamn före.
function addresses(t) {
  const out = new Set();
  for (const m of t.matchAll(/([^\n]{0,60}?)\b(\d{3}) ?(\d{2})\s+([A-ZÅÄÖ][a-zåäöé]+(?:[ -][A-ZÅÄÖ]?[a-zåäöé]+)?)/g)) {
    const before = m[1].replace(/^.*?(?:adress|address|besöksadress|hitta hit)\s*:?\s*/i, '').replace(/^[\s,:;|–-]+|[\s,:;|–-]+$/g, '');
    if (/tel|telefon|org\.?nr|bankgiro|fax/i.test(before)) continue;
    out.add(`${before ? `${before}, ` : ''}${m[2]} ${m[3]} ${m[4]}`.replace(/\s+/g, ' ').trim());
  }
  return [...out];
}

const phones = (html, t) => [...new Set([
  ...[...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1])),
  ...[...t.matchAll(/(?:\+46|\b0)[\s-]?\(?0?\)?\d{1,3}[\s–-]?\d{2,3}[\s–-]?\d{2}[\s–-]?\d{2,3}\b/g)].map((m) => m[0]),
].map((p) => p.replace(/[^\d+]/g, '').replace(/^0/, '+46').replace(/^\+460/, '+46')).filter((p) => p.length >= 10 && p.length <= 13))];

const emails = (html) => [...new Set([...html.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()))]
  .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|wixpress|example|domain\.|@2x/.test(e));

const USEFUL = /kontakt|contact|hitta|find|karta|map|vagbeskriv|vägbeskriv|adress|om-oss|om_oss|about|boende|stug|cabin|logi|accommodation|pris|price|fiske|fishing|bat|båt|boat|uthyr|rental|camping/i;

async function crawl(site) {
  const pages = [];
  const first = await get(site);
  if (!first) return pages;
  pages.push(first);
  const own = host(first.url);
  const links = [...first.html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1])
    .map((h) => { try { return new URL(h, first.url).href; } catch { return ''; } })
    .filter((u) => host(u) === own && USEFUL.test(decodeURIComponent(u)) && !/\.(pdf|jpe?g|png|zip|docx?)$/i.test(u));
  for (const url of [...new Set(links)].slice(0, MAX_PAGES - 1)) {
    const page = await get(url);
    if (page && host(page.url) === own) pages.push(page);
  }
  return pages;
}

// Nominatim i en kö: högst ett anrop per sekund, även när flera ställen kontrolleras samtidigt.
let chain = Promise.resolve();
function nominatim(params) {
  const run = chain.then(async () => {
    await new Promise((ok) => setTimeout(ok, 1100));
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=se&limit=8&${new URLSearchParams(params)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'spot-geocoder/1.0' }, signal: AbortSignal.timeout(20000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function lakeDistance(s) {
  const hits = await nominatim({ q: `${s.lake.replace(/\s*\(.*\)$/, '')}, ${s.county}` });
  if (hits == null) return { error: 'kartdatabasen svarade inte' };
  const lakes = hits.filter((h) => ['natural', 'water', 'waterway'].includes(h.category) || ['lake', 'water', 'reservoir', 'bay'].includes(h.type));
  if (!lakes.length) return { error: 'sjön finns inte i kartdatabasen' };
  return {
    km: Math.min(...lakes.map((h) => {
      const [s1, n1, w1, e1] = h.boundingbox.map(Number);
      return km(s, { lat: Math.min(Math.max(s.lat, s1), n1), lng: Math.min(Math.max(s.lng, w1), e1) });
    })),
  };
}

const PRECISE = new Set(['house', 'building', 'farm', 'isolated_dwelling', 'camp_site', 'caravan_site', 'chalet',
  'hotel', 'guest_house', 'hostel', 'motel', 'apartments', 'yes']);

async function addressCoords(address, county) {
  const postcode = address.match(/\b(\d{3})\s?(\d{2})\b/);
  const hits = await nominatim({ q: address });
  const hit = (hits || []).find((h) => PRECISE.has(h.type) && h.display_name.includes(county)
    && (!postcode || (h.address?.postcode || '').replace(/\s/g, '') === postcode[1] + postcode[2]));
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), kind: `adress (${hit.type})` } : null;
}

const norm = (p) => (p || '').replace(/[^\d+]/g, '').replace(/^0/, '+46');
const report = [];
const queue = [...spots.entries()];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [i, s] = next;
    const site = s.website || s.sourceUrl;
    const pages = await crawl(site);
    const found = { addresses: new Set(), phones: new Set(), emails: new Set(), map: null, mapPage: '' };
    for (const p of pages) {
      const t = text(p.html);
      addresses(t).forEach((a) => found.addresses.add(a));
      phones(p.html, t).forEach((x) => found.phones.add(x));
      emails(p.html).filter((e) => !FREEMAIL.test(e)).forEach((x) => found.emails.add(x));
      if (!found.map) { const c = mapCoords(p.html); if (c) { found.map = c; found.mapPage = p.url; } }
    }
    const pin = { lat: s.lat, lng: s.lng };
    const addrPos = !found.map && s.address ? await addressCoords(s.address, s.county) : null;
    const best = found.map || addrPos;
    const moveKm = best ? km(pin, best) : null;
    const lake = await lakeDistance(s);
    const flags = [];
    if (!pages.length) flags.push('webbplatsen gick inte att läsa');
    if (!s.address && found.addresses.size) flags.push('adress finns på sidan men saknas');
    if (!s.phone && found.phones.size) flags.push('telefon finns på sidan men saknas');
    if (!s.email && found.emails.size) flags.push('e-post finns på sidan men saknas');
    if (s.phone && found.phones.size && ![...found.phones].includes(norm(s.phone))) flags.push('telefonen skiljer sig från sidan');
    if (best && moveKm > 40) flags.push(`kartkällan ligger ${moveKm.toFixed(0)} km bort, kontrollera för hand`);
    if (lake.km > 3) flags.push(`nålen ligger ${lake.km.toFixed(1)} km från sjön`);
    if (lake.error) flags.push(lake.error);
    const move = best && moveKm > 0.3 && moveKm <= 40;
    report[i] = {
      name: s.name, website: site, pages: pages.length,
      data: { address: s.address || '', phone: s.phone || '', email: s.email || '' },
      found: { addresses: [...found.addresses], phones: [...found.phones], emails: [...found.emails] },
      pin: [s.lat, s.lng], best: best && { ...best, page: found.mapPage }, moveKm, lakeKm: lake.km ?? null, move, flags,
    };
    console.log(`${move ? `FLYTTA ${moveKm.toFixed(1)} km`.padEnd(16) : ''.padEnd(16)}${s.name}${flags.length ? `  [${flags.join('; ')}]` : ''}`);
  }
}));

writeFileSync('audit-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.filter((r) => r.move).length} nålar att flytta, ${report.filter((r) => r.flags.length).length} ställen flaggade. Rapport: audit-report.json`);

if (applyPins) {
  for (const r of report.filter((x) => x.move)) {
    const s = spots.find((x) => x.name === r.name);
    s.lat = Number(r.best.lat.toFixed(5));
    s.lng = Number(r.best.lng.toFixed(5));
  }
  writeFileSync(file, `${JSON.stringify(spots, null, 2)}\n`);
  console.log(`Nålar flyttade i ${file}.`);
}
