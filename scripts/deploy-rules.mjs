// Lägger ut firestore.rules via Admin SDK: node scripts/deploy-rules.mjs
// Används i stället för firebase-tools, som kräver fler behörigheter än tjänstkontot har.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccount.json', 'utf8'))) });
const ruleset = await getSecurityRules().releaseFirestoreRulesetFromSource(readFileSync('firestore.rules', 'utf8'));
console.log(`Regler utlagda: ${ruleset.name}`);
