// Gör ett inloggat konto till admin: node scripts/make-admin.mjs <e-post>
// Kontot måste ha loggat in på sidan minst en gång.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const email = process.argv[2];
if (!email) {
  console.error('Användning: node scripts/make-admin.mjs <e-post>');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccount.json', 'utf8'))) });
const { uid } = await getAuth().getUserByEmail(email);
await getFirestore().doc(`admins/${uid}`).set({ email });
console.log(`${email} är nu admin.`);
