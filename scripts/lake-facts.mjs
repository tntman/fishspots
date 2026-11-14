// Hämtar fakta om sjön (yta, största djup, höjd över havet) från Wikidata (CC0) till data/spots.json.
//   node scripts/lake-facts.mjs [fil.json]
// Sjön matchas på exakt svenskt namn inom 20 km från spotens position. Älvar och åar hoppas över.
// Bara Wikidatas bästa värden används; finns flera som skiljer sig åt lämnas fältet tomt.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'data/spots.json';
const spots = JSON.parse(readFileSync(file, 'utf8'));
const FIELDS = ['lakeName', 'lakeArea', 'lakeDepth', 'lakeElevation', 'lakeWikidata'];

// "Lelång / Västra Silen", "Åsnen, Tiken, Mien", "Bysjön (Dalälven)" -> namn att prova i tur och ordning.
const candidates = (lake) => lake.replace(/[()]/g, ',').split(/\s*(?:\/|,| och )\s*/)
  .map((n) => n.trim()).filter((n) => n && !/(älven|älv|ån)$/i.test(n));

async function sparql(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'fishspots-lake-facts/1.0 (https://github.com/tntman/fishspots)' },
    });
    if (res.ok) return (await res.json()).results.bindings;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error('Wikidata svarar inte');
}

// Normaliserade värden (SI-enheter) bland de bästa påståendena.
const best = (prop, v) => `OPTIONAL { ?item p:${prop} ?s${v}. ?s${v} a wikibase:BestRank; psn:${prop}/wikibase:quantityAmount ?${v}. }`;

// Talet i den svenska Wikipedia-artikelns inledning, t.ex. "har en yta på 52,9 kvadratkilometer".
async function wikiNumbers(title) {
  if (!title) return {};
  const url = `https://sv.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fishspots-lake-facts/1.0 (https://github.com/tntman/fishspots)' } });
  if (!res.ok) return {};
  const text = Object.values((await res.json()).query.pages)[0]?.extract || '';
  const num = (re) => { const m = text.match(re); return m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : null; };
  return {
    area: num(/yta på (?:ungefär |cirka |omkring |drygt |knappt )?([\d\s ]+(?:,\d+)?) kvadratkilometer/),
    depth: num(/(\d+(?:,\d+)?) meter (?:djup|på sitt djupaste)/),
  };
}
// Skiljer sig Wikidata och artikeln mer än 20 % är något fel, och värdet visas inte.
const agrees = (a, b) => a == null || b == null || Math.abs(a - b) <= 0.2 * Math.max(a, b);

async function find(name, s) {
  const rows = await sparql(`SELECT ?item ?dist ?area ?depth ?elev ?title WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?loc. bd:serviceParam wikibase:center "Point(${s.lng} ${s.lat})"^^geo:wktLiteral; wikibase:radius "20"; wikibase:distance ?dist. }
    ?item rdfs:label ${JSON.stringify(name)}@sv; wdt:P31/wdt:P279* wd:Q23397.
    ${best('P2046', 'area')} ${best('P4511', 'depth')} ${best('P2044', 'elev')}
    OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://sv.wikipedia.org/>; schema:name ?title. }
  }`);
  if (!rows.length) return null;
  const items = Map.groupBy(rows, (r) => r.item.value);
  const [id, rs] = [...items].sort((a, b) => a[1][0].dist.value - b[1][0].dist.value)[0];
  // Ett värde används bara om alla bästa värden är (nästan) samma.
  const one = (k) => {
    const vs = [...new Set(rs.map((r) => r[k] && Number(r[k].value)).filter((v) => v != null))];
    return vs.length && Math.max(...vs) <= Math.min(...vs) * 1.05 ? vs[0] : null;
  };
  const area = one('area') && Math.round(one('area') / 1e4) / 100; // m² -> km², två decimaler
  const depth = one('depth') && Math.round(one('depth') * 10) / 10;
  const wiki = await wikiNumbers(rs[0].title?.value);
  return {
    lakeName: name,
    lakeArea: agrees(area, wiki.area) ? area : null,
    lakeDepth: agrees(depth, wiki.depth) ? depth : null,
    lakeElevation: one('elev') != null ? Math.round(one('elev')) : null,
    lakeWikidata: id.split('/').pop(),
  };
}

let found = 0;
for (const s of spots) {
  for (const k of FIELDS) delete s[k];
  for (const name of candidates(s.lake)) {
    const f = await find(name, s);
    if (!f || (f.lakeArea == null && f.lakeDepth == null && f.lakeElevation == null)) continue;
    for (const [k, v] of Object.entries(f)) if (v != null && v !== 0) s[k] = v;
    found += 1;
    break;
  }
  process.stdout.write(s.lakeWikidata ? '+' : '.');
}
writeFileSync(file, `${JSON.stringify(spots, null, 2)}\n`);
console.log(`\n${found} av ${spots.length} spots fick fakta om sjön.`);
