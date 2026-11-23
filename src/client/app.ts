import './demo-api.js';
import { institutions, locationDistance, places } from './places.js';
import { avatar, canRate, card, driverScore, esc, estimate, icon, journey, localDate, money, placeById, placeName, statusTag, tripDate, tripPhoto } from './presentation.js';
import { mapPanel, setupMap } from './map.js';
import type { Trip, User } from './presentation.ts';

type Detail = { trip: Trip; riders: { name: string; institution: string }[] };
type Page = 'explorar' | 'mis-viajes' | 'panel' | 'perfil';
type Mode = 'passenger' | 'driver';
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

const nav = document.querySelector<HTMLElement>('#nav')!;
const headerActions = document.querySelector<HTMLElement>('#header-actions')!;
const sectionActions = document.querySelector<HTMLElement>('#section-actions')!;
const explore = document.querySelector<HTMLElement>('#explore')!;
const driverPanel = document.querySelector<HTMLElement>('#driver-panel')!;
const driverMetrics = document.querySelector<HTMLElement>('#driver-metrics')!;
const driverRoutes = document.querySelector<HTMLElement>('#driver-routes')!;
const driverMapSlot = document.querySelector<HTMLElement>('#driver-map-slot')!;
driverMapSlot.innerHTML = `${mapPanel('Mapa de mis rutas', 'driver')}<div class="driver-map-summary"></div>`;
const secondary = document.querySelector<HTMLElement>('#secondary')!;
const filters = document.querySelector<HTMLFormElement>('#filters')!;
const cards = document.querySelector<HTMLElement>('#routes')!;
const resultsLabel = document.querySelector<HTMLElement>('#results-label')!;
const preview = document.querySelector<HTMLElement>('#map-preview')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const access = document.querySelector<HTMLElement>('#access')!;
const accessPanel = document.querySelector<HTMLElement>('#access-panel')!;
let map: ReturnType<typeof setupMap>;

let user: User | null = null;
let trips: Trip[] = [];
let myTrips: Trip[] | null = null;
let mode: Mode = 'passenger';
let driverTab: Trip['status'] = 'active';
let selectedDriverId: number | undefined;
let driverMap: ReturnType<typeof setupMap> | undefined;
let detailMap: ReturnType<typeof setupMap> | undefined;
let page: Page = getPage();
let selectedId: number | undefined;
let mobileMap = false;
let loaded = false;
let offline = false;
let installEvent: InstallEvent | undefined;
let toastTimer: number;
let detailRequest = 0;
let tableRequest = 0;
let sessionChecked = false;
let previousFocus: HTMLElement | null = null;

for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) element.outerHTML = icon(element.dataset.icon!);

function getPage(): Page {
  const hash = location.hash.slice(1);
  if (hash === 'perfil') return 'perfil';
  if (mode === 'driver') return 'panel';
  return hash === 'mis-viajes' ? 'mis-viajes' : 'explorar';
}

function savedMode(account: User): Mode {
  const saved = localStorage.getItem(`parche-mode-${account.id}`);
  if (saved === 'driver' || saved === 'passenger') return saved;
  return account.demo && account.email === 'mateo@parche.test' ? 'driver' : 'passenger';
}

function syncPage() {
  page = getPage();
  const hash = location.hash;
  if (user && (['#ingresar', '#registro'].includes(hash) || (mode === 'driver' && hash !== '#perfil'))) {
    history.replaceState(null, '', `#${page}`);
  }
}

function navigate(next: Page) {
  if (page === next) {
    renderPage();
    return;
  }
  location.hash = next;
}

async function api<T>(path: string, method = 'GET', data?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`api${path}`, {
      method, cache: 'no-store',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error('No pudimos conectar con Parche.');
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && user && path !== '/login') leaveSession();
    throw new Error(result.error ?? 'Ocurrió un error. Intenta de nuevo.');
  }
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error. Intenta de nuevo.';
}

function notify(text: string, error = false) {
  clearTimeout(toastTimer);
  toast.hidden = false;
  toast.classList.toggle('error', error);
  toast.innerHTML = `${icon(error ? 'alert' : 'check')}<span>${esc(text)}</span>`;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function button(action: string, label: string, glyph = '', style = '', id?: number): string {
  return `<button type="button" class="button ${style}" data-action="${action}" ${id ? `data-id="${id}"` : ''}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
}

function renderHeader() {
  const tabs = mode === 'driver'
    ? [['panel', 'Mis rutas', 'car'], ['perfil', 'Perfil', 'user']]
    : [['explorar', 'Explorar', 'map'], ['mis-viajes', 'Mis viajes', 'case'], ['perfil', 'Perfil', 'user']];
  const brand = document.querySelector<HTMLAnchorElement>('.brand')!;
  brand.href = mode === 'driver' ? '#panel' : '#explorar';
  brand.setAttribute('aria-label', mode === 'driver' ? 'Parche, mis rutas' : 'Parche, explorar rutas');
  nav.innerHTML = tabs.map(([id, label, glyph]) => `<a href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(glyph)}${label}</a>`).join('');
  headerActions.innerHTML = mode === 'driver'
    ? '<span class="driver-mode-label">Modo conductor</span>' : '';
  sectionActions.innerHTML = button('map-toggle', mobileMap ? 'Ver lista' : 'Ver mapa', 'map', 'secondary-button mobile-toggle')
    + (installEvent ? button('install', 'Instalar app', 'install', 'secondary-button') : '');
}

function filterDate(trip: Trip, which: string): boolean {
  const now = Date.now();
  const date = localDate(trip.departure).slice(0, 10);
  if (which === 'today') return date === localDate(new Date(now)).slice(0, 10);
  if (which === 'tomorrow') return date === localDate(new Date(now + 86400000)).slice(0, 10);
  if (which === 'week') return Date.parse(trip.departure) <= now + 7 * 86400000;
  return true;
}

const dateFilter = document.querySelector<HTMLSelectElement>('select[name="date"]')!;
const sortFilter = document.querySelector<HTMLSelectElement>('select[name="sort"]')!;
const distances = new Map<number, [number, number]>();
document.querySelector('#locations')!.innerHTML = places.map(place =>
  `<option value="${esc(place.name)}">${esc(place.area)}</option>`).join('');

function filteredTrips(): Trip[] {
  const fields = new FormData(filters);
  const origin = String(fields.get('origin') ?? '').trim();
  const destination = String(fields.get('destination') ?? '').trim();
  distances.clear();
  const found = trips.filter(trip => {
    if (!filterDate(trip, dateFilter.value)) return false;
    if ((origin || destination) && (trip.mine || trip.booked || trip.reserved >= trip.seats)) return false;
    const start = locationDistance(origin, trip.origin);
    const end = locationDistance(destination, trip.destination);
    if (Math.max(start, end) > 1.5) return false;
    distances.set(trip.id, [start, end]);
    return true;
  });
  if (sortFilter.value === 'price') found.sort((a, b) => estimate(a) - estimate(b));
  if (sortFilter.value === 'seats') found.sort((a, b) => (b.seats - b.reserved) - (a.seats - a.reserved));
  const proximity = (trip: Trip) => Math.max(...distances.get(trip.id)!);
  if (sortFilter.value === 'soon') found.sort((a, b) => proximity(a) - proximity(b));
  return found;
}

function empty(title: string, body: string, action = ''): string {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(body)}</p>${action}</div>`;
}

function renderExplore(focusMap = false) {
  const shown = filteredTrips();
  const selected = shown.find(trip => trip.id === selectedId) ?? shown[0];
  selectedId = selected?.id;
  const previousScroll = cards.scrollTop;
  resultsLabel.textContent = loaded ? `${shown.length} ${shown.length === 1 ? 'ruta encontrada' : 'rutas encontradas'}` : 'Cargando rutas…';
  if (offline) resultsLabel.textContent = 'Servidor local sin conexión';
  cards.innerHTML = shown.length ? shown.map(trip => {
    const [start, end] = distances.get(trip.id)!;
    const nearby = [start && `Salida a ~${Math.ceil(start * 1000)} m`, end && `Llegada a ~${Math.ceil(end * 1000)} m`].filter(Boolean).join(' · ');
    return card(trip, trip.id === selectedId, nearby);
  }).join('')
    : offline ? empty('Conéctate a Parche', 'El mapa está disponible. Inicia el servidor local para volver a ver las rutas.', button('reload', 'Reintentar', '', 'secondary-button'))
    : loaded ? empty('No encontramos rutas', 'Cambia la fecha o prueba con otro lugar.', button('reset', 'Limpiar filtros', '', 'secondary-button')) : '';
  cards.scrollTop = previousScroll;
  map.update(shown, selected, focusMap);
  preview.innerHTML = selected ? `<div class="preview-card"><span class="preview-icon">${icon('car')}</span><div class="preview-text"><span>Hacia</span><strong title="${esc(placeName(selected.destination))}">${esc(placeName(selected.destination))}</strong></div>${button('detail', 'Ver viaje', '', 'subtle', selected.id)}</div>` : '';
}

function select(id: number, focusMap: boolean) {
  if (id === selectedId) return;
  selectedId = id;
  renderExplore(focusMap);
}

async function refreshTrips() {
  if (!user || mode === 'driver') return;
  const account = user.id;
  try {
    const result = await api<{ trips: Trip[] }>('/trips');
    if (user?.id !== account || mode !== 'passenger') return;
    trips = result.trips;
    offline = false;
  } catch {
    offline = true;
  }
  loaded = true;
  renderExplore();
}

function renderMyTrips() {
  const items = myTrips?.filter(trip => trip.booked)
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.departure.localeCompare(b.departure));
  secondary.innerHTML = `<div class="secondary-header"><div><h1>Mis viajes</h1><p class="section-intro">Consulta tus reservas y comprobantes de pago.</p></div></div>
    ${!items ? '<p role="status">Cargando tus viajes…</p>'
    : items.length ? `<div class="trip-grid">${items.map(trip => card(trip)).join('')}</div>`
    : empty('Aún no tienes reservas', 'Encuentra una ruta que te sirva y reserva un cupo.', '<a class="button" href="#explorar">Explorar rutas</a>')}`;
}

function selectDriverRoute(id: number) {
  selectedDriverId = id;
  renderDriverPanel(true);
}

function renderDriverPanel(focus = false) {
  driverMap ??= setupMap(driverMapSlot.querySelector<HTMLElement>('.driver-map')!, selectDriverRoute);
  const own = (myTrips ?? []).filter(trip => trip.mine);
  const rating = document.querySelector<HTMLElement>('#driver-rating')!;
  rating.hidden = !own.length;
  rating.innerHTML = own.length ? driverScore(own[0].driverRating) : '';
  const upcoming = own.filter(trip => trip.status === 'active');
  const registered = upcoming.reduce((total, trip) => total + trip.reserved, 0);
  const available = upcoming.reduce((total, trip) => total + trip.seats - trip.reserved, 0);
  driverMetrics.innerHTML = [
    ['calendar', 'Próximas salidas', upcoming.length],
    ['people', 'Inscripciones próximas', registered],
    ['car', 'Cupos libres', available],
  ].map(([glyph, label, value]) => `<div class="driver-stat">${icon(String(glyph))}<strong>${myTrips ? value : '–'}</strong><span>${label}</span></div>`).join('');

  for (const tab of driverPanel.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === driverTab));
  }
  const visible = own.filter(trip => trip.status === driverTab);
  if (driverTab !== 'active') visible.reverse();
  const selected = visible.find(trip => trip.id === selectedDriverId) ?? visible[0];
  selectedDriverId = selected?.id;
  driverRoutes.innerHTML = visible.length ? visible.map(trip => `
    <article class="driver-route${trip.id === selected?.id ? ' selected' : ''}">
      <span class="card-date">${icon('clock')} ${esc(tripDate(trip.departure, true))}</span>
      ${journey(trip)}
      <div class="driver-occupancy">
        <label>${icon('people')} ${trip.reserved} de ${trip.seats} cupos reservados
          <progress max="${trip.seats}" value="${trip.reserved}"></progress>
        </label>
      </div>
      <div class="driver-route-actions">
        ${button('driver-route-map', 'Ver en mapa', 'map', 'secondary-button', trip.id)}
        ${button('detail', 'Ver detalles', '', 'subtle', trip.id)}
      </div>
    </article>`).join('') : !myTrips ? '<p role="status">Cargando tus rutas…</p>'
    : driverTab === 'active' ? empty('Sin próximas salidas', 'Publica una ruta para ofrecer los cupos de tu próximo viaje.', button('publish', 'Crear ruta', 'plus'))
    : driverTab === 'past' ? empty('Aún no hay salidas en el historial', 'Aquí verás tus rutas cuando pase su hora de salida.')
    : empty('No hay rutas canceladas', 'Las rutas que canceles aparecerán aquí.');
  driverMapSlot.hidden = !selected;
  driverMap.update(visible, selected, focus ? true : 'all');
  driverMapSlot.querySelector<HTMLElement>('.driver-map-summary')!.innerHTML = selected
    ? `<h2>Trayecto seleccionado</h2>${journey(selected)}` : '';
}

async function loadMyTrips() {
  if (!user) return;
  const request = ++tableRequest;
  try {
    const result = await api<{ trips: Trip[] }>('/my-trips');
    if (request !== tableRequest) return;
    myTrips = result.trips;
    if (page === 'mis-viajes') renderMyTrips();
    if (page === 'panel') renderDriverPanel();
  } catch (error) {
    if (request !== tableRequest) return;
    if (page === 'panel') {
      driverRoutes.innerHTML = empty('No pudimos cargar tus rutas', message(error), button('reload', 'Reintentar', '', 'secondary-button'));
      return;
    }
    if (page !== 'mis-viajes') return;
    secondary.innerHTML = `<div class="secondary-header"><h1>Mis viajes</h1></div>${empty('No pudimos cargar tus viajes', message(error), button('reload', 'Reintentar', '', 'secondary-button'))}`;
  }
}

function institutionOptions(value = '') {
  return `<option value=""${value ? '' : ' selected'} disabled>Selecciona tu institución</option>${institutions.map((name: string) => `<option${name === value ? ' selected' : ''}>${esc(name)}</option>`).join('')}`;
}

function renderProfile() {
  if (!user) {
    secondary.innerHTML = `<div class="secondary-header"><h1>Mi perfil</h1></div>${empty('Ingresa a tu cuenta', 'Desde aquí puedes mantener al día tus datos y cambiar tu contraseña.', button('login', 'Ingresar', 'user'))}`;
    return;
  }
  const profile = user;
  secondary.innerHTML = `<div class="secondary-header"><div><h1>Mi perfil</h1><p class="section-intro">Administra los datos de tu cuenta.</p></div></div>
    <div class="profile-layout">
      <aside class="profile-summary">${avatar(profile.name, profile.id)}<h2>${esc(profile.name)}</h2><p>${esc(profile.institution)}</p>${profile.demo ? '<span class="tag">Cuenta de demostración</span>' : button('password', 'Cambiar contraseña', '', 'secondary-button')}${button('change-mode', mode === 'driver' ? 'Cambiar a pasajero' : 'Cambiar a conductor', mode === 'driver' ? 'user' : 'car', 'secondary-button')}${button('logout', 'Cerrar sesión', 'logout', 'secondary-button')}</aside>
      <section class="profile-pane" aria-label="Datos del perfil"><h2>Datos personales</h2>
        ${profile.demo ? `<p class="section-intro">Esta cuenta contiene datos de ejemplo. Para editar un perfil, crea tu propia cuenta.</p><p class="section-intro">${esc(profile.email)}</p>${profile.vehicle ? `<p class="section-intro">${esc(profile.vehicle)}</p>` : ''}` : `
          <form class="form" data-form="profile">
            <div class="form-grid"><label class="field">Nombre completo<input name="name" value="${esc(profile.name)}" required minlength="2" maxlength="70" autocomplete="name"></label>
            <label class="field">Correo electrónico<input type="email" name="email" value="${esc(profile.email)}" required maxlength="120" autocomplete="email"></label></div>
            <label class="field">Institución<select name="institution" required>${institutionOptions(profile.institution)}</select></label>
            <label class="field">Vehículo (opcional)<input name="vehicle" value="${esc(profile.vehicle)}" maxlength="60" placeholder="Ej. Kia Picanto blanco"><small>Aparece en el detalle de tus rutas publicadas.</small></label>
            <label class="field">Sobre mí (opcional)<textarea name="bio" maxlength="240" rows="3">${esc(profile.bio)}</textarea></label>
            ${formError()}<div class="form-actions"><button class="button" type="submit">Guardar cambios</button></div>
          </form>`}
      </section>
    </div>`;
}

function renderPage() {
  const guest = !user;
  access.hidden = !guest;
  document.querySelector<HTMLElement>('.topbar')!.hidden = guest;
  document.querySelector<HTMLElement>('.footer')!.hidden = guest;
  if (guest) {
    explore.hidden = true;
    secondary.hidden = true;
    driverPanel.hidden = true;
    if (sessionChecked) showAuth(location.hash === '#registro' ? 'register' : 'login');
    return;
  }
  accessPanel.replaceChildren();
  if (mode === 'passenger') map ??= setupMap(document.querySelector<HTMLElement>('#map-panel')!, id => select(id, true));
  renderHeader();
  explore.hidden = page !== 'explorar';
  driverPanel.hidden = page !== 'panel';
  secondary.hidden = page !== 'mis-viajes' && page !== 'perfil';
  if (page === 'explorar') renderExplore();
  if (page === 'mis-viajes') renderMyTrips();
  if (page === 'panel') renderDriverPanel();
  if (page === 'perfil') renderProfile();
}

function formError() {
  return '<p class="form-error" role="alert" hidden></p>';
}

function showDialog(title: string, subtitle: string, content: string, photo?: string) {
  if (!dialog.open) previousFocus = document.activeElement as HTMLElement | null;
  detailMap?.dispose();
  detailMap = undefined;
  dialog.classList.toggle('photo-dialog', Boolean(photo));
  // La URL debe ser absoluta: el navegador resuelve url() dentro de la hoja de estilos versionada.
  const cover = photo ? new URL(photo, document.baseURI).href : '';
  dialog.innerHTML = `<div class="dialog-content" ${photo ? `style="--cover:url('${cover}')"` : ''}><div class="dialog-header"><div><h2 id="dialog-title" tabindex="-1">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button" type="button" data-action="close" aria-label="Cerrar ventana">${icon('close')}</button></div>${content}</div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  dialog.querySelector<HTMLElement>('#dialog-title')?.focus({ preventScroll: true });
}

function showAuth(mode: 'login' | 'register') {
  const signup = mode === 'register';
  accessPanel.innerHTML = `
    <nav class="access-tabs" aria-label="Opciones de acceso">
      <a href="#ingresar" ${signup ? '' : 'aria-current="page"'}>Iniciar sesión</a>
      <a href="#registro" ${signup ? 'aria-current="page"' : ''}>Crear cuenta</a>
    </nav>
    <h1>${signup ? 'Crea tu cuenta' : 'Bienvenido a Parche'}</h1>
    <p class="access-intro">${signup ? 'Registra tus datos para compartir viajes con otros estudiantes.' : 'Encuentra tu ruta y reserva un cupo con tu cuenta.'}</p>
    ${offline ? `<p class="form-error">El servidor local está desconectado. ${button('reload', 'Reintentar', '', 'secondary-button')}</p>` : ''}
    <form class="form" data-form="${mode}">
      ${signup ? '<label class="field">Nombre completo<input name="name" autocomplete="name" required minlength="2" maxlength="70"></label>' : ''}
      <label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="120" placeholder="tu@correo.com"></label>
      ${signup ? `<label class="field">Institución<select name="institution" required>${institutionOptions()}</select></label>` : ''}
      <label class="field">Contraseña<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" maxlength="128">${signup ? '<small>Usa al menos 8 caracteres.</small>' : ''}</label>
      ${signup ? '<label class="field">¿Cómo vas a usar Parche?<select name="mode"><option value="passenger">Como pasajero</option><option value="driver">Como conductor</option></select></label>' : ''}
      ${formError()}<button class="button" type="submit">${signup ? 'Crear cuenta' : 'Ingresar'}</button>
    </form>
    ${signup ? '' : `<div class="demo-options"><span>Probar con una cuenta de ejemplo</span>${button('demo-passenger', 'Pasajera', 'user', 'secondary-button')}${button('demo-driver', 'Conductor', 'car', 'secondary-button')}</div>`}`;
}

async function authDone(account: User, preferredMode = savedMode(account)) {
  mode = preferredMode;
  localStorage.setItem(`parche-mode-${account.id}`, mode);
  if (dialog.open) dialog.close();
  tableRequest++;
  user = account;
  myTrips = null;
  syncPage();
  renderPage();
  notify(`Ingresaste como ${account.name}.`);
  await refreshTrips();
  if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();

}

function placeOptions(value = '') {
  return `<option value=""${value ? '' : ' selected'} disabled>Selecciona un lugar</option>${places.map((place: { id: string; name: string }) => `<option value="${place.id}" ${place.id === value ? 'selected' : ''}>${esc(place.name)}</option>`).join('')}`;
}

function publish(trip?: Trip) {
  if (!user || mode !== 'driver') return;
  const lock = Boolean(trip?.reserved);
  showDialog(trip ? 'Editar ruta' : 'Publicar ruta', 'Indica tu trayecto y los cupos que puedes compartir.', `
    <form class="form" data-form="trip" ${trip ? `data-id="${trip.id}"` : ''}>
      <div class="form-grid"><label class="field">Origen<select name="origin" ${lock ? 'disabled' : 'required'}>${placeOptions(trip?.origin)}</select>${lock ? `<input type="hidden" name="origin" value="${esc(trip!.origin)}">` : ''}</label>
      <label class="field">Destino<select name="destination" ${lock ? 'disabled' : 'required'}>${placeOptions(trip?.destination)}</select>${lock ? `<input type="hidden" name="destination" value="${esc(trip!.destination)}">` : ''}</label></div>
      <label class="field">Fecha y hora de salida<input type="datetime-local" name="departure" required min="${localDate(new Date())}" value="${trip ? localDate(trip.departure) : ''}" ${lock ? 'readonly' : ''}><small>Hora de Barranquilla (GMT−5).</small></label>
      <div class="form-grid"><label class="field">Cupos ofrecidos<input type="number" name="seats" min="${Math.max(1, trip?.reserved ?? 0)}" max="6" step="1" value="${trip?.seats ?? 3}" required></label>
      <label class="field">Costo total (COP)<input type="number" name="cost" min="0" max="200000" step="1" value="${trip?.cost ?? ''}" placeholder="Ej. 12000" required ${lock ? 'readonly' : ''}></label></div>
      <label class="field">Punto de encuentro (opcional)<textarea name="notes" maxlength="250" rows="2" placeholder="Ej. En la entrada principal, junto a portería.">${esc(trip?.notes ?? '')}</textarea></label>
      <p class="form-help">${lock ? 'Con reservas activas puedes actualizar los cupos y el punto de encuentro.' : 'El costo se divide entre el conductor y los pasajeros que se unan.'}</p>
      ${formError()}<div class="form-actions">${button('close', 'Volver', '', 'secondary-button')}<button class="button" type="submit">${trip ? 'Guardar cambios' : 'Publicar ruta'}</button></div>
    </form>`);
}

function passwordForm() {
  showDialog('Cambiar contraseña', 'Escribe tu contraseña actual y elige una nueva.', `<form class="form" data-form="password">
    <label class="field">Contraseña actual<input name="current" type="password" required maxlength="128" autocomplete="current-password"></label>
    <label class="field">Nueva contraseña<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"><small>Usa al menos 8 caracteres.</small></label>
    <label class="field">Confirma tu contraseña<input name="confirmation" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
    ${formError()}<div class="form-actions"><button class="button" type="submit">Cambiar contraseña</button></div>
  </form>`);
}

function checkout(trip: Trip) {
  const paid = trip.payment;
  const amount = paid?.amount ?? estimate(trip);
  showDialog(paid ? 'Comprobante de pago' : 'Paga tu cupo', paid ? 'Pago de demostración aprobado.' : 'Tu cupo ya está reservado. Puedes pagar ahora o desde Mis viajes.', `
    <div class="ticket">
      <div class="ticket-label">${icon(paid ? 'check' : 'case')} ${paid ? 'Pago aprobado' : 'Pasarela simulada'}</div>
      <strong class="ticket-total">${money(amount)} <small>COP</small></strong>
      ${journey(trip)}
      <p>${esc(tripDate(trip.departure))}</p>
      ${paid ? `<p>Referencia <strong>${esc(paid.receipt)}</strong></p>` : '<p>Solo se usará saldo ficticio de demostración.</p>'}
    </div>
    ${paid ? `<div class="form-actions">${button('my-bookings', 'Ver mis reservas')}</div>` : `
    <form class="form" data-form="payment" data-id="${trip.id}">
      <input type="hidden" name="amount" value="${amount}">
      ${formError()}<div class="form-actions">${button('detail', 'Volver al viaje', '', 'secondary-button', trip.id)}
      <button type="submit" class="button">Simular pago de ${money(amount)}</button></div>
    </form>`}`);
}

function rateDriver(trip: Trip) {
  showDialog('Calificar conductor', trip.driver, `
    <form class="form" data-form="rating" data-id="${trip.id}">
      <fieldset class="rating-picker">
        <legend>¿Cómo estuvo tu viaje?</legend>
        <div class="rating-options">${Array.from({ length: 6 }, (_, stars) => `
          <label>
            <input class="sr-only" type="radio" name="stars" value="${stars}" aria-label="${stars} ${stars === 1 ? 'estrella' : 'estrellas'}" required ${trip.rating === stars ? 'checked' : ''}>
            <span aria-hidden="true">${stars === 0 ? '' : icon('star')}${stars}</span>
          </label>`).join('')}</div>
      </fieldset>
      ${formError()}<div class="form-actions">${button('detail', 'Volver al viaje', '', 'secondary-button', trip.id)}
      <button class="button" type="submit">Guardar calificación</button></div>
    </form>`);
}

function drawDetail(detail: Detail) {
  const { trip, riders } = detail;
  const estimateText = trip.mine || trip.booked ? 'Reparto según los cupos reservados.' : 'Aporte si te unes con la ocupación actual.';
  const canReserve = trip.reserved < trip.seats && trip.status === 'active' && !trip.mine && !trip.booked;
  const actions = canRate(trip)
    ? button('rate-driver', trip.rating === null ? 'Calificar conductor' : 'Editar calificación', 'star', '', trip.id)
    : trip.status !== 'active' ? '' : trip.mine
    ? `${button('confirm-trip', 'Cancelar ruta', '', 'secondary-button', trip.id)}${button('edit', 'Editar ruta', '', '', trip.id)}`
    : trip.booked ? button('confirm-reservation', 'Cancelar reserva', '', 'secondary-button', trip.id)
      + (trip.cost ? button('checkout', trip.payment ? 'Ver comprobante' : 'Pagar mi cupo', '', '', trip.id) : '')
    : canReserve && mode === 'passenger' ? button('reserve', user ? 'Reservar cupo' : 'Ingresar para reservar', '', '', trip.id) : '';
  showDialog(placeName(trip.destination), tripDate(trip.departure, true), `<div class="detail-body">
    <div class="route-map-block">
      ${mapPanel('Mapa del trayecto', 'detail')}
      <dl class="route-map-legend">
        <div><dt><span>A</span> Origen</dt><dd>${esc(placeName(trip.origin))}</dd></div>
        <div><dt><span>B</span> Destino</dt><dd>${esc(placeName(trip.destination))}</dd></div>
      </dl>
    </div>
    <div class="detail-meta">${statusTag(trip)}<span>${icon('people')} ${trip.reserved} de ${trip.seats} cupos reservados</span></div>
    <div class="driver">${avatar(trip.driver, trip.id)}<div><strong>${esc(trip.driver)}</strong><small>${esc(trip.institution)}${trip.vehicle ? ` · ${esc(trip.vehicle)}` : ''}</small><small>${driverScore(trip.driverRating)}</small></div></div>
    <div class="detail-price"><strong>${trip.cost ? `${money(trip.payment?.amount ?? estimate(trip))} COP` : 'Viaje gratis'}</strong><p>${trip.payment ? (trip.status === 'cancelled' ? 'Pago simulado anulado por cancelación.' : 'Aporte pagado con saldo simulado. Referencia ' + esc(trip.payment.receipt)) : trip.cost ? `${estimateText} Total del trayecto ${money(trip.cost)} COP.` : 'El conductor ofrece los cupos sin costo.'}</p></div>
    ${trip.notes ? `<div class="detail-note"><h3>Punto de encuentro</h3><p>${esc(trip.notes)}</p></div>` : ''}
    ${trip.mine ? `<div class="detail-note"><h3>Pasajeros</h3>${riders.length ? `<ul>${riders.map(rider => `<li>${esc(rider.name)} · ${esc(rider.institution)}</li>`).join('')}</ul>` : '<p>Todavía nadie ha reservado un cupo.</p>'}</div>` : ''}
  </div>
  ${actions ? `<div class="form-actions detail-actions">${actions}</div>` : ''}`, tripPhoto(trip.destination));
  detailMap = setupMap(dialog.querySelector<HTMLElement>('.detail-map')!);
  detailMap.update([trip], trip, true);
}

async function detail(id: number) {
  if (page === 'explorar') select(id, true);
  const request = ++detailRequest;
  showDialog('Detalle del viaje', 'Consultando cupos y costo…', '');
  try {
    const data = await api<Detail>(`/trips/${id}`);
    if (request === detailRequest && dialog.open) drawDetail(data);
  } catch (error) {
    if (request === detailRequest && dialog.open) showDialog('Viaje no disponible', message(error), '');
  }
}

function confirmCancellation(id: number, route: boolean) {
  const title = route ? 'Cancelar ruta' : 'Cancelar reserva';
  const text = route ? 'Tu ruta dejará de aparecer en el mapa. Los pasajeros que reservaron verán la cancelación en Mis viajes.' : 'Tu cupo quedará disponible para otra persona.';
  showDialog(title, text, `<div class="form-actions">${button('detail', 'Volver al viaje', '', 'secondary-button', id)}${button(route ? 'cancel-trip' : 'cancel-reservation', title, '', 'danger', id)}</div>`);
}

async function tripMutation(id: number, action: string) {
  const reserve = action === 'reserve';
  const route = action === 'cancel-trip';
  if (!user) return renderPage();
  try {
    const { trip } = await api<{trip: Trip}>(`/trips/${id}${route ? '' : '/reservation'}`, reserve ? 'POST' : 'DELETE');
    await refreshTrips();
    if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();
    if (dialog.open) dialog.close();
    if (reserve && trip.cost) checkout(trip);
    else notify(reserve ? 'Cupo reservado. Encuéntralo en Mis viajes.' : route ? 'Ruta cancelada.' : 'Reserva cancelada.');
  } catch (error) {
    await refreshTrips();
    if (dialog.open) showDialog('No se pudo completar la acción', message(error), `<div class="form-actions">${button('detail', 'Volver al viaje', '', 'secondary-button', id)}</div>`);
  }
}

function leaveSession() {
  if (dialog.open) dialog.close();
  user = null;
  trips = [];
  myTrips = null;
  tableRequest++;
  loaded = false;
  offline = false;
  filters.reset();
  cards.replaceChildren();
  secondary.replaceChildren();
  mode = 'passenger';
  driverTab = 'active';
  selectedDriverId = undefined;
  driverMap?.update([]);
  driverRoutes.replaceChildren();
  page = 'explorar';
  history.replaceState(null, '', '#ingresar');
  renderPage();
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    user = (await api<{ user: User | null }>('/session')).user;
    if (user) mode = savedMode(user);
    syncPage();
    offline = false;
  } catch {
    offline = true;
  }
  sessionChecked = true;
  renderPage();
  if (!user) return;
  await refreshTrips();
  if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();
}

filters.addEventListener('input', () => renderExplore());
dateFilter.addEventListener('change', () => renderExplore(true));
sortFilter.addEventListener('change', () => renderExplore());
filters.addEventListener('submit', event => {
  event.preventDefault();
  renderExplore(true);
  document.querySelector('.section-heading')?.scrollIntoView({ block: 'start' });
});
window.addEventListener('hashchange', () => {
  if (user && page === getPage()) {
    syncPage();
    return;
  }
  syncPage();
  renderPage();
  window.scrollTo(0, 0);
  if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();
});
window.addEventListener('focus', () => {
  if (user && page === 'panel' && !dialog.open) void loadMyTrips();
});
dialog.addEventListener('close', () => {
  if (dialog.open) return;

  detailRequest++;
  detailMap?.dispose();
  detailMap = undefined;
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});

document.addEventListener('click', async event => {
  const target = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);
  if (action === 'login' || action === 'register') location.hash = action === 'login' ? 'ingresar' : 'registro';
  if (action === 'close') dialog.close();
  if (action === 'publish') publish();
  if (action === 'password') passwordForm();
  if (action === 'my-bookings') {
    dialog.close();
    navigate('mis-viajes');
    if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();
  }
  if (action === 'detail') void detail(id);
  if (action === 'reset') { filters.reset(); dateFilter.value = 'all'; sortFilter.value = 'soon'; renderExplore(); }
  if (action === 'reload') void boot();
  if (action === 'map-toggle') {
    mobileMap = !mobileMap;
    explore.classList.toggle('show-map', mobileMap);
    if (mobileMap) requestAnimationFrame(() => requestAnimationFrame(() => renderExplore(true)));
    renderHeader();
    sectionActions.querySelector<HTMLElement>('.mobile-toggle')?.focus();
  }
  if (action === 'driver-tab') {
    driverTab = target.dataset.tab as Trip['status'];
    selectedDriverId = undefined;
    renderDriverPanel();
  }
  if (action === 'driver-route-map') {
    selectDriverRoute(id);
    if (window.matchMedia('(max-width: 760px)').matches) {
      driverMapSlot.querySelector<HTMLElement>('.map')?.focus({ preventScroll: true });
      driverMapSlot.scrollIntoView({ block: 'start' });
    } else driverRoutes.querySelector<HTMLButtonElement>(`[data-action="driver-route-map"][data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  if (action === 'change-mode' && user) {
    mode = mode === 'driver' ? 'passenger' : 'driver';
    localStorage.setItem(`parche-mode-${user.id}`, mode);
    navigate(mode === 'driver' ? 'panel' : 'explorar');
    if (mode === 'passenger') void refreshTrips();
  }
  if (action === 'confirm-trip' || action === 'confirm-reservation') confirmCancellation(id, action === 'confirm-trip');
  if (action === 'install' && installEvent) {
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch (error) { notify(message(error), true); }
    installEvent = undefined;
    renderHeader();
  }
  if (!['logout', 'demo-passenger', 'demo-driver', 'reserve', 'cancel-trip', 'cancel-reservation', 'edit', 'checkout', 'rate-driver'].includes(action ?? '')) return;
  target.disabled = true;
  try {
    if (action === 'demo-passenger' || action === 'demo-driver') {
      const email = action === 'demo-passenger' ? 'sofia@parche.test' : 'mateo@parche.test';
      await authDone((await api<{ user: User }>('/login', 'POST', { email, password: 'Parche123' })).user,
        action === 'demo-driver' ? 'driver' : 'passenger');
    }
    if (action === 'logout') {
      await api('/logout', 'POST');
      leaveSession();
      notify('Sesión cerrada.');
    }
    if (action === 'reserve' || action === 'cancel-trip' || action === 'cancel-reservation') await tripMutation(id, action);
    if (action === 'edit') publish((await api<Detail>(`/trips/${id}`)).trip);
    if (action === 'rate-driver') {
      const currentDialog = dialog.firstElementChild;
      const fresh = await api<Detail>(`/trips/${id}`);
      if (dialog.open && dialog.firstElementChild === currentDialog) {
        if (canRate(fresh.trip)) rateDriver(fresh.trip);
        else drawDetail(fresh);
      }
    }
    if (action === 'checkout') {
      const fresh = await api<Detail>(`/trips/${id}`);
      if (fresh.trip.booked && fresh.trip.status === 'active') checkout(fresh.trip);
      else drawDetail(fresh);
    }
  } catch (error) {
    const errorBanner = dialog.querySelector<HTMLElement>('.form-error');
    if (dialog.open && errorBanner) {
      errorBanner.textContent = message(error);
      errorBanner.hidden = false;
    } else notify(message(error), true);
  } finally { target.disabled = false; }
});

document.addEventListener('submit', async event => {
  const form = event.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const banner = form.querySelector<HTMLElement>('.form-error')!;
  if (submit.disabled) return;
  submit.disabled = true;
  banner.hidden = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (kind === 'login' || kind === 'register') {
      const { user: account } = await api<{ user: User }>(`/${kind}`, 'POST', data);
      await authDone(account, kind === 'register' && data.mode === 'driver' ? 'driver' : savedMode(account));
    }
    if (kind === 'rating') {
      await api(`/trips/${form.dataset.id}/rating`, 'PUT', { stars: Number(data.stars) });
      if (dialog.contains(form)) await detail(Number(form.dataset.id));
      await refreshTrips();
      if (page === 'mis-viajes') void loadMyTrips();
      notify('Calificación guardada.');
    }
    if (kind === 'payment') {
      const { trip } = await api<{trip: Trip}>(`/trips/${form.dataset.id}/payment`, 'POST', { amount: Number(data.amount) });
      checkout(trip);
      await refreshTrips();
      if (page === 'mis-viajes' || page === 'panel') void loadMyTrips();
    }
    if (kind === 'profile') {
      user = (await api<{ user: User }>('/profile', 'PATCH', data)).user;
      renderPage();
      notify('Perfil actualizado.');
      void refreshTrips();
    }
    if (kind === 'password') {
      if (data.password !== data.confirmation) throw new Error('Las contraseñas nuevas deben coincidir.');
      await api('/password', 'PATCH', data);
      dialog.close();
      notify('Contraseña actualizada.');
    }
    if (kind === 'trip') {
      const id = form.dataset.id;
      await api(id ? `/trips/${id}` : '/trips', id ? 'PATCH' : 'POST', { ...data, seats: Number(data.seats), cost: Number(data.cost) });
      dialog.close();
      driverTab = 'active';
      navigate('panel');
      if (page === 'panel') void loadMyTrips();
      notify(id ? 'Ruta actualizada.' : 'Ruta creada. Ya aparece entre tus próximas salidas.');
    }
  } catch (error) {
    banner.textContent = message(error);
    banner.hidden = false;
  } finally { submit.disabled = false; }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event as InstallEvent;
  renderHeader();
});
window.addEventListener('appinstalled', () => {
  installEvent = undefined;
  renderHeader();
  notify('Parche se instaló.');
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);

void boot();
