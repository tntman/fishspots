// Går igenom varje ställes egen webbplats och jämför med datafilen.
//   node scripts/audit-spots.mjs [fil.json]              rapport till audit-report.json
//   node scripts/audit-spots.mjs [fil.json] --apply-pins flyttar nålar som har en säker källa
// Läser bara sidor på ställets egen domän (startsidan och undersidor som kontakt, hitta hit, boende, priser, fiske).
// Hittar: adresser med postnummer, telefonnummer, e-post och kartpositioner (Google Maps-länkar/inbäddade kartor).
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const applyPins = args.includes('--apply-pins');
// --no-geo: läs bara webbplatserna (inga uppslag mot Photon/Overpass, t.ex. när de nekar för många anrop).
const noGeo = args.includes('--no-geo');
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
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12000) });
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
    // Telefonnummer ("0589-401 10") och org.nr ser ut som postnummer; de har siffror direkt före.
    if (/tel|telefon|ring|org\.?nr|bankgiro|fax|\d[\s-]*$/i.test(before)) continue;
    out.add(`${before ? `${before}, ` : ''}${m[2]} ${m[3]} ${m[4]}`.replace(/\s+/g, ' ').trim());
  }
  return [...out];
}

const phones = (html, t) => [...new Set([
  ...[...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1])),
  ...[...t.matchAll(/(?:\+46|\b0)[\s-]?\(?0?\)?\d{1,3}[\s–-]?\d{2,3}[\s–-]?\d{2}[\s–-]?\d{2,3}\b/g)].map((m) => m[0]),
].map((p) => p.replace(/[^\d+]/g, '').replace(/^0/, '+46').replace(/^\+460/, '+46')).filter((p) => p.length >= 10 && p.length <= 13))];

const emails = (html) => [...new Set([...html.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi)].map((m) => m[0].toLowerCase()))]
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
  // Undersidorna hämtas samtidigt; en sida i taget tog ungefär en timme för 148 spots.
  const rest = await Promise.all([...new Set(links)].slice(0, MAX_PAGES - 1).map(get));
  return [...pages, ...rest.filter((p) => p && host(p.url) === own)];
}

// Photon (OpenStreetMap-data) i en kö med paus mellan anropen, även när flera ställen kontrolleras samtidigt.
// Nominatim används inte här: dess gräns på ett anrop per sekund räcker inte för 148 ställen.
let chain = Promise.resolve();
function photon(params) {
  const run = chain.then(async () => {
    await new Promise((ok) => setTimeout(ok, 400));
    const url = `https://photon.komoot.io/api/?lang=default&limit=10&bbox=10.5,55,24.5,69.5&${new URLSearchParams(params)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'spot-audit/1.0' }, signal: AbortSignal.timeout(20000) });
        if (res.ok) return (await res.json()).features.filter((f) => f.properties.countrycode === 'SE');
        if (res.status !== 429 && res.status < 500) return null;
      } catch { /* försök igen */ }
      await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1)));
    }
    return null;
  });
  chain = run.catch(() => {});
  return run;
}

// Finns ett vatten med sjöns namn inom 3 km från punkten? Frågas mot OpenStreetMap via Overpass,
// som har även de stora sjöarna. true/false, eller null om tjänsten inte svarade.
let overpassChain = Promise.resolve();
function lakeNear(lakeName, p, radius = 3000) {
  const name = lakeName.replace(/\s*\(.*\)$/, '').split(/,| m\.fl\./)[0].trim().replace(/"/g, '');
  const q = `[out:json][timeout:25];(nwr["natural"="water"]["name"~"^${name}$",i](around:${radius},${p.lat},${p.lng});`
    + `nwr["water"]["name"~"^${name}$",i](around:${radius},${p.lat},${p.lng}););out ids 1;`;
  const run = overpassChain.then(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1)));
      try {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'User-Agent': 'spot-audit/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(q)}`,
          signal: AbortSignal.timeout(40000),
        });
        if (res.ok) return (await res.json()).elements.length > 0;
      } catch { /* försök igen */ }
    }
    return null;
  });
  overpassChain = run.catch(() => {});
  return run;
}

// Bara exakta adressträffar med rätt postnummer används för att flytta en nål.
async function addressCoords(address, county) {
  const postcode = address.match(/\b(\d{3})\s?(\d{2})\b/);
  const hits = await photon({ q: address });
  // Photon kallar både adresser och namngivna platser (camping, gård) för "house".
  const hit = (hits || []).find((f) => f.properties.type === 'house'
    && (f.properties.county === county || f.properties.state === county)
    && (!postcode || (f.properties.postcode || '').replace(/\s/g, '') === postcode[1] + postcode[2]));
  if (!hit) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, kind: 'adress (husnummer)' };
}

const norm = (p) => (p || '').replace(/[^\d+]/g, '').replace(/^0/, '+46');
const report = [];
const queue = [...spots.entries()];
await Promise.all(Array.from({ length: 12 }, async () => {
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
    const addrPos = !noGeo && !found.map && s.address ? await addressCoords(s.address, s.county) : null;
    const candidate = found.map || addrPos;
    const pinAtLake = noGeo ? null : await lakeNear(s.lake, pin);
    const candidateAtLake = noGeo ? null
      : candidate && km(pin, candidate) > 0.3 ? await lakeNear(s.lake, candidate) : pinAtLake;
    // En ny position godtas bara om den också ligger vid sjön (eller om sjön inte går att kontrollera alls).
    const best = candidate && (candidateAtLake !== false || (pinAtLake === false && found.map)) ? candidate : null;
    const moveKm = best ? km(pin, best) : null;
    const flags = [];
    if (candidate && !best) flags.push(`${candidate.kind} pekar ${km(pin, candidate).toFixed(1)} km bort, men inte vid ${s.lake}`);
    if (best && candidateAtLake === false) flags.push(`kartlänken på egen sida ligger inte vid ${s.lake}, kontrollera för hand`);
    if (!pages.length) flags.push('webbplatsen gick inte att läsa');
    if (!s.address && found.addresses.size) flags.push('adress finns på sidan men saknas');
    if (!s.phone && found.phones.size) flags.push('telefon finns på sidan men saknas');
    if (!s.email && found.emails.size) flags.push('e-post finns på sidan men saknas');
    if (s.phone && found.phones.size && ![...found.phones].includes(norm(s.phone))) flags.push('telefonen skiljer sig från sidan');
    if (best && moveKm > 40) flags.push(`kartkällan ligger ${moveKm.toFixed(0)} km bort, kontrollera för hand`);
    if (pinAtLake === false && !best) flags.push(`nålen ligger inte inom 3 km från ${s.lake}`);
    if (pinAtLake == null && !noGeo) flags.push('sjön gick inte att kontrollera');
    // Utan sjökontroll flyttas inget automatiskt; förslagen granskas i rapporten.
    const move = !noGeo && Boolean(best) && moveKm > 0.3 && moveKm <= 40 && candidateAtLake !== false;
    const suggest = Boolean(best) && moveKm > 0.3;
    report[i] = {
      name: s.name, website: site, pages: pages.length,
      data: { address: s.address || '', phone: s.phone || '', email: s.email || '' },
      found: { addresses: [...found.addresses], phones: [...found.phones], emails: [...found.emails] },
      pin: [s.lat, s.lng], best: best && { ...best, page: found.mapPage }, moveKm, pinAtLake, candidateAtLake, move, suggest, flags,
    };
    const tag = move ? `FLYTTA ${moveKm.toFixed(1)} km` : suggest ? `FÖRSLAG ${moveKm.toFixed(1)} km` : '';
    console.log(`${tag.padEnd(18)}${s.name}${flags.length ? `  [${flags.join('; ')}]` : ''}`);
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
