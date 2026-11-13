// Fyller i saknade koordinater i en JSON-fil via OpenStreetMaps Nominatim.
//   node scripts/geocode.mjs [fil.json]
// Deras villkor tillåter högst ett anrop per sekund, därav pausen.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'data/spots.json';
const spots = JSON.parse(readFileSync(file, 'utf8'));

// Bara träffar i rätt län godtas, så att ett likadant namn på annat håll inte ger fel plats.
async function find(q, county) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=se&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'spot-geocoder/1.0' } });
  await new Promise((ok) => setTimeout(ok, 1100));
  const hit = (res.ok ? await res.json() : []).find((h) => h.display_name.includes(county));
  return hit ? { lat: Number(Number(hit.lat).toFixed(5)), lng: Number(Number(hit.lon).toFixed(5)) } : null;
}

for (const s of spots.filter((x) => x.lat == null || x.lng == null)) {
  // Från mest till minst exakt: anläggningen, sjön, orten.
  // Sjö + län används inte: stora sjöar ger en punkt mitt i vattnet och vanliga sjönamn ger fel sjö.
  const tries = [`${s.name}, ${s.place}`, s.name, `${s.lake}, ${s.place}`, `${s.place}, ${s.county}`];
  let hit = null;
  let used = '';
  for (used of tries) if ((hit = await find(used, s.county))) break;
  if (hit) Object.assign(s, hit);
  console.log(`${hit ? 'ok  ' : 'MISS'} ${s.name} ${hit ? `<- "${used}"` : ''}`);
}

writeFileSync(file, `${JSON.stringify(spots, null, 2)}\n`);
