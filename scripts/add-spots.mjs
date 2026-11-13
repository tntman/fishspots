// Importerar AI-insamlade ställen till Firestore.
//   node scripts/add-spots.mjs [fil.json]          skriver till databasen
//   node scripts/add-spots.mjs --check [fil.json]  kontrollerar bara filen
// Admin-SDK:n går förbi firestore.rules, så kontrollen nedan är den enda spärren för AI-data.
import { readFileSync } from 'node:fs';
import { COUNTIES, SPECIES, slug } from '../config.js';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const file = args.find((a) => !a.startsWith('--')) ?? 'data/spots.json';
const spots = JSON.parse(readFileSync(file, 'utf8'));

const TEXT = ['place', 'description', 'accommodationInfo', 'boatInfo', 'price',
  'fishingLicense', 'website', 'phone', 'email', 'imageUrl'];
const isLink = (v) => v === '' || /^https:\/\/.+/.test(v);

function check(s) {
  const bad = [];
  if (!s.name?.trim()) bad.push('namn saknas');
  if (!s.lake?.trim()) bad.push('sjö saknas');
  if (!COUNTIES.includes(s.county)) bad.push(`okänt län: ${s.county}`);
  if (!(s.lat >= 55 && s.lat <= 69.5 && s.lng >= 10.5 && s.lng <= 24.5)) bad.push(`koordinater utanför Sverige: ${s.lat}, ${s.lng}`);
  if (!(s.species ?? []).every((x) => SPECIES.includes(x))) bad.push(`okänd art: ${s.species}`);
  if (!/^https:\/\/.+/.test(s.sourceUrl ?? '')) bad.push('källänk (https) saknas');
  for (const k of ['website', 'imageUrl']) if (!isLink(s[k] ?? '')) bad.push(`${k} är inte https`);
  for (const k of TEXT) if (typeof (s[k] ?? '') !== 'string') bad.push(`${k} är inte text`);
  return bad;
}

const ids = spots.map((s) => slug(`${s.name} ${s.lake}`));
const problems = spots.flatMap((s, i) => [
  ...check(s),
  ...(ids.indexOf(ids[i]) !== i ? ['dubblett'] : []),
].map((p) => `${s.name ?? `#${i}`}: ${p}`));

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${spots.length} ställen i ${file} är giltiga.`);
if (checkOnly) process.exit(0);

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccount.json', 'utf8'))) });
const db = getFirestore();

let written = 0;
for (const [i, s] of spots.entries()) {
  const ref = db.doc(`spots/${ids[i]}`);
  // Ett ställe som en verksamhet tagit över rörs aldrig: deras uppgifter gäller.
  if ((await ref.get()).data()?.ownerUid) {
    console.log(`hoppar över (har ägare): ${s.name}`);
    continue;
  }
  await ref.set({
    name: s.name.trim(),
    lake: s.lake.trim(),
    county: s.county,
    lat: s.lat,
    lng: s.lng,
    hasAccommodation: Boolean(s.hasAccommodation),
    hasBoats: Boolean(s.hasBoats),
    species: s.species ?? [],
    ...Object.fromEntries(TEXT.map((k) => [k, (s[k] ?? '').trim()])),
    ownerUid: null,
    source: 'ai',
    sourceUrl: s.sourceUrl,
    status: 'published',
    updatedAt: FieldValue.serverTimestamp(),
  });
  written += 1;
}
console.log(`${written} ställen skrivna till Firestore.`);
