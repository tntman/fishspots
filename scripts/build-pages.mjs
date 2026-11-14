// Skriver en vanlig HTML-sida per publicerad spot (spot/<id>/), en lista över alla (spot/) och sitemap.xml,
// så att sökmotorer hittar varje spot. Appens adresser (#/<id>) indexeras dåligt.
//   node scripts/build-pages.mjs     (kör efter add-spots.mjs, och när ägare har ändrat sina spots)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BASE = 'https://tntman.github.io/fishspots/';

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccount.json', 'utf8'))) });
const snap = await getFirestore().collection('spots').where('status', '==', 'published').get();
const spots = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => a.county.localeCompare(b.county, 'sv') || a.name.localeCompare(b.name, 'sv'));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const https = (u) => (/^https:\/\/.+/.test(u || '') ? u : '');
const num = (v) => v.toLocaleString('sv-SE', { maximumFractionDigits: v < 1 ? 2 : 1 });
const plural = (n, one, many, est) => `${est ? 'minst ' : ''}${n} ${n === 1 ? one : many}`;
const where = (s) => [s.lake, [s.place, s.county].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
const date = (s) => s.updatedAt?.toDate?.().toISOString().slice(0, 10);

function facts(s) {
  const motors = [s.petrolMotor && 'bensinmotor', s.electricMotor && 'elmotor'].filter(Boolean).join(' och ');
  const lake = [s.lakeArea && `${num(s.lakeArea)} km²`, s.lakeDepth && `största djup ${num(s.lakeDepth)} m`,
    s.lakeElevation != null && `${num(s.lakeElevation)} m över havet`].filter(Boolean).join(' · ');
  const web = https(s.website);
  const rows = [
    ['Boende', s.hasAccommodation
      ? [[s.units && plural(s.units, 'bostad', 'bostäder', s.unitsEstimate), s.beds && plural(s.beds, 'sängplats', 'sängplatser', s.bedsEstimate)].filter(Boolean).join(' · '), s.accommodationInfo].filter(Boolean).map(esc).join('<br>') || 'Ja'
      : 'Erbjuds inte'],
    ['Båtar', s.hasBoats
      ? [s.boatCount && plural(s.boatCount, 'båt', 'båtar', s.boatCountEstimate), motors && motors[0].toUpperCase() + motors.slice(1), s.boatInfo].filter(Boolean).map(esc).join('<br>') || 'Ja'
      : 'Hyrs inte ut'],
    ['Sjön', lake && `${esc(s.lakeName)}: ${esc(lake)} <a href="https://www.wikidata.org/wiki/${esc(s.lakeWikidata)}" rel="noopener">Källa: Wikidata</a>`],
    ['Arter', esc((s.species || []).map((x) => x[0].toUpperCase() + x.slice(1)).join(', '))],
    ['Pris', esc(s.price)],
    ['Fiskekort', [s.licenseRequired && 'Fiskekort krävs', s.fishingLicense].filter(Boolean).map(esc).join('<br>')
      + (https(s.fishingLicenseUrl) ? ` <a href="${esc(s.fishingLicenseUrl)}" rel="noopener nofollow">Köp fiskekort</a>` : '')],
    ['Kontakt', [s.address && esc(s.address),
      web && `<a href="${esc(web)}" rel="noopener nofollow">${esc(new URL(web).hostname.replace(/^www\./, ''))}</a>`,
      s.phone && `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>`,
      s.email && `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`].filter(Boolean).join('<br>')],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n      ');
}

// Strukturerad data för sökmotorer (schema.org).
function jsonLd(s) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': s.hasAccommodation ? 'LodgingBusiness' : 'LocalBusiness',
    name: s.name,
    description: s.description || undefined,
    url: https(s.website) || undefined,
    telephone: s.phone || undefined,
    address: { '@type': 'PostalAddress', streetAddress: s.address || undefined, addressLocality: s.place || undefined, addressRegion: s.county, addressCountry: 'SE' },
    geo: Number.isFinite(s.lat) ? { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng } : undefined,
  }).replace(/</g, '\\u003c');
}

const STYLE = `:root{--ink:#0f2a30;--ink-2:#47606a;--ground:#eef3f2;--line:#d3dedc;--lake:#0c4a57;--lake-deep:#0b3d47;--bob:#dd3b1f;font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--ground);font-size:.9375rem;line-height:1.55}
a{color:var(--lake);text-underline-offset:.18em}
.top{padding:.625rem 1.25rem;background:var(--lake-deep)}.top img{display:block}
main{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
h1{margin:.25rem 0 0;font-size:1.9rem;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
h2{margin:2rem 0 .5rem;font-size:1.1rem}
.where{margin:.35rem 0 0;color:var(--ink-2);font-size:1rem}
.map{display:inline-block;margin:1.25rem 0;padding:.55rem 1.1rem;border-radius:999px;background:var(--bob);color:#fff;font-weight:600;text-decoration:none}
dl{margin:1.5rem 0 0;border-top:1px solid var(--line)}dl div{display:grid;grid-template-columns:7.5rem 1fr;gap:1rem;padding:.75rem 0;border-bottom:1px solid var(--line)}
dt{font-weight:600}dd{margin:0}
.source{margin-top:1.5rem;color:var(--ink-2);font-size:.85rem}
ul{padding-left:1.1rem}li{margin:.2rem 0}
@media (max-width:30rem){dl div{grid-template-columns:1fr;gap:.15rem}}`;

const page = ({ title, description, path, body, ld = '' }) => `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${BASE}${path}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${BASE}${path}">
  <meta property="og:locale" content="sv_SE">
  ${ld && `<script type="application/ld+json">${ld}</script>`}
  <style>${STYLE}</style>
</head>
<body>
<header class="top"><a href="${BASE}"><img src="${BASE}img/logo.png" alt="Fiskespots" width="154" height="40"></a></header>
<main>
${body}
</main>
</body>
</html>
`;

const short = (t, n = 155) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);

rmSync('spot', { recursive: true, force: true });
for (const s of spots) {
  const extras = [s.hasAccommodation && 'boende', s.hasBoats && 'båtuthyrning'].filter(Boolean).join(' och ');
  const auto = !s.ownerUid && s.source === 'ai';
  mkdirSync(`spot/${s.id}`, { recursive: true });
  writeFileSync(`spot/${s.id}/index.html`, page({
    title: `${s.name}, ${s.lake} – fiske${extras ? ` med ${extras}` : ''} | Fiskespots`,
    description: short(s.description || `${s.name} vid ${s.lake} i ${s.county}.`),
    path: `spot/${s.id}/`,
    ld: jsonLd(s),
    body: `  <p><a href="${BASE}spot/">Alla spots</a></p>
  <h1>${esc(s.name)}</h1>
  <p class="where">${esc(where(s))}</p>
  <a class="map" href="${BASE}#/${encodeURIComponent(s.id)}">Visa på kartan</a>
  <p>${esc(s.description)}</p>
  <dl>
      ${facts(s)}
  </dl>
  ${auto ? `<p class="source">Uppgifterna är insamlade automatiskt${date(s) ? ` ${date(s)}` : ''} och inte bekräftade av ägaren.${https(s.sourceUrl) ? ` <a href="${esc(s.sourceUrl)}" rel="noopener nofollow">Visa källan</a>` : ''}</p>` : ''}`,
  }));
}

// Lista över alla spots per län, så att varje sida går att nå via vanliga länkar.
const byCounty = Map.groupBy(spots, (s) => s.county);
writeFileSync('spot/index.html', page({
  title: 'Alla fiskespots med boende och båt, län för län | Fiskespots',
  description: `${spots.length} fiskespots vid svenska sjöar och älvar, med boende och båtuthyrning. Sorterade län för län.`,
  path: 'spot/',
  body: `  <h1>Alla fiskespots</h1>
  <p class="where">${spots.length} spots vid svenska sjöar och älvar, län för län.</p>
  <a class="map" href="${BASE}">Visa på kartan</a>
${[...byCounty].map(([county, list]) => `  <h2>${esc(county)}</h2>
  <ul>
${list.map((s) => `    <li><a href="${BASE}spot/${s.id}/">${esc(s.name)}</a> · ${esc(s.lake)}</li>`).join('\n')}
  </ul>`).join('\n')}`,
}));

const urls = [['', null], ['spot/', null], ...spots.map((s) => [`spot/${s.id}/`, date(s)])];
writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([p, d]) => `  <url><loc>${BASE}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);
console.log(`${spots.length} spotsidor, spot/index.html och sitemap.xml skrivna.`);
