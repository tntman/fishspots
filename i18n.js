// Svenska är sidans grundspråk. Den svenska texten (i index.html och i t('…') i app.js) är nyckeln,
// och EN ger den engelska texten. {n} och liknande ersätts med värden. Saknas en nyckel visas svenskan.
const EN = {
  // Sidhuvud och sida
  'Fiskespots: sjöar med boende och båt i Sverige': 'Fiskespots: lakes with accommodation and boats in Sweden',
  'Hitta fiskespots vid svenska sjöar där du kan bo och hyra båt. Jämför spots på kartan och planera nästa fiskeresa.':
    'Find fishing spots at Swedish lakes where you can stay and rent a boat. Compare spots on the map and plan your next fishing trip.',
  Konto: 'Account',
  Språk: 'Language',
  'Lägg till din spot': 'Add your spot',
  'Lägg till': 'Add', // knappen i sidhuvudet, där " din spot" döljs på smala skärmar
  'din spot': 'your spot',
  'Logga in': 'Sign in',
  'Logga ut': 'Sign out',
  Visa: 'Show',
  'Alla spots': 'All spots',
  Sparade: 'Saved',
  'Mina spots': 'My spots',
  Granska: 'Review',
  'Sök på namn, sjö eller ort': 'Search by name, lake or town',
  'Valda filter': 'Selected filters',
  Sortera: 'Sort',
  'Namn A–Ö': 'Name A–Z',
  'Närmast mig': 'Nearest me',
  'Norr till söder': 'North to south',
  'Flest sängplatser': 'Most beds',
  'Flest båtar': 'Most boats',
  'Karta över fiskespots': 'Map of fishing spots',
  'Visa karta': 'Show map',
  'Visa lista': 'Show list',
  'Uppgifterna kan vara inaktuella. Kontrollera alltid pris och tillgång med anläggningen.':
    'Details may be out of date. Always check prices and availability with the business.',
  'När du loggar in sparas ditt Google-konto-id och din e-postadress, så att dina spots kan kopplas till dig. Kartan kommer från OpenStreetMap. Adressförslag i formuläret hämtas från Photon (komoot), som då får se det du skriver i adressfältet.':
    'When you sign in, your Google account ID and email address are stored so that your spots can be linked to you. The map comes from OpenStreetMap. Address suggestions in the form come from Photon (komoot), which then sees what you type in the address field.',

  // Filter
  'Stäng filter': 'Close filters',
  Boende: 'Accommodation',
  'Har boende': 'Has accommodation',
  'Minst antal sängplatser': 'Minimum number of beds',
  'Färre sängplatser': 'Fewer beds',
  'Fler sängplatser': 'More beds',
  Båtar: 'Boats',
  Båt: 'Boat',
  'Har båt': 'Has boats',
  Bensinmotor: 'Petrol motor',
  Elmotor: 'Electric motor',
  'Minst antal båtar': 'Minimum number of boats',
  'Färre båtar': 'Fewer boats',
  'Fler båtar': 'More boats',
  Fiskarter: 'Fish species',
  'Visar spots där alla valda arter finns.': 'Shows spots where all selected species are found.',
  Län: 'County',
  Övrigt: 'Other',
  'Bekräftat av ägaren': 'Confirmed by the owner',
  'Rensa alla': 'Clear all',
  'Visa {x}': 'Show {x}',
  'Inga spots matchar': 'No matching spots',
  'Minst {n} sängplatser': 'At least {n} beds',
  'Minst {n} bostäder': 'At least {n} units',
  'Minst {n} bostad': 'At least {n} unit',
  'Minst antal bostäder': 'Minimum number of units',
  'Färre bostäder': 'Fewer units',
  'Fler bostäder': 'More units',
  'Bostäder är stugor, torp, hus, lägenheter och rum.': 'Units are cabins, cottages, houses, apartments and rooms.',
  'Antal bostäder': 'Number of units',
  'Minst {n} båt': 'At least {n} boat',
  'Minst {n} båtar': 'At least {n} boats',
  'Ta bort filtret {x}': 'Remove filter {x}',
  'Filter, {n} valda': 'Filter, {n} selected',

  // Lista
  'Laddar spots…': 'Loading spots…',
  'Kunde inte hämta spots. Ladda om sidan för att försöka igen.': "Couldn't load spots. Reload the page to try again.",
  'Du har inte sparat några spots än. Tryck på stjärnan vid en spot för att spara den.':
    "You haven't saved any spots yet. Tap the star next to a spot to save it.",
  'Du har inte lagt till någon spot än.': "You haven't added a spot yet.",
  'Inga spots väntar på granskning.': 'No spots are awaiting review.',
  'Inga spots matchar. Ta bort ett filter eller rensa alla.': 'No spots match. Remove a filter or clear all.',
  'Här finns inga spots än.': 'There are no spots here yet.',
  'Förhandsvisning utan databas. Inga spots är inlästa än.': 'Preview without a database. No spots are loaded yet.',
  '{n} sängplatser': '{n} beds',
  '{n} sängplats': '{n} bed',
  'minst {n} sängplatser': 'at least {n} beds',
  'minst {n} sängplats': 'at least {n} bed',
  '{n} bostäder': '{n} units',
  '{n} bostad': '{n} unit',
  'minst {n} bostäder': 'at least {n} units',
  'minst {n} bostad': 'at least {n} unit',
  '{n} båt': '{n} boat',
  '{n} båtar': '{n} boats',
  'minst {n} båt': 'at least {n} boat',
  'minst {n} båtar': 'at least {n} boats',
  '{d} km bort': '{d} km away',
  'Väntar på granskning': 'Awaiting review',
  'Sköts av ägaren': 'Managed by the owner',
  'Inte bekräftat av ägaren': 'Not confirmed by the owner',
  'Vill ta över en spot': 'Requests to take over a spot',
  Godkänn: 'Approve',
  Avslå: 'Decline',
  'Spoten har fått en ägare.': 'The spot now has an owner.',
  'Förfrågan avslogs.': 'The request was declined.',

  // Sparade
  Spara: 'Save',
  Sparad: 'Saved',
  'Spara spoten': 'Save this spot',
  'Spara {name}': 'Save {name}',
  'Ta bort {name} från sparade': 'Remove {name} from saved',
  'Sparad. Klicka för att ta bort.': 'Saved. Click to remove.',
  'Det gick inte att spara. Försök igen.': "Couldn't save. Please try again.",

  // Detaljvy
  'Öppna i Google Maps': 'Open in Google Maps',
  'Öppna i Google Maps (ny flik)': 'Open in Google Maps (new tab)',
  Arter: 'Species',
  Pris: 'Price',
  Fiskekort: 'Fishing license',
  Kontakt: 'Contact',
  Ja: 'Yes',
  'Erbjuds inte': 'Not offered',
  'Hyrs inte ut': 'No boat rental',
  bensinmotor: 'petrol motor',
  elmotor: 'electric motor',
  ' och ': ' and ',
  'Fiskekort krävs': 'Fishing license required',
  'Köp fiskekort': 'Buy a fishing license',
  'Visa källan': 'View source',
  'Uppgifterna är insamlade automatiskt och inte bekräftade av ägaren.':
    'These details were collected automatically and have not been confirmed by the owner.',
  'Uppgifterna är insamlade automatiskt {date} och inte bekräftade av ägaren.':
    'These details were collected automatically on {date} and have not been confirmed by the owner.',
  'Godkänn och publicera': 'Approve and publish',
  Ändra: 'Edit',
  'Ta bort': 'Delete',
  'Är det här din spot?': 'Is this your spot?',
  'Spoten är publicerad.': 'The spot is published.',
  'Ta bort {name}? Det går inte att ångra.': 'Delete {name}? This cannot be undone.',
  'Spoten är borttagen.': 'The spot has been deleted.',

  // Formulär
  'Ändra spot': 'Edit spot',
  'Spoten visas publikt när den har granskats.': 'Your spot will be shown publicly once it has been reviewed.',
  'Om spoten': 'About the spot',
  Adress: 'Address',
  'Börja skriva så kommer förslag. Väljer du ett förslag placeras spoten på kartan.':
    'Start typing to get suggestions. Choosing a suggestion places the spot on the map.',
  'Anläggningens namn': 'Name of the business',
  Sjö: 'Lake',
  'Närmaste ort': 'Nearest town',
  'Välj län': 'Choose county',
  'Information om spoten': 'Information about the spot',
  Läge: 'Location',
  'Klicka på kartan där spoten ligger, eller skriv in koordinaterna.': 'Click the map where the spot is, or enter the coordinates.',
  Latitud: 'Latitude',
  Longitud: 'Longitude',
  'Vi erbjuder boende': 'We offer accommodation',
  'Antal sängplatser': 'Number of beds',
  Boendeinformation: 'Accommodation information',
  'Vi hyr ut båt eller båt ingår': 'We rent out boats, or a boat is included',
  'Antal båtar': 'Number of boats',
  Båtinformation: 'Boat information',
  'Länk där man köper fiskekort': 'Link to buy a fishing license',
  't.ex. ifiske.se': 'e.g. ifiske.se',
  Fiskekortsinformation: 'Fishing license information',
  'Arter i sjön': 'Species in the lake',
  Prisinformation: 'Price information',
  Webbplats: 'Website',
  't.ex. dittstalle.se': 'e.g. yourplace.se',
  Telefon: 'Phone',
  'E-post': 'Email',
  Bild: 'Image',
  'Förhandsvisning av bilden': 'Image preview',
  'JPG, PNG eller WebP, högst 15 MB och minst 800 × 500 pixlar. Bilden förminskas automatiskt.':
    'JPG, PNG or WebP, at most 15 MB and at least 800 × 500 pixels. The image is resized automatically.',
  'Ta bort bilden': 'Remove image',
  Avbryt: 'Cancel',
  'Skriv en webbadress, till exempel fiske.se': 'Enter a web address, for example fiske.se',
  'Välj en bild i formatet JPG, PNG eller WebP.': 'Choose a JPG, PNG or WebP image.',
  'Bilden är större än 15 MB. Välj en mindre bild.': 'The image is larger than 15 MB. Choose a smaller image.',
  'Bilden gick inte att läsa. Prova en annan bild.': "The image couldn't be read. Try another image.",
  'Bilden är {w} × {h} pixlar. Den behöver vara minst 800 × 500.': 'The image is {w} × {h} pixels. It needs to be at least 800 × 500.',
  'Bilden gick inte att göra tillräckligt liten. Prova en annan bild.': "The image couldn't be made small enough. Try another image.",
  'Ändringarna är sparade.': 'Your changes have been saved.',
  'Tack! Spoten visas publikt när den har granskats.': 'Thank you! Your spot will be shown publicly once it has been reviewed.',

  // Anspråk
  'Berätta hur du hör ihop med': 'Tell us how you are connected to',
  '. När vi har godkänt kan du uppdatera uppgifterna själv.': '. Once we have approved it, you can update the details yourself.',
  Meddelande: 'Message',
  'Till exempel din roll och en e-postadress eller ett telefonnummer som står på er webbplats.':
    'For example your role, and an email address or phone number listed on your website.',
  Skicka: 'Send',
  'Tack! Vi hör av oss när förfrågan är granskad.': "Thank you! We'll get back to you once the request has been reviewed.",
  'Du har redan skickat en förfrågan för den här spoten.': 'You have already sent a request for this spot.',

  // Fel och position
  'Du har inte behörighet att göra det.': "You don't have permission to do that.",
  'Något gick fel. Försök igen.': 'Something went wrong. Please try again.',
  'Webbläsaren blockerade inloggningsfönstret. Tillåt popup-fönster för sidan och försök igen.':
    'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'Inloggningen misslyckades ({code}). Försök igen.': 'Sign-in failed ({code}). Please try again.',
  'okänt fel': 'unknown error',
  'Webbläsaren kan inte ta reda på din position.': "Your browser can't determine your location.",
  'Du har inte gett sidan tillgång till din position. Tillåt det i webbläsaren och försök igen.':
    "You haven't given the site access to your location. Allow it in your browser and try again.",
  'Det gick inte att ta reda på din position. Försök igen.': "Couldn't determine your location. Please try again.",
};

const SPECIES_EN = {
  gädda: 'Pike', abborre: 'Perch', gös: 'Zander', öring: 'Brown trout',
  röding: 'Arctic char', harr: 'Grayling', lax: 'Salmon', regnbåge: 'Rainbow trout',
};

// Valt språk sparas i webbläsaren. Första gången: svenska om webbläsaren är på svenska, annars engelska.
let saved = null;
try { saved = localStorage.getItem('lang'); } catch { /* blockerad lagring */ }
export let lang = saved === 'sv' || saved === 'en' ? saved : /^sv\b/i.test(navigator.language || '') ? 'sv' : 'en';

export const t = (sv, vars = {}) =>
  ((lang === 'en' && EN[sv]) || sv).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
export const countyName = (c) => (lang === 'en' && c ? `${c.replace(/s? län$/, '')} County` : c);
export const speciesName = (x) => (lang === 'en' ? SPECIES_EN[x] || x : x[0].toUpperCase() + x.slice(1));

// Sidans fasta texter (textnoder och attribut i index.html och dess mallar) och hur de byts.
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'content'];
const statics = [];
function collect(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.currentNode; n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const key = n.data.trim();
      const sv = n.data;
      if (EN[key]) statics.push((l) => { n.data = l === 'en' ? sv.replace(key, EN[key]) : sv; });
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      for (const a of ATTRS) {
        const sv = n.getAttribute(a);
        if (sv && EN[sv]) statics.push((l) => n.setAttribute(a, l === 'en' ? EN[sv] : sv));
      }
      if (n.tagName === 'TEMPLATE') collect(n.content);
    }
  }
}
collect(document.documentElement);

export function setLang(l, remember = true) {
  lang = l;
  if (remember) try { localStorage.setItem('lang', l); } catch { /* blockerad lagring */ }
  document.documentElement.lang = l;
  for (const apply of statics) apply(l);
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', btn.dataset.lang === l);
}
setLang(lang, false);
