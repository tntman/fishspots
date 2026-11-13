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

const TEXT = ['name', 'lake', 'county', 'place', 'description', 'accommodationInfo', 'boatInfo',
  'price', 'fishingLicense', 'website', 'phone', 'email', 'imageUrl'];
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
  if (key !== 'contact') $('dd', div).textContent = text || '';
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
  $('#d-img').hidden = !https(s.imageUrl);
  if (https(s.imageUrl)) $('#d-img').src = s.imageUrl;

  fact('acc', s.hasAccommodation ? s.accommodationInfo || 'Ja' : '');
  fact('boat', s.hasBoats ? s.boatInfo || 'Ja' : '');
  fact('species', (s.species || []).map(cap).join(', '));
  fact('price', s.price);
  fact('license', s.fishingLicense);
  const web = https(s.website);
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

function openForm(s) {
  editing = s?.id ?? null;
  form.reset();
  $('#form-title').textContent = s ? 'Ändra ställe' : 'Lägg till ditt ställe';
  $('#form-note').hidden = Boolean(s);
  if (s) {
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.name === 'species') el.checked = (s.species || []).includes(el.value);
      else if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
      else el.value = s[el.name] ?? '';
    }
  }
  $('#edit').showModal();
  syncFormMap(true);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const data = {
    ...Object.fromEntries(TEXT.map((k) => [k, f.get(k).trim()])),
    lat: Number(f.get('lat')),
    lng: Number(f.get('lng')),
    hasAccommodation: f.has('hasAccommodation'),
    hasBoats: f.has('hasBoats'),
    species: f.getAll('species'),
    updatedAt: fb.serverTimestamp(),
  };
  e.submitter.disabled = true;
  const ok = await act(async () => {
    if (editing) return fb.updateDoc(fb.doc(fb.db, 'spots', editing), data);
    await fb.addDoc(fb.collection(fb.db, 'spots'), { ...data, ownerUid: state.user.uid, status: 'pending', source: 'owner', sourceUrl: '' });
    filters.elements.view.value = 'mine';
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
  act(async () => { await fb.deleteDoc(fb.doc(fb.db, 'spots', s.id)); location.hash = '#/'; }, 'Stället är borttaget.');
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
