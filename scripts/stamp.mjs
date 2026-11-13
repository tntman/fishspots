// Sätter ?v=<innehållshash> på sidans filer, så att webbläsare hämtar en ny version
// direkt efter en ändring i stället för att använda en sparad kopia (GitHub Pages sparar i 10 min).
//   node scripts/stamp.mjs          (körs av pre-commit-kroken)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

function stamp(file, asset) {
  const text = readFileSync(file, 'utf8');
  const re = new RegExp(`(${asset.replace('.', '\\.')})(\\?v=[0-9a-f]+)?(["'])`, 'g');
  const next = text.replace(re, `$1?v=${hash(asset)}$3`);
  if (next !== text) writeFileSync(file, next);
}

// Ordningen spelar roll: app.js innehåll (och därmed hash) ändras när config.js stämplas.
stamp('app.js', 'config.js');
stamp('app.js', 'i18n.js');
stamp('index.html', 'app.js');
stamp('index.html', 'style.css');
stamp('index.html', 'img/logo.png');
