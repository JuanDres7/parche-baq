// Adaptador de demostración: reproduce la API de Parche dentro del navegador.
// Solo se activa en la compilación estática (window.PARCHE_DEMO = true), pensada
// para GitHub Pages, donde no existe el servidor Node ni la base SQLite.
import { institutions, places } from './places.js';

type DemoUser = {
  id: number; name: string; email: string; password: string; institution: string;
  bio: string; vehicle: string; demo: boolean;
};
type DemoTrip = {
  id: number; driver_id: number; origin: string; destination: string; departure: string;
  seats: number; cost: number; notes: string; status: 'active' | 'cancelled'; demo: boolean;
};
type Reservation = { trip_id: number; user_id: number; created_at: string };
type Payment = { trip_id: number; user_id: number; amount: number; receipt: string };
type Rating = { trip_id: number; user_id: number; stars: number };
type Session = { user_id: number; expires_at: number };
type State = {
  users: DemoUser[]; trips: DemoTrip[]; reservations: Reservation[]; payments: Payment[];
  ratings: Rating[]; sessions: Record<string, Session>; seq: { users: number; trips: number };
};
type Data = Record<string, unknown>;

const STORAGE_KEY = 'parche-demo-state-v1';
const TOKEN_KEY = 'parche-demo-token';
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

class DemoError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

let state: State | undefined;

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Solo para contextos no seguros. La demo pública siempre usa HTTPS.
  let value = 0;
  for (const character of text) value = (Math.imul(31, value) + character.charCodeAt(0)) | 0;
  return `fallback${(value >>> 0).toString(16)}`;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  return `${salt}:${await digest(`${salt}:${password}`)}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(':');
  return Boolean(salt && expected) && (await digest(`${salt}:${password}`)) === expected;
}

function nextDayAt(offset: number, hour: number, minute: number): string {
  const local = new Date(Date.now() - 5 * 60 * 60 * 1000);
  local.setUTCDate(local.getUTCDate() + offset);
  local.setUTCHours(hour + 5, minute, 0, 0);
  return local.toISOString();
}

async function createSeed(): Promise<State> {
  const password = await hashPassword('Parche123');
  const users: DemoUser[] = [
    { id: 1, name: 'Valeria Mendoza', email: 'valeria@parche.test', password, institution: 'Universidad del Norte', bio: '', vehicle: 'Kia Picanto blanco', demo: true },
    { id: 2, name: 'Mateo Torres', email: 'mateo@parche.test', password, institution: 'Universidad Libre', bio: '', vehicle: 'Renault Sandero gris', demo: true },
    { id: 3, name: 'Juan Acosta', email: 'juan@parche.test', password, institution: 'Universidad del Atlántico', bio: '', vehicle: 'Mazda 2 azul', demo: true },
    { id: 4, name: 'Sofía Ríos', email: 'sofia@parche.test', password, institution: 'Universidad Libre', bio: '', vehicle: '', demo: true },
  ];
  const trips: DemoTrip[] = [
    { id: 1, driver_id: 1, origin: 'buenavista', destination: 'uninorte', departure: nextDayAt(1, 7, 15), seats: 3, cost: 12000, notes: 'Nos encontramos frente a la entrada principal de Buenavista 1.', status: 'active', demo: true },
    { id: 2, driver_id: 2, origin: 'portal', destination: 'unilibre', departure: nextDayAt(1, 8, 0), seats: 4, cost: 18000, notes: 'Punto de encuentro junto a la entrada de la carrera 53.', status: 'active', demo: true },
    { id: 3, driver_id: 3, origin: 'viva', destination: 'uniatlantico', departure: nextDayAt(1, 12, 30), seats: 3, cost: 15000, notes: 'Salida desde la bahía sobre la carrera 51B.', status: 'active', demo: true },
    { id: 4, driver_id: 1, origin: 'uninorte', destination: 'malecon', departure: nextDayAt(2, 16, 20), seats: 3, cost: 14000, notes: 'Salimos por la portería principal del campus.', status: 'active', demo: true },
    { id: 5, driver_id: 2, origin: 'miramar', destination: 'unisimon', departure: nextDayAt(2, 7, 30), seats: 3, cost: 16000, notes: 'Encuentro en la entrada del centro comercial Miramar.', status: 'active', demo: true },
    { id: 6, driver_id: 3, origin: 'uniatlantico', destination: 'viva', departure: nextDayAt(2, 17, 0), seats: 2, cost: 18000, notes: 'Espérame en la portería principal.', status: 'active', demo: true },
    { id: 7, driver_id: 2, origin: 'unilibre', destination: 'portal', departure: nextDayAt(3, 16, 0), seats: 4, cost: 18000, notes: 'Regreso desde Sede Norte.', status: 'active', demo: true },
  ];
  return {
    users, trips,
    reservations: [
      { trip_id: 1, user_id: 3, created_at: new Date().toISOString() },
      { trip_id: 2, user_id: 3, created_at: new Date().toISOString() },
      { trip_id: 6, user_id: 4, created_at: new Date().toISOString() },
    ],
    payments: [], ratings: [], sessions: {}, seq: { users: 4, trips: 7 },
  };
}

function save(): void {
  if (!state) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* almacenamiento lleno */ }
}

function refreshDemo(): void {
  if (!state) return;
  const now = new Date().toISOString();
  const hasFresh = state.trips.some(trip => trip.demo && trip.status === 'active' && trip.departure > now);
  if (hasFresh) return;
  const first = state.trips.filter(trip => trip.demo && trip.status === 'active')
    .map(trip => Date.parse(trip.departure)).sort((a, b) => a - b)[0];
  if (!Number.isFinite(first)) return;
  const days = Math.ceil((Date.parse(nextDayAt(1, 7, 15)) - first) / 86400000);
  for (const trip of state.trips) {
    if (trip.demo && trip.status === 'active') trip.departure = new Date(Date.parse(trip.departure) + days * 86400000).toISOString();
  }
  save();
}

async function load(): Promise<void> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (Array.isArray(parsed.users) && Array.isArray(parsed.trips) && parsed.seq) {
        state = parsed;
        state.sessions ??= {};
        state.payments ??= [];
        state.ratings ??= [];
        state.reservations ??= [];
        const now = Date.now();
        for (const [token, session] of Object.entries(state.sessions)) {
          if (session.expires_at <= now) delete state.sessions[token];
        }
        refreshDemo();
        return;
      }
    }
  } catch { /* se regenera la demo */ }
  state = await createSeed();
  save();
}

function respond(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function requestData(request: Request): Promise<Data> {
  try {
    const data: unknown = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Data;
  } catch {
    throw new DemoError(400, 'Revisa los datos e inténtalo de nuevo.');
  }
}

function field(data: Data, key: string, label: string, min: number, max: number): string {
  const value = typeof data[key] === 'string' ? data[key].trim() : '';
  if (value.length < min || value.length > max) {
    throw new DemoError(400, `${label} debe tener ${min > 0 ? `entre ${min} y` : 'hasta'} ${max} caracteres.`);
  }
  return value;
}

function emailField(data: Data): string {
  const email = field(data, 'email', 'El correo', 4, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DemoError(400, 'Escribe un correo válido.');
  return email;
}

function passwordField(data: Data): string {
  const password = typeof data.password === 'string' ? data.password : '';
  if (password.length < 8 || password.length > 128) {
    throw new DemoError(400, 'La contraseña debe tener entre 8 y 128 caracteres.');
  }
  return password;
}

function profileFields(data: Data) {
  const name = field(data, 'name', 'El nombre', 2, 70);
  const email = emailField(data);
  const institution = field(data, 'institution', 'La institución', 2, 70);
  if (!institutions.includes(institution)) throw new DemoError(400, 'Selecciona una institución de la lista.');
  const bio = field(data, 'bio', 'La descripción', 0, 240);
  const vehicle = field(data, 'vehicle', 'El vehículo', 0, 60);
  return { name, email, institution, bio, vehicle };
}

function tripFields(data: Data) {
  const origin = field(data, 'origin', 'El origen', 1, 30);
  const destination = field(data, 'destination', 'El destino', 1, 30);
  if (origin === destination || ![origin, destination].every(id => places.some(place => place.id === id))) {
    throw new DemoError(400, 'Selecciona dos lugares distintos para el origen y el destino.');
  }
  const localTime = field(data, 'departure', 'La salida', 16, 16);
  const departureTime = Date.parse(`${localTime}:00-05:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime) || !Number.isFinite(departureTime)
      || new Date(departureTime - 18000000).toISOString().slice(0, 16) !== localTime || departureTime <= Date.now()) {
    throw new DemoError(400, 'Selecciona una fecha y hora futura en Barranquilla.');
  }
  const seats = data.seats;
  const cost = data.cost;
  if (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 1 || seats > 6) {
    throw new DemoError(400, 'Ofrece entre 1 y 6 cupos.');
  }
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0 || cost > 200000) {
    throw new DemoError(400, 'Ingresa un costo total entre $0 y $200.000 COP.');
  }
  const notes = field(data, 'notes', 'El punto de encuentro', 0, 250);
  return { origin, destination, departure: new Date(departureTime).toISOString(), seats, cost, notes };
}

function sessionUser(): DemoUser | undefined {
  if (!state) return undefined;
  const token = localStorage.getItem(TOKEN_KEY);
  const session = token ? state.sessions[token] : undefined;
  if (!session) return undefined;
  if (session.expires_at <= Date.now()) {
    if (token) delete state.sessions[token];
    localStorage.removeItem(TOKEN_KEY);
    save();
    return undefined;
  }
  return state.users.find(user => user.id === session.user_id);
}

function setSession(userId?: number): void {
  if (!state) return;
  const previous = localStorage.getItem(TOKEN_KEY);
  if (previous) delete state.sessions[previous];
  if (!userId) {
    localStorage.removeItem(TOKEN_KEY);
    save();
    return;
  }
  const token = randomHex(32);
  state.sessions[token] = { user_id: userId, expires_at: Date.now() + SESSION_LIFETIME };
  localStorage.setItem(TOKEN_KEY, token);
  save();
}

function requireUser(user?: DemoUser): DemoUser {
  if (!user) throw new DemoError(401, 'Inicia sesión para continuar.');
  return user;
}

function getUser(id: number): DemoUser {
  const user = state!.users.find(item => item.id === id);
  if (!user) throw new DemoError(404, 'Esta cuenta ya no está disponible.');
  return user;
}

function publicUser(user: DemoUser) {
  const { id, name, email, institution, bio, vehicle, demo } = user;
  return { id, name, email, institution, bio, vehicle, demo: demo ? 1 : 0 };
}

function checkEmail(email: string, id = 0): void {
  if (state!.users.some(user => user.email === email && user.id !== id)) {
    throw new DemoError(409, 'Ya existe una cuenta con este correo.');
  }
}

function findTrip(id: number): DemoTrip {
  const trip = state!.trips.find(item => item.id === id);
  if (!trip) throw new DemoError(404, 'Esta ruta ya no está disponible.');
  return trip;
}

function reservationFor(tripId: number, userId?: number): Reservation | undefined {
  return state!.reservations.find(item => item.trip_id === tripId && item.user_id === userId);
}

function presentTrip(trip: DemoTrip, user?: DemoUser) {
  const driver = getUser(trip.driver_id);
  const reserved = state!.reservations.filter(item => item.trip_id === trip.id).length;
  const booked = Boolean(reservationFor(trip.id, user?.id));
  const payment = state!.payments.find(item => item.trip_id === trip.id && item.user_id === user?.id);
  const rating = state!.ratings.find(item => item.trip_id === trip.id && item.user_id === user?.id);
  const driverRatings = state!.ratings.filter(item => state!.trips.some(ride => ride.id === item.trip_id && ride.driver_id === trip.driver_id));
  const past = trip.departure <= new Date().toISOString();
  return {
    id: trip.id, origin: trip.origin, destination: trip.destination, departure: trip.departure,
    seats: trip.seats, reserved, cost: trip.cost, notes: trip.notes,
    status: trip.status === 'cancelled' ? 'cancelled' : past ? 'past' : 'active',
    driver: driver.name, institution: driver.institution, vehicle: driver.vehicle,
    mine: trip.driver_id === user?.id, booked,
    payment: payment ? { amount: payment.amount, receipt: payment.receipt } : null,
    rating: rating?.stars ?? null,
    driverRating: {
      average: driverRatings.length ? driverRatings.reduce((sum, item) => sum + item.stars, 0) / driverRatings.length : null,
      count: driverRatings.length,
    },
  };
}

function ensureActive(trip: DemoTrip): void {
  if (trip.status !== 'active' || trip.departure <= new Date().toISOString()) {
    throw new DemoError(409, 'Esta ruta ya cerró y no admite cambios.');
  }
}

function ridersFor(tripId: number) {
  return state!.reservations.filter(item => item.trip_id === tripId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.user_id - b.user_id)
    .map(item => {
      const user = getUser(item.user_id);
      return { name: user.name, institution: user.institution };
    });
}

async function handle(request: Request): Promise<Response> {
  await load();
  const path = new URL(request.url, location.href).pathname;
  const method = request.method;
  const user = sessionUser();

  if (method === 'GET' && path === '/api/session') return respond({ user: user ? publicUser(user) : null });
  if (method === 'POST' && path === '/api/register') {
    const data = await requestData(request);
    const profile = profileFields(data);
    const password = await hashPassword(passwordField(data));
    checkEmail(profile.email);
    const id = ++state!.seq.users;
    state!.users.push({ id, ...profile, password, demo: false });
    setSession(id);
    return respond({ user: publicUser(getUser(id)) }, 201);
  }
  if (method === 'POST' && path === '/api/login') {
    const data = await requestData(request);
    const email = emailField(data);
    const password = passwordField(data);
    const account = state!.users.find(item => item.email === email);
    if (!account || !(await passwordMatches(password, account.password))) {
      throw new DemoError(401, 'El correo o la contraseña son incorrectos.');
    }
    setSession(account.id);
    return respond({ user: publicUser(account) });
  }
  if (method === 'POST' && path === '/api/logout') {
    setSession();
    return respond({ user: null });
  }
  if (method === 'PATCH' && path === '/api/profile') {
    const account = requireUser(user);
    if (account.demo) throw new DemoError(403, 'Crea una cuenta propia para personalizar tu perfil.');
    const data = await requestData(request);
    const profile = profileFields(data);
    checkEmail(profile.email, account.id);
    Object.assign(account, profile);
    save();
    return respond({ user: publicUser(account) });
  }
  if (method === 'PATCH' && path === '/api/password') {
    const account = requireUser(user);
    if (account.demo) throw new DemoError(403, 'Crea una cuenta propia para cambiar la contraseña.');
    const data = await requestData(request);
    const password = passwordField(data);
    const current = typeof data.current === 'string' ? data.current : '';
    if (current.length > 128 || !(await passwordMatches(current, account.password))) {
      throw new DemoError(400, 'La contraseña actual es incorrecta.');
    }
    account.password = await hashPassword(password);
    for (const [token, session] of Object.entries(state!.sessions)) {
      if (session.user_id === account.id) delete state!.sessions[token];
    }
    setSession(account.id);
    return respond({ ok: true });
  }
  if (method === 'GET' && path === '/api/trips') {
    const now = new Date().toISOString();
    const trips = state!.trips
      .filter(trip => trip.status === 'active' && trip.departure > now)
      .sort((a, b) => a.departure.localeCompare(b.departure) || a.id - b.id)
      .map(trip => presentTrip(trip, user));
    return respond({ trips });
  }
  if (method === 'GET' && path === '/api/my-trips') {
    const account = requireUser(user);
    const trips = state!.trips
      .filter(trip => trip.driver_id === account.id || Boolean(reservationFor(trip.id, account.id)))
      .sort((a, b) => a.departure.localeCompare(b.departure) || a.id - b.id)
      .map(trip => presentTrip(trip, account));
    return respond({ trips });
  }
  if (method === 'POST' && path === '/api/trips') {
    const account = requireUser(user);
    const data = tripFields(await requestData(request));
    const trip: DemoTrip = { id: ++state!.seq.trips, driver_id: account.id, ...data, status: 'active', demo: false };
    state!.trips.push(trip);
    save();
    return respond({ trip: presentTrip(trip, account) }, 201);
  }

  const matched = path.match(/^\/api\/trips\/(\d+)(\/reservation|\/payment|\/rating)?$/);
  if (!matched) throw new DemoError(404, 'Este recurso no está disponible.');
  const id = Number(matched[1]);
  if (method === 'GET' && !matched[2]) {
    const trip = findTrip(id);
    if (trip.status === 'cancelled' && trip.driver_id !== user?.id && !reservationFor(id, user?.id)) {
      throw new DemoError(404, 'Esta ruta se canceló.');
    }
    return respond({ trip: presentTrip(trip, user), riders: trip.driver_id === user?.id ? ridersFor(id) : [] });
  }
  const account = requireUser(user);

  if (matched[2] === '/rating' && method === 'PUT') {
    const { stars } = await requestData(request);
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 0 || stars > 5) {
      throw new DemoError(400, 'Elige una calificación entera de 0 a 5 estrellas.');
    }
    const trip = findTrip(id);
    if (!reservationFor(id, account.id) || trip.driver_id === account.id) {
      throw new DemoError(403, 'Solo puede calificar quien reservó un cupo.');
    }
    if (trip.status !== 'active' || trip.departure > new Date().toISOString()) {
      throw new DemoError(409, 'Puedes calificar al conductor cuando el viaje haya terminado.');
    }
    const existing = state!.ratings.find(item => item.trip_id === id && item.user_id === account.id);
    if (existing) existing.stars = stars;
    else state!.ratings.push({ trip_id: id, user_id: account.id, stars });
    save();
    return respond({ trip: presentTrip(trip, account) });
  }

  if (matched[2] === '/payment' && method === 'POST') {
    const quote = await requestData(request);
    const trip = findTrip(id);
    ensureActive(trip);
    if (!reservationFor(id, account.id)) throw new DemoError(403, 'Reserva un cupo antes de pagar.');
    if (state!.payments.some(item => item.trip_id === id && item.user_id === account.id)) {
      return respond({ trip: presentTrip(trip, account) });
    }
    const reserved = state!.reservations.filter(item => item.trip_id === id).length;
    const amount = Math.ceil(trip.cost / (1 + reserved));
    if (!amount) throw new DemoError(400, 'Este viaje es gratuito.');
    if (quote.amount !== amount) {
      throw new DemoError(409, 'Cambió la ocupación. Vuelve al detalle para revisar el nuevo aporte.');
    }
    state!.payments.push({ trip_id: id, user_id: account.id, amount, receipt: randomHex(8).toUpperCase() });
    save();
    return respond({ trip: presentTrip(trip, account) });
  }

  if (matched[2] === '/reservation' && (method === 'POST' || method === 'DELETE')) {
    const trip = findTrip(id);
    ensureActive(trip);
    if (method === 'DELETE') {
      state!.reservations = state!.reservations.filter(item => !(item.trip_id === id && item.user_id === account.id));
      state!.payments = state!.payments.filter(item => !(item.trip_id === id && item.user_id === account.id));
      state!.ratings = state!.ratings.filter(item => !(item.trip_id === id && item.user_id === account.id));
      save();
      return respond({ trip: presentTrip(trip, account) });
    }
    if (trip.driver_id === account.id) throw new DemoError(400, 'Esta ruta fue publicada por ti.');
    if (reservationFor(id, account.id)) return respond({ trip: presentTrip(trip, account) });
    const reserved = state!.reservations.filter(item => item.trip_id === id).length;
    if (reserved >= trip.seats) throw new DemoError(409, 'Ya se ocuparon todos los cupos.');
    state!.reservations.push({ trip_id: id, user_id: account.id, created_at: new Date().toISOString() });
    save();
    return respond({ trip: presentTrip(trip, account) });
  }

  if (!matched[2] && (method === 'PATCH' || method === 'DELETE')) {
    const data = method === 'PATCH' ? tripFields(await requestData(request)) : undefined;
    const trip = findTrip(id);
    if (trip.driver_id !== account.id) throw new DemoError(403, 'Solo el conductor puede modificar esta ruta.');
    if (!data && trip.status === 'cancelled') return respond({ trip: presentTrip(trip, account) });
    ensureActive(trip);
    if (!data) {
      trip.status = 'cancelled';
      save();
      return respond({ trip: presentTrip(trip, account) });
    }
    const reserved = state!.reservations.filter(item => item.trip_id === id).length;
    if (reserved && (data.origin !== trip.origin || data.destination !== trip.destination
      || data.departure !== trip.departure || data.cost !== trip.cost)) {
      throw new DemoError(409, 'La ruta tiene reservas. Puedes actualizar los cupos y el punto de encuentro.');
    }
    if (data.seats < reserved) throw new DemoError(409, 'Conserva al menos los cupos que ya están reservados.');
    Object.assign(trip, data, { demo: false });
    save();
    return respond({ trip: presentTrip(trip, account) });
  }

  throw new DemoError(405, 'Esta acción no está disponible.');
}

function install(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    const request = input instanceof Request && !init ? input : new Request(url, init);
    try {
      return await handle(request);
    } catch (error) {
      if (error instanceof DemoError) return respond({ error: error.message }, error.status);
      console.error('Parche demo:', error);
      return respond({ error: 'Ocurrió un error. Intenta de nuevo.' }, 500);
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const footer = document.querySelector<HTMLElement>('.footer span:last-child');
    if (footer) footer.textContent = 'Demo pública · datos de ejemplo';
  });
}

declare global {
  interface Window { PARCHE_DEMO?: boolean }
}

if (window.PARCHE_DEMO) install();
