import { firebaseConfig, COUNTIES, SPECIES, slug } from './config.js?v=773da992';

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

// Mindre nålar när man zoomar ut, så att Sverigekartan inte blir grötig.
function scalePins() {
  const z = map.getZoom();
  const scale = z <= 4 ? 0.4 : z === 5 ? 0.5 : z === 6 ? 0.65 : z === 7 ? 0.82 : 1;
  map.getContainer().style.setProperty('--pin-scale', scale);
}
map.on('zoom zoomend', scalePins);
scalePins();
const markers = new Map();
let pinned = '';

// Namnet sätts som textnod: Leaflet tolkar strängar som HTML.
const labelFor = (m) => Object.assign(document.createElement('span'), { textContent: m.options.title });
const bindHover = (m) => m.bindTooltip(labelFor(m), { direction: 'top', offset: [0, -34] });

// Namnet på det öppna stället är en egen etikett på kartan, inte nålens tooltip:
// Leaflet stänger nålens tooltip när nålen tappar fokus, vilket den gör när detaljvyn tar fokus.
let fixedTip = null;
let fixedFor;
function showFixedLabel() {
  if (fixedFor === openId) return;
  fixedFor = openId;
  fixedTip?.remove();
  fixedTip = null;
  for (const [key, m] of markers) {
    // Det öppna stället får ingen pek-etikett, så att namnet inte visas två gånger.
    if (key === openId) m.unbindTooltip();
    else if (!m.getTooltip()) bindHover(m);
  }
  const m = markers.get(openId);
  if (!m) return;
  fixedTip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -50], className: 'is-fixed', interactive: false })
    .setLatLng(m.getLatLng())
    .setContent(labelFor(m))
    .addTo(map);
}

function highlight(id) {
  for (const [key, m] of markers) m.getElement()?.classList.toggle('is-active', key === id);
  map.getContainer().classList.toggle('has-open', Boolean(openId));
  showFixedLabel();
}

// ponytail: alla nålar ritas var för sig. Lägg till klustring om det blir fler än några hundra.
function renderPins(list) {
  pins.clearLayers();
  markers.clear();
  fixedFor = undefined; // nya nålar: etiketten för det öppna stället sätts om
  for (const s of list) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const m = L.marker([s.lat, s.lng], { icon: pinIcon, title: s.name, alt: s.name })
      .on('click', () => { location.hash = `#/${s.id}`; })
      .addTo(pins);
    bindHover(m);
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
// Filtren läses som en vanlig struktur, så att antalet per alternativ kan räknas med ett alternativ ändrat.
function readFilters(fd = new FormData(filters)) {
  return {
    view: fd.get('view'),
    q: (fd.get('q') || '').trim().toLowerCase(),
    counties: fd.getAll('county'),
    species: fd.getAll('species'),
    acc: fd.has('acc'),
    beds: Number(fd.get('beds')) || 0,
    boat: fd.has('boat'),
    petrol: fd.has('petrol'),
    electric: fd.has('electric'),
    owner: fd.has('owner'),
    sort: fd.get('sort') || 'name',
  };
}

function inView(s, v) {
  return v.view === 'mine' ? mine(s) : v.view === 'review' ? s.status === 'pending' : s.status === 'published';
}

function matches(s, v) {
  return inView(s, v)
    && (!v.q || [s.name, s.lake, s.place, s.county, s.address, s.description].join(' ').toLowerCase().includes(v.q))
    && (!v.counties.length || v.counties.includes(s.county))
    && v.species.every((x) => (s.species || []).includes(x))
    && (!v.acc || s.hasAccommodation)
    && (!v.beds || (s.hasAccommodation && s.beds >= v.beds))
    && (!v.boat || s.hasBoats)
    && (!v.petrol || (s.hasBoats && s.petrolMotor))
    && (!v.electric || (s.hasBoats && s.electricMotor))
    && (!v.owner || Boolean(s.ownerUid));
}

// Avstånd i km mellan två punkter (haversine).
function km(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const distance = (s) => (state.here && Number.isFinite(s.lat) ? km(state.here, s) : Infinity);

// Ställen som saknar uppgiften hamnar sist, i namnordning.
const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name, 'sv'),
  near: (a, b) => distance(a) - distance(b) || SORTS.name(a, b),
  north: (a, b) => (b.lat ?? -Infinity) - (a.lat ?? -Infinity) || SORTS.name(a, b),
  beds: (a, b) => (b.beds || 0) - (a.beds || 0) || SORTS.name(a, b),
  boats: (a, b) => (b.boatCount || 0) - (a.boatCount || 0) || SORTS.name(a, b),
};

function visible(v = readFilters()) {
  return [...state.spots.values()].filter((s) => matches(s, v)).sort(SORTS[v.sort] || SORTS.name);
}

const countText = (n) => `${n} ${n === 1 ? 'ställe' : 'ställen'}`;

// Antal i varje alternativ: vad listan skulle visa om just det alternativet valdes.
function renderFacets(v) {
  const spots = [...state.spots.values()];
  const count = (change) => spots.filter((s) => matches(s, { ...v, ...change })).length;
  for (const input of filters.querySelectorAll('.drawer input[type=checkbox]')) {
    const { name, value } = input;
    const n = name === 'county' ? count({ counties: [value] })
      : name === 'species' ? count({ species: [...new Set([...v.species, value])] })
      : count({ [name]: true });
    const label = input.closest('label');
    $('.n', label).textContent = n;
    label.classList.toggle('empty', !n && !input.checked);
  }
}

// Valda filter som chips under sökfältet, var och en med ett kryss.
function renderActive(v) {
  const chips = [
    ...(v.q ? [[`”${v.q}”`, () => { filters.elements.q.value = ''; }]] : []),
    ...v.species.map((x) => [cap(x), () => uncheck('species', x)]),
    ...v.counties.map((c) => [c, () => uncheck('county', c)]),
    ...(v.acc ? [['Har boende', () => uncheck('acc')]] : []),
    ...(v.beds ? [[`Minst ${v.beds} sängplatser`, () => { filters.elements.beds.value = 0; }]] : []),
    ...(v.boat ? [['Har båt', () => uncheck('boat')]] : []),
    ...(v.petrol ? [['Bensinmotor', () => uncheck('petrol')]] : []),
    ...(v.electric ? [['Elmotor', () => uncheck('electric')]] : []),
    ...(v.owner ? [['Bekräftat av ägaren', () => uncheck('owner')]] : []),
  ];
  const items = chips.map(([text, clear]) => {
    const li = document.createElement('li');
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'active-chip' });
    btn.setAttribute('aria-label', `Ta bort filtret ${text}`);
    btn.append(text, Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { innerHTML: '<use href="#i-x"/>' }));
    btn.lastChild.setAttribute('class', 'icon');
    btn.onclick = () => { clear(); render(); };
    li.append(btn);
    return li;
  });
  if (chips.length > 1) {
    const li = document.createElement('li');
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: 'Rensa alla' });
    btn.onclick = clearFilters;
    li.append(btn);
    items.push(li);
  }
  $('#active-filters').replaceChildren(...items);
  // Sökordet räknas inte på Filter-knappen, det syns redan i sökfältet.
  const n = chips.length - (v.q ? 1 : 0);
  $('#filter-count').textContent = n || '';
  $('#filter-open').setAttribute('aria-label', n ? `Filter, ${n} valda` : 'Filter');
}

function uncheck(name, value) {
  for (const el of filters.querySelectorAll(`input[name=${name}]`)) if (value === undefined || el.value === value) el.checked = false;
}

function clearFilters() {
  for (const el of filters.querySelectorAll('.drawer input[type=checkbox]')) el.checked = false;
  filters.elements.beds.value = 0;
  filters.elements.q.value = '';
  render();
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
  const d = filters.elements.sort.value === 'near' ? distance(s) : Infinity;
  const away = d < Infinity ? ` · ${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} km bort` : '';
  $('.row-where', li).textContent = whereText(s) + away;
  $('.row-acc', li).hidden = !s.hasAccommodation;
  $('.row-boat', li).hidden = !s.hasBoats;
  if (s.beds) $('.row-acc .t', li).textContent = `${s.beds} sängplatser`;
  if (s.boatCount) $('.row-boat .t', li).textContent = `${s.boatCount} ${s.boatCount === 1 ? 'båt' : 'båtar'}`;
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
  const v = readFilters();
  const list = visible(v);
  const { view } = v;
  renderFacets(v);
  renderActive(v);
  $('#filter-show').textContent = list.length ? `Visa ${countText(list.length)}` : 'Inga ställen matchar';
  const pending = [...state.spots.values()].filter((s) => s.status === 'pending').length + state.claims.length;

  $('#auth-btn').textContent = state.user ? 'Logga ut' : 'Logga in';
  $('#auth-btn').disabled = $('#add-btn').disabled = !live;
  $('#user-name').textContent = state.user?.displayName || state.user?.email || '';
  $('#views').hidden = !state.user;
  $('#view-review').hidden = !state.admin;
  $('#review-count').textContent = pending || '';

  $('#count').textContent = countText(list.length);
  $('#list').replaceChildren(...list.map(row));
  $('#list-status').textContent = state.status || (list.length ? ''
    : view === 'mine' ? 'Du har inte lagt till något ställe än.'
    : view === 'review' ? 'Inga ställen väntar på granskning.'
    : state.spots.size ? 'Inga ställen matchar. Ta bort ett filter eller rensa alla.'
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
  // Googles officiella webbadress för att visa en plats; inget skickas förrän man klickar.
  const hasPos = Number.isFinite(s.lat) && Number.isFinite(s.lng);
  $('#d-gmaps').hidden = !hasPos;
  if (hasPos) $('#d-gmaps').href = `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
  setBadge($('#d-badge'), s, true);
  $('#d-desc').textContent = s.description || '';
  showImage(s);

  const motors = [s.petrolMotor && 'bensinmotor', s.electricMotor && 'elmotor'].filter(Boolean).join(' och ');
  // Boende och båtar visas alltid, så att det syns tydligt när de saknas.
  fact('acc', s.hasAccommodation ? join(s.beds && `${s.beds} sängplatser`, s.accommodationInfo) || 'Ja' : 'Erbjuds inte');
  fact('boat', s.hasBoats
    ? join(s.boatCount && `${s.boatCount} ${s.boatCount === 1 ? 'båt' : 'båtar'}`, motors && cap(motors), s.boatInfo) || 'Ja'
    : 'Hyrs inte ut');
  $('[data-row=acc]').classList.toggle('none', !s.hasAccommodation);
  $('[data-row=boat]').classList.toggle('none', !s.hasBoats);
  fact('species', (s.species || []).map(cap).join(', '));
  fact('price', s.price);
  const licenseUrl = https(s.fishingLicenseUrl);
  fact('license', join(s.licenseRequired && 'Fiskekort krävs', s.fishingLicense) || (licenseUrl ? 'Fiskekort' : ''));
  link($('#d-license-link'), licenseUrl, 'Köp fiskekort');
  const web = https(s.website);
  $('#d-address').textContent = s.address || '';
  $('#d-address').hidden = !s.address;
  const any = [
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

// Länkar får skrivas utan https:// (t.ex. "fiske.se"). Sidan lägger till det och kräver bara en domän.
function normalizeLink(el) {
  let v = el.value.trim();
  if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  v = v.replace(/^http:\/\//i, 'https://');
  el.value = v;
  let ok = !v;
  try { ok ||= new URL(v).hostname.includes('.'); } catch { /* ogiltig adress */ }
  el.setCustomValidity(ok ? '' : 'Skriv en webbadress, till exempel fiske.se');
  return ok;
}
for (const el of form.querySelectorAll('[data-link]')) {
  el.addEventListener('change', () => normalizeLink(el));
  el.addEventListener('input', () => el.setCustomValidity(''));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const links = [...form.querySelectorAll('[data-link]:enabled')];
  if (!links.map(normalizeLink).every(Boolean)) return form.reportValidity();
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

// Din position på kartan: en prick med lugna ringar som växer ut från den.
const hereIcon = L.divIcon({
  className: 'here',
  iconSize: [140, 140],
  iconAnchor: [70, 70],
  html: '<span class="here-ring"></span><span class="here-ring"></span><span class="here-ring"></span><span class="here-dot"></span>',
});
let hereMarker;

function showHere() {
  hereMarker?.remove();
  hereMarker = L.marker(state.here, { icon: hereIcon, interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(map);
  // Visa positionen tillsammans med de tre närmaste ställena.
  const nearest = visible().filter((s) => Number.isFinite(s.lat)).slice(0, 3).map((s) => [s.lat, s.lng]);
  if (map.getSize().x) map.flyToBounds(L.latLngBounds([state.here, ...nearest]).pad(0.35), { maxZoom: 10, duration: 1.4 });
}

// Positionen frågas bara när man väljer "Närmast mig", och används bara här i webbläsaren.
filters.elements.sort.addEventListener('change', (e) => {
  if (e.target.value !== 'near') { hereMarker?.remove(); hereMarker = null; return; }
  if (state.here) { showHere(); return; }
  if (!navigator.geolocation) {
    toast('Webbläsaren kan inte ta reda på din position.', true);
    e.target.value = 'name';
    render();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      render();
      showHere();
    },
    (err) => {
      toast(err.code === err.PERMISSION_DENIED
        ? 'Du har inte gett sidan tillgång till din position. Tillåt det i webbläsaren och försök igen.'
        : 'Det gick inte att ta reda på din position. Försök igen.', true);
      e.target.value = 'name';
      render();
    },
    { maximumAge: 600000, timeout: 15000 },
  );
});
filters.addEventListener('submit', (e) => e.preventDefault());
$('#filter-open').onclick = () => $('#filter-panel').showModal();
$('#filter-clear').onclick = clearFilters;
for (const btn of filters.querySelectorAll('[data-step]')) {
  btn.onclick = () => {
    const input = filters.elements.beds;
    input.value = Math.max(0, (Number(input.value) || 0) + Number(btn.dataset.step) * (Number(input.value) >= 10 ? 2 : 1));
    render();
  };
}
// Klick på mörkret utanför panelen stänger den, som på de flesta sidor.
$('#filter-panel').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
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
const option = (name, value, text, className) => {
  const label = document.createElement('label');
  label.className = className;
  label.append(
    Object.assign(document.createElement('input'), { type: 'checkbox', name, value }),
    Object.assign(document.createElement('span'), { textContent: text }),
    Object.assign(document.createElement('span'), { className: 'n' }),
  );
  return label;
};
$('#f-species').append(...SPECIES.map((s) => option('species', s, cap(s), 'chip')));
$('#f-county').append(...COUNTIES.map((c) => option('county', c, c, 'opt')));
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
