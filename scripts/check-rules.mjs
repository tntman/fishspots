// Kontrollerar de publicerade säkerhetsreglerna utan inloggning: node scripts/check-rules.mjs
// Publicerade ställen ska gå att läsa. Allt annat ska nekas.
import { firebaseConfig } from '../config.js';

const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const status = { stringValue: 'published' };

const checks = [
  ['läsa publicerade ställen', 200, () => post(':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'spots' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: status } },
      limit: 1,
    },
  })],
  ['läsa alla ställen, även väntande', 403, () => fetch(`${base}/spots?pageSize=1`)],
  ['skapa ställe utan inloggning', 403, () => post('/spots', { fields: { name: { stringValue: 'x' }, status } })],
  ['läsa anspråk', 403, () => fetch(`${base}/claims?pageSize=1`)],
  ['läsa adminlistan', 403, () => fetch(`${base}/admins?pageSize=1`)],
  ['läsa andras sparade spots', 403, () => fetch(`${base}/favorites?pageSize=1`)],
  ['skapa sparade spots utan inloggning', 403, () => post('/favorites', { fields: { ids: { arrayValue: {} } } })],
  ['göra sig själv till admin', 403, () => post('/admins', { fields: { email: { stringValue: 'x' } } })],
];

let failed = 0;
for (const [name, want, run] of checks) {
  const got = (await run()).status;
  if (got !== want) failed += 1;
  console.log(`${got === want ? 'ok  ' : 'FEL '} ${name}: ${got} (väntat ${want})`);
}
process.exit(failed ? 1 : 0);
