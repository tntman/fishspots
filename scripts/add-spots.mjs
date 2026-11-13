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
// Engelsk översättning av texterna. Sidan visar den svenska texten när översättningen saknas.
const EN = ['descriptionEn', 'accommodationInfoEn', 'boatInfoEn', 'priceEn', 'fishingLicenseEn'];
const isLink =(v) => v === '' || /^https:\/\/.+/.test(v);

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
  // Valfria fält, samma gränser som i firestore.rules.
  if (s.beds != null && !(Number.isInteger(s.beds) && s.beds >= 1 && s.beds <= 2000)) bad.push(`beds ogiltigt: ${s.beds}`);
  if (s.boatCount != null && !(Number.isInteger(s.boatCount) && s.boatCount >= 1 && s.boatCount <= 500)) bad.push(`boatCount ogiltigt: ${s.boatCount}`);
  if (s.units != null && !(Number.isInteger(s.units) && s.units >= 1 && s.units <= 1000)) bad.push(`units ogiltigt: ${s.units}`);
  for (const k of ['petrolMotor', 'electricMotor', 'licenseRequired', 'boatCountEstimate', 'unitsEstimate', 'bedsEstimate']) if (s[k] != null && typeof s[k] !== 'boolean') bad.push(`${k} är inte true/false`);
  if (s.boatCountEstimate && !s.boatCount) bad.push('boatCountEstimate utan boatCount');
  if (s.unitsEstimate && !s.units) bad.push('unitsEstimate utan units');
  if (s.bedsEstimate && !s.beds) bad.push('bedsEstimate utan beds');
  if (s.fishingLicenseUrl && !/^https:\/\/.+/.test(s.fishingLicenseUrl)) bad.push('fishingLicenseUrl är inte https');
  if (s.address != null && !(typeof s.address === 'string' && s.address.length <= 200)) bad.push('address är inte text på högst 200 tecken');
  for (const k of EN) {
    const max = k === 'descriptionEn' ? 3000 : 1000;
    if (s[k] != null && !(typeof s[k] === 'string' && s[k].length <= max)) bad.push(`${k} är inte text på högst ${max} tecken`);
  }
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
    // Valfria fält skrivs bara när källan anger dem.
    ...Object.fromEntries(['address', 'beds', 'boatCount', 'boatCountEstimate', 'petrolMotor', 'electricMotor', 'licenseRequired', 'fishingLicenseUrl', 'units', 'unitsEstimate', 'bedsEstimate', ...EN]
      .filter((k) => s[k] != null && s[k] !== '').map((k) => [k, typeof s[k] === 'string' ? s[k].trim() : s[k]])),
    ownerUid: null,
    source: 'ai',
    sourceUrl: s.sourceUrl,
    status: 'published',
    updatedAt: FieldValue.serverTimestamp(),
  });
  written += 1;
}
console.log(`${written} ställen skrivna till Firestore.`);
