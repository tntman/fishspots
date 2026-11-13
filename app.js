import { firebaseConfig, COUNTIES, SPECIES, slug } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/13.3.0';
const $ = (sel, root = document) => root.querySelector(sel);
const live = Boolean(firebaseConfig.apiKey);
const state = { spots: new Map(), claims: [], user: null, admin: false, status: 'Laddar ställen…' };

// Firebase laddas bara när config.js är ifylld. Utan den visas data/spots.json skrivskyddat.
let fb = null;
if (live) {
  const [app, auth, store] = await Promise.all(['app', 'auth', 'firestore'].map((m) => import(`${FB}/firebase-${m}.js`)));
  const instance = app.initializeApp(firebaseConfig);
  fb = { ...auth, ...store, auth: auth.getAuth(instance), db: store.getFirestore(instance) };
}

// Textfält i formuläret som alltid sparas (tomma om de inte fylls i).
const TEXT = ['name', 'lake', 'county', 'place', 'description', 'accommodationInfo', 'boatInfo',
  'price', 'fishingLicense', 'website', 'phone', 'email'];
const images = new Map(); // spot-id -> uppladdad bild (data-URL) eller '' om ingen finns
const isJpeg = (v) => typeof v === 'string' && v.startsWith('data:image/jpeg;base64,');
const join = (...parts) => parts.filter(Boolean).join('\n');
const filters = $('#filters');
const form = $('#spot-form');
const claimForm = $('#claim-form');
const appEl = $('.app');
let openId = null;   // stället som visas i detaljvyn
let editing = null;  // id för stället i formuläret, null = nytt

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const https = (u) => (/^https:\/\/.+/.test(u || '') ? u : '');
const mine = (s) => Boolean(state.user) && s.ownerUid === state.user.uid;
const whereText = (s) => [s.lake, [s.place, s.county].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

// ---------- Karta ----------
// ponytail: OSM:s öppna kartserver räcker för låg trafik. Byt till en kartleverantör med avtal om sidan växer.
const tiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});
const pinIcon = L.divIcon({
  className: 'pin',
  iconSize: [28, 40],
  iconAnchor: [14, 35],
  html: '<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true"><ellipse class="ring" cx="14" cy="35" rx="8" ry="2.5"/><g class="float"><path class="stem" d="M14 3v9M14 30v5"/><path class="cap" d="M5 21a9 9 0 0 1 18 0z"/><path class="body" d="M5 21a9 9 0 0 0 18 0z"/></g></svg>',
});
const SWEDEN = [62.6, 16.5];
const map = L.map('map').setView(SWEDEN, 5);
tiles().addTo(map);
const pins = L.layerGroup().addTo(map);
const markers = new Map();
let pinned = '';

function highlight(id) {
  for (const [key, m] of markers) m.getElement()?.classList.toggle('is-active', key === id);
}

// ponytail: alla nålar ritas var för sig. Lägg till klustring om det blir fler än några hundra.
function renderPins(list) {
  pins.clearLayers();
  markers.clear();
  for (const s of list) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    // Namnet sätts som textnod: Leaflet tolkar strängar som HTML.
    const label = Object.assign(document.createElement('span'), { textContent: s.name });
    const m = L.marker([s.lat, s.lng], { icon: pinIcon, title: s.name, alt: s.name })
      .bindTooltip(label, { direction: 'top', offset: [0, -34] })
      .on('click', () => { location.hash = `#/${s.id}`; })
      .addTo(pins);
    markers.set(s.id, m);
  }
  const key = [...markers.keys()].join();
  if (key !== pinned && markers.size && !openId && map.getSize().x) {
    map.fitBounds(L.latLngBounds([...markers.values()].map((m) => m.getLatLng())).pad(0.12), { maxZoom: 10 });
    pinned = key;
  }
  highlight(openId);
}

// ---------- Data ----------
async function load() {
  if (!live) {
    const res = await fetch('data/spots.json');
    const rows = res.ok ? await res.json() : [];
    state.spots = new Map(rows.map((s) => {
      const id = slug(`${s.name} ${s.lake}`);
      return [id, { ...s, id, status: 'published', ownerUid: null, source: 'ai' }];
    }));
    return;
  }
  const { db, collection, query, where, getDocs } = fb;
  const col = collection(db, 'spots');
  // Reglerna kräver att varje fråga själv begränsar sig till det man får läsa.
  const queries = [query(col, where('status', '==', 'published'))];
  if (state.user) queries.push(query(col, where('ownerUid', '==', state.user.uid)));
  if (state.admin) queries.push(query(col, where('status', '==', 'pending')));
  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  state.spots = new Map(snaps.flatMap((s) => s.docs).map((d) => [d.id, { ...d.data(), id: d.id }]));
  state.claims = state.admin
    ? (await getDocs(collection(db, 'claims'))).docs.map((d) => ({ ...d.data(), id: d.id }))
    : [];
}

async function refresh() {
  try {
    await load();
    state.status = '';
  } catch (err) {
    console.error(err);
    state.status = 'Kunde inte hämta ställen. Ladda om sidan för att försöka igen.';
  }
  render();
}

// ---------- Lista ----------
function visible() {
  const f = new FormData(filters);
  const q = f.get('q').trim().toLowerCase();
  const view = f.get('view');
  return [...state.spots.values()]
    .filter((s) => (view === 'mine' ? mine(s) : view === 'review' ? s.status === 'pending' : s.status === 'published'))
    .filter((s) => !q || [s.name, s.lake, s.place, s.county, s.description].join(' ').toLowerCase().includes(q))
    .filter((s) => !f.get('county') || s.county === f.get('county'))
    .filter((s) => !f.get('species') || (s.species || []).includes(f.get('species')))
    .filter((s) => !f.has('acc') || s.hasAccommodation)
    .filter((s) => !f.has('boat') || s.hasBoats)
    .filter((s) => !Number(f.get('beds')) || (s.hasAccommodation && s.beds >= Number(f.get('beds'))))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

function setBadge(el, s, always = false) {
  const [text, kind] = s.status === 'pending' ? ['Väntar på granskning', 'wait']
    : s.ownerUid ? ['Sköts av ägaren', 'ok']
    : always ? ['Inte bekräftat av ägaren', ''] : ['', ''];
  el.textContent = text;
  el.className = `badge ${kind}`;
}

function row(s) {
  const li = $('#row-tpl').content.firstElementChild.cloneNode(true);
  const a = $('a', li);
  a.href = `#/${s.id}`;
  $('.row-name', li).textContent = s.name;
  $('.row-where', li).textContent = whereText(s);
  $('.row-acc', li).hidden = !s.hasAccommodation;
  $('.row-boat', li).hidden = !s.hasBoats;
  $('.row-species', li).textContent = (s.species || []).map(cap).join(', ');
  setBadge($('.badge', li), s);
  a.addEventListener('pointerenter', () => highlight(s.id));
  a.addEventListener('focus', () => highlight(s.id));
  a.addEventListener('pointerleave', () => highlight(openId));
  return li;
}

function renderClaims(show) {
  $('#claims').hidden = !show || !state.claims.length;
  $('#claims-list').replaceChildren(...state.claims.map((c) => {
    const li = $('#claim-tpl').content.firstElementChild.cloneNode(true);
    const link = $('.claim-spot', li);
    link.textContent = state.spots.get(c.spotId)?.name || c.spotId;
    link.href = `#/${c.spotId}`;
    $('.claim-who', li).textContent = c.email;
    $('.claim-msg', li).textContent = c.message;
    $('.claim-yes', li).onclick = () => act(async () => {
      const batch = fb.writeBatch(fb.db);
      batch.update(fb.doc(fb.db, 'spots', c.spotId), { ownerUid: c.uid, updatedAt: fb.serverTimestamp() });
      batch.delete(fb.doc(fb.db, 'claims', c.id));
      await batch.commit();
    }, 'Stället har fått en ägare.');
    $('.claim-no', li).onclick = () => act(() => fb.deleteDoc(fb.doc(fb.db, 'claims', c.id)), 'Förfrågan avslogs.');
    return li;
  }));
}

function render() {
  const list = visible();
  const view = new FormData(filters).get('view');
  const pending = [...state.spots.values()].filter((s) => s.status === 'pending').length + state.claims.length;

  $('#auth-btn').textContent = state.user ? 'Logga ut' : 'Logga in';
  $('#auth-btn').disabled = $('#add-btn').disabled = !live;
  $('#user-name').textContent = state.user?.displayName || state.user?.email || '';
  $('#views').hidden = !state.user;
  $('#view-review').hidden = !state.admin;
  $('#review-count').textContent = pending || '';

  $('#count').textContent = `${list.length} ${list.length === 1 ? 'ställe' : 'ställen'}`;
  $('#list').replaceChildren(...list.map(row));
  $('#list-status').textContent = state.status || (list.length ? ''
    : view === 'mine' ? 'Du har inte lagt till något ställe än.'
    : view === 'review' ? 'Inga ställen väntar på granskning.'
    : state.spots.size ? 'Inga ställen matchar. Prova att rensa filtren.'
    : live ? 'Här finns inga ställen än.' : 'Förhandsvisning utan databas. Inga ställen är inlästa än.');
  renderClaims(view === 'review');
  renderPins(list);
  route();
}

// ---------- Detaljvy (adressen #/<id> går att dela) ----------
function fact(key, text) {
  const div = $(`[data-row=${key}]`);
  div.hidden = !text;
  const target = $('.t', div) || (key !== 'contact' && $('dd', div));
  if (target) target.textContent = text || '';
}

// Uppladdade bilder ligger i en egen samling så att listan inte hämtar dem.
async function showImage(s) {
  const show = (src) => {
    if (openId !== s.id) return;
    $('#d-img').hidden = !src;
    if (src) $('#d-img').src = src;
  };
  show(images.get(s.id) || https(s.imageUrl));
  if (!live || images.has(s.id)) return;
  try {
    const data = (await fb.getDoc(fb.doc(fb.db, 'images', s.id))).data()?.data;
    images.set(s.id, isJpeg(data) ? data : '');
  } catch {
    images.set(s.id, '');
  }
  show(images.get(s.id) || https(s.imageUrl));
}

function link(el, href, text) {
  el.hidden = !href;
  if (href) el.href = href;
  (el.firstElementChild?.tagName === 'SPAN' ? el.firstElementChild : el).textContent = text || '';
  return Boolean(href);
}

function route() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const s = state.spots.get(id);
  $('#browse').hidden = Boolean(s);
  $('#detail').hidden = !s;
  const changed = openId !== (s?.id ?? null);
  openId = s?.id ?? null;
  highlight(openId);
  if (!s) return;

  $('#d-name').textContent = s.name;
  $('#d-where').textContent = whereText(s);
  setBadge($('#d-badge'), s, true);
  $('#d-desc').textContent = s.description || '';
  showImage(s);

  const motors = [s.petrolMotor && 'bensinmotor', s.electricMotor && 'elmotor'].filter(Boolean).join(' och ');
  fact('acc', s.hasAccommodation ? join(s.beds && `${s.beds} sängplatser`, s.accommodationInfo) || 'Ja' : '');
  fact('boat', s.hasBoats
    ? join(s.boatCount && `${s.boatCount} ${s.boatCount === 1 ? 'båt' : 'båtar'}`, motors && cap(motors), s.boatInfo) || 'Ja'
    : '');
  fact('species', (s.species || []).map(cap).join(', '));
  fact('price', s.price);
  const licenseUrl = https(s.fishingLicenseUrl);
  fact('license', join(s.licenseRequired && 'Fiskekort krävs', s.fishingLicense) || (licenseUrl ? 'Fiskekort' : ''));
  link($('#d-license-link'), licenseUrl, 'Köp fiskekort');
  const web = https(s.website);
  $('#d-address').textContent = s.address || '';
  $('#d-address').hidden = !s.address;
  const any = [
    Boolean(s.address),
    link($('#d-web'), web, web && new URL(web).hostname.replace(/^www\./, '')),
    link($('#d-phone'), s.phone && `tel:${s.phone.replace(/[^\d+]/g, '')}`, s.phone),
    link($('#d-mail'), s.email && `mailto:${s.email}`, s.email),
  ].some(Boolean);
  fact('contact', any ? 'x' : '');

  const auto = !s.ownerUid && s.source === 'ai';
  const date = s.updatedAt?.toDate?.().toLocaleDateString('sv-SE');
  $('#d-source').hidden = !auto;
  $('#d-source span').textContent = `Uppgifterna är insamlade automatiskt${date ? ` ${date}` : ''} och inte bekräftade av ägaren.`;
  link($('#d-source a'), https(s.sourceUrl), 'Visa källan');

  const editable = live && (state.admin || mine(s));
  $('#d-approve').hidden = !(live && state.admin && s.status === 'pending');
  $('#d-edit').hidden = $('#d-delete').hidden = !editable;
  $('#d-claim').hidden = !(live && !s.ownerUid && s.status === 'published' && !state.admin);

  if (changed) {
    appEl.dataset.pane = 'list';
    $('#pane-toggle').textContent = 'Visa karta';
    $('.side').scrollTop = 0;
    $('#d-name').focus({ preventScroll: true });
    if (Number.isFinite(s.lat) && map.getSize().x) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 10), { duration: 0.8 });
  }
}

// ---------- Åtgärder ----------
let toastTimer;
function toast(text, bad = false) {
  const el = $('#toast');
  // En öppen dialog ligger överst och skulle annars dölja meddelandet.
  ($('dialog[open]') || document.body).append(el);
  el.textContent = text;
  el.classList.toggle('bad', bad);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}

async function act(fn, done, denied = 'Du har inte behörighet att göra det.') {
  try {
    await fn();
    toast(done);
    await refresh();
    return true;
  } catch (err) {
    console.error(err);
    toast(err.code === 'permission-denied' ? denied : 'Något gick fel. Försök igen.', true);
    return false;
  }
}

async function login() {
  if (state.user) return true;
  try {
    await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
    return true;
  } catch (err) {
    console.error(err);
    if (/popup-closed|cancelled-popup/.test(err.code)) return false;
    toast(err.code === 'auth/popup-blocked'
      ? 'Webbläsaren blockerade inloggningsfönstret. Tillåt popup-fönster för sidan och försök igen.'
      : `Inloggningen misslyckades (${err.code || 'okänt fel'}). Försök igen.`, true);
    return false;
  }
}

// ---------- Formulär ----------
let formMap;
let formPin;
function syncFormMap(recenter = false) {
  if (!formMap) {
    formMap = L.map('form-map').setView(SWEDEN, 4);
    tiles().addTo(formMap);
    formMap.on('click', (e) => {
      form.elements.lat.value = e.latlng.lat.toFixed(5);
      form.elements.lng.value = e.latlng.lng.toFixed(5);
      syncFormMap();
    });
  }
  formMap.invalidateSize();
  formPin?.remove();
  formPin = null;
  const at = [Number(form.elements.lat.value), Number(form.elements.lng.value)];
  const set = form.elements.lat.value !== '' && form.elements.lng.value !== '' && at.every(Number.isFinite);
  if (set) formPin = L.marker(at, { icon: pinIcon }).addTo(formMap);
  if (recenter) formMap.setView(set ? at : SWEDEN, set ? 10 : 4);
}

// En sektions underdel är gråad och skickas inte med när dess kryssruta är av.
function syncToggles() {
  for (const box of form.querySelectorAll('[data-toggles]')) document.getElementById(box.dataset.toggles).disabled = !box.checked;
}
form.addEventListener('change', (e) => { if (e.target.dataset.toggles) syncToggles(); });

// ---------- Bild ----------
// ponytail: bilden sparas som JPEG-text i Firestore (högst ~500 kB), eftersom Firebase Storage kräver betalplan.
// Byt till Storage om bilderna ska bli fler eller större.
const IMG = { maxFile: 15 * 1024 * 1024, minLong: 800, minShort: 500, maxSide: 1600, maxChars: 700_000 };
let pendingImage; // undefined = oförändrad, null = ta bort, sträng = ny bild

function setPreview(src) {
  $('#form-img-preview').hidden = !src;
  $('#form-img-remove').hidden = !src;
  if (src) $('#form-img-preview').src = src;
}

async function encodeImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Välj en bild i formatet JPG, PNG eller WebP.');
  if (file.size > IMG.maxFile) throw new Error('Bilden är större än 15 MB. Välj en mindre bild.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Bilden gick inte att läsa. Prova en annan bild.'); });
  const [long, short] = [Math.max(bmp.width, bmp.height), Math.min(bmp.width, bmp.height)];
  if (long < IMG.minLong || short < IMG.minShort) {
    throw new Error(`Bilden är ${bmp.width} × ${bmp.height} pixlar. Den behöver vara minst 800 × 500.`);
  }
  const scale = Math.min(1, IMG.maxSide / long);
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bmp.width * scale),
    height: Math.round(bmp.height * scale),
  });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // genomskinliga PNG-bilder blir annars svarta som JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= IMG.maxChars) return url;
  }
  throw new Error('Bilden gick inte att göra tillräckligt liten. Prova en annan bild.');
}

$('#form-image').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingImage = await encodeImage(file);
    setPreview(pendingImage);
  } catch (err) {
    toast(err.message, true);
  }
  e.target.value = '';
});
$('#form-img-remove').onclick = () => { pendingImage = null; setPreview(''); };

// ---------- Adressförslag ----------
// Photon (OpenStreetMap-data) tillåter förslag medan man skriver, till skillnad från Nominatim.
// lang=default ger svenska namn (t.ex. "Värmlands län") oavsett webbläsarens språk.
const PHOTON = 'https://photon.komoot.io/api/?limit=6&lang=default&bbox=10.5,55,24.5,69.5&q=';
const addressInput = form.elements.address;
let suggestions = [];
let suggestTimer;

const addressLabel = ({ properties: p }) => {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  return [p.name !== p.street && p.name, street, [p.postcode, p.city || p.town || p.village || p.district].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
};

addressInput.addEventListener('input', () => {
  const picked = suggestions.find((s) => addressLabel(s) === addressInput.value);
  if (picked) {
    const [lng, lat] = picked.geometry.coordinates;
    const p = picked.properties;
    form.elements.lat.value = lat.toFixed(5);
    form.elements.lng.value = lng.toFixed(5);
    if (!form.elements.place.value) form.elements.place.value = p.city || p.town || p.village || p.district || '';
    const county = [p.county, p.state].find((c) => COUNTIES.includes(c));
    if (county) form.elements.county.value = county;
    syncFormMap(true);
    return;
  }
  clearTimeout(suggestTimer);
  const q = addressInput.value.trim();
  if (q.length < 3) return;
  suggestTimer = setTimeout(async () => {
    try {
      const res = await fetch(PHOTON + encodeURIComponent(q));
      const seen = new Set();
      suggestions = (await res.json()).features
        .filter((f) => f.properties.countrycode === 'SE')
        .filter((f) => !seen.has(addressLabel(f)) && seen.add(addressLabel(f)));
      $('#address-list').replaceChildren(...suggestions.map((s) => new Option(addressLabel(s))));
    } catch { /* inga förslag, fältet går att fylla i ändå */ }
  }, 300);
});

function openForm(s) {
  editing = s?.id ?? null;
  form.reset();
  pendingImage = undefined;
  setPreview('');
  $('#form-title').textContent = s ? 'Ändra ställe' : 'Lägg till ditt ställe';
  $('#form-note').hidden = Boolean(s);
  if (s) {
    for (const el of form.elements) {
      if (!el.name || el.type === 'file') continue;
      if (el.name === 'species') el.checked = (s.species || []).includes(el.value);
      else if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
      else el.value = s[el.name] ?? '';
    }
    if (live) {
      fb.getDoc(fb.doc(fb.db, 'images', s.id)).then((d) => {
        const data = d.data()?.data;
        if (editing === s.id && pendingImage === undefined && isJpeg(data)) setPreview(data);
      }).catch(() => {});
    }
  }
  syncToggles();
  $('#edit').showModal();
  syncFormMap(true);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const get = (k) => (f.get(k) ?? '').trim(); // fält i en gråad del saknas i FormData
  const int = (k) => Number.parseInt(get(k), 10) || 0;
  // Tomma valfria fält tas bort vid ändring och utelämnas när stället skapas.
  const opt = (v) => v || (editing ? fb.deleteField() : undefined);
  const data = Object.fromEntries(Object.entries({
    ...Object.fromEntries(TEXT.map((k) => [k, get(k)])),
    address: opt(get('address')),
    lat: Number(f.get('lat')),
    lng: Number(f.get('lng')),
    hasAccommodation: f.has('hasAccommodation'),
    beds: opt(int('beds')),
    hasBoats: f.has('hasBoats'),
    boatCount: opt(int('boatCount')),
    petrolMotor: f.has('petrolMotor'),
    electricMotor: f.has('electricMotor'),
    licenseRequired: f.has('licenseRequired'),
    fishingLicenseUrl: opt(get('fishingLicenseUrl')),
    species: f.getAll('species'),
    updatedAt: fb.serverTimestamp(),
  }).filter(([, v]) => v !== undefined));
  e.submitter.disabled = true;
  const ok = await act(async () => {
    let id = editing;
    if (editing) {
      await fb.updateDoc(fb.doc(fb.db, 'spots', editing), data);
    } else {
      const fields = { ...data, imageUrl: '', ownerUid: state.user.uid, status: 'pending', source: 'owner', sourceUrl: '' };
      id = (await fb.addDoc(fb.collection(fb.db, 'spots'), fields)).id;
      filters.elements.view.value = 'mine';
    }
    images.delete(id);
    if (pendingImage) await fb.setDoc(fb.doc(fb.db, 'images', id), { data: pendingImage, updatedAt: fb.serverTimestamp() });
    else if (pendingImage === null) await fb.deleteDoc(fb.doc(fb.db, 'images', id));
  }, editing ? 'Ändringarna är sparade.' : 'Tack! Stället visas publikt när det har granskats.');
  e.submitter.disabled = false;
  if (ok) $('#edit').close();
});
for (const name of ['lat', 'lng']) form.elements[name].addEventListener('change', () => syncFormMap(true));

claimForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = `${openId}_${state.user.uid}`;
  e.submitter.disabled = true;
  // Samma person kan bara skicka en förfrågan per ställe: en andra skrivning räknas som ändring och nekas.
  const ok = await act(() => fb.setDoc(fb.doc(fb.db, 'claims', id), {
    spotId: openId,
    uid: state.user.uid,
    email: state.user.email,
    message: new FormData(claimForm).get('message').trim(),
    createdAt: fb.serverTimestamp(),
  }), 'Tack! Vi hör av oss när förfrågan är granskad.', 'Du har redan skickat en förfrågan för det här stället.');
  e.submitter.disabled = false;
  $('#claim').close();
  if (ok) claimForm.reset();
});

// ---------- Händelser ----------
filters.addEventListener('input', render);
filters.addEventListener('submit', (e) => e.preventDefault());
filters.addEventListener('reset', () => {
  const view = filters.elements.view.value;
  setTimeout(() => { filters.elements.view.value = view; render(); });
});
window.addEventListener('hashchange', route);

$('#auth-btn').onclick = () => (state.user ? fb.signOut(fb.auth) : login());
$('#add-btn').onclick = async () => { if (await login()) openForm(); };
$('#d-edit').onclick = () => openForm(state.spots.get(openId));
$('#d-approve').onclick = () => act(
  () => fb.updateDoc(fb.doc(fb.db, 'spots', openId), { status: 'published', updatedAt: fb.serverTimestamp() }),
  'Stället är publicerat.',
);
$('#d-delete').onclick = () => {
  const s = state.spots.get(openId);
  if (!confirm(`Ta bort ${s.name}? Det går inte att ångra.`)) return;
  act(async () => {
    // I samma batch, så att reglerna för bilden fortfarande ser stället och dess ägare.
    const batch = fb.writeBatch(fb.db);
    batch.delete(fb.doc(fb.db, 'images', s.id));
    batch.delete(fb.doc(fb.db, 'spots', s.id));
    await batch.commit();
    location.hash = '#/';
  }, 'Stället är borttaget.');
};
$('#d-claim').onclick = async () => {
  if (!(await login())) return;
  $('#claim-name').textContent = state.spots.get(openId).name;
  $('#claim').showModal();
};
for (const btn of document.querySelectorAll('[data-close]')) btn.onclick = () => btn.closest('dialog').close();

$('#pane-toggle').onclick = () => {
  const toMap = appEl.dataset.pane === 'list';
  appEl.dataset.pane = toMap ? 'map' : 'list';
  $('#pane-toggle').textContent = toMap ? 'Visa lista' : 'Visa karta';
  if (!toMap) return;
  map.invalidateSize();
  const s = state.spots.get(openId);
  if (s && Number.isFinite(s.lat)) map.setView([s.lat, s.lng], 10);
  else { pinned = ''; renderPins(visible()); }
};

// ---------- Start ----------
for (const sel of document.querySelectorAll('select[name=county]')) sel.append(...COUNTIES.map((c) => new Option(c)));
filters.elements.species.append(...SPECIES.map((s) => new Option(cap(s), s)));
$('#form-species').append(...SPECIES.map((s) => {
  const label = document.createElement('label');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'species', value: s });
  label.append(box, cap(s));
  return label;
}));

if (live) {
  fb.onAuthStateChanged(fb.auth, async (user) => {
    state.user = user;
    state.admin = false;
    if (user) {
      try { state.admin = (await fb.getDoc(fb.doc(fb.db, 'admins', user.uid))).exists(); } catch { /* inte admin */ }
    } else {
      filters.elements.view.value = 'all';
    }
    refresh();
  });
} else {
  refresh();
}
