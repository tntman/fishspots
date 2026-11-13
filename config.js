// Delas av sidan (app.js) och skripten i scripts/.

// Publik web-config från Firebase-konsolen. Den är ingen hemlighet: åtkomsten
// styrs av firestore.rules. Tom apiKey = sidan visar data/spots.json skrivskyddat.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

export const COUNTIES = [
  'Blekinge län', 'Dalarnas län', 'Gotlands län', 'Gävleborgs län', 'Hallands län',
  'Jämtlands län', 'Jönköpings län', 'Kalmar län', 'Kronobergs län', 'Norrbottens län',
  'Skåne län', 'Stockholms län', 'Södermanlands län', 'Uppsala län', 'Värmlands län',
  'Västerbottens län', 'Västernorrlands län', 'Västmanlands län', 'Västra Götalands län',
  'Örebro län', 'Östergötlands län',
];

export const SPECIES = ['gädda', 'abborre', 'gös', 'öring', 'röding', 'harr', 'lax', 'regnbåge'];

// Dokument-id för AI-tillagda ställen: samma namn + sjö ger samma id, så en ny import uppdaterar.
export const slug = (text) =>
  text.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
