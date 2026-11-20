import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { db, passwordHash, passwordMatches, transaction } from './database.ts';
import { institutions, places } from './client/places.ts';

type User = { id: number; name: string; email: string; institution: string; bio: string; vehicle: string; demo: number };
type Trip = { id: number; driver_id: number; origin: string; destination: string; departure: string; seats: number; cost: number; notes: string; status: string; reserved: number; driver: string; institution: string; vehicle: string; amount: number | null; receipt: string | null; rating: number | null; driver_score: number | null; rating_count: number | null; booked: number };
type Data = Record<string, unknown>;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const cookieName = 'parche_session';
const sessionLifetime = 7 * 24 * 60 * 60;
const userFields = 'u.id,u.name,u.email,u.institution,u.bio,u.vehicle,u.demo';

function respond(res: ServerResponse, payload: unknown, code = 200): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function body(req: IncomingMessage): Promise<Data> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new ApiError(415, 'Envía los datos como JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'Los datos superan el tamaño permitido.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new ApiError(400, 'Revisa los datos e inténtalo de nuevo.');
  }
}

function field(data: Data, key: string, label: string, min: number, max: number): string {
  const value = typeof data[key] === 'string' ? data[key].trim() : '';
  if (value.length < min || value.length > max) {
    throw new ApiError(400, `${label} debe tener ${min > 0 ? `entre ${min} y` : 'hasta'} ${max} caracteres.`);
  }
  return value;
}

function emailField(data: Data): string {
  const email = field(data, 'email', 'El correo', 4, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Escribe un correo válido.');
  return email;
}

function passwordField(data: Data): string {
  const password = typeof data.password === 'string' ? data.password : '';
  if (password.length < 8 || password.length > 128) throw new ApiError(400, 'La contraseña debe tener entre 8 y 128 caracteres.');
  return password;
}

function profileFields(data: Data) {
  const name = field(data, 'name', 'El nombre', 2, 70);
  const email = emailField(data);
  const institution = field(data, 'institution', 'La institución', 2, 70);
  if (!institutions.includes(institution)) throw new ApiError(400, 'Selecciona una institución de la lista.');
  const bio = field(data, 'bio', 'La descripción', 0, 240);
  const vehicle = field(data, 'vehicle', 'El vehículo', 0, 60);
  return { name, email, institution, bio, vehicle };
}

function tripFields(data: Data) {
  const origin = field(data, 'origin', 'El origen', 1, 30);
  const destination = field(data, 'destination', 'El destino', 1, 30);
  if (origin === destination || ![origin, destination].every(id => places.some(place => place.id === id))) {
    throw new ApiError(400, 'Selecciona dos lugares distintos para el origen y el destino.');
  }
  const localTime = field(data, 'departure', 'La salida', 16, 16);
  const departureTime = Date.parse(`${localTime}:00-05:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime) || !Number.isFinite(departureTime)
      || new Date(departureTime - 18000000).toISOString().slice(0, 16) !== localTime || departureTime <= Date.now()) {
    throw new ApiError(400, 'Selecciona una fecha y hora futura en Barranquilla.');
  }
  const seats = data.seats;
  const cost = data.cost;
  if (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 1 || seats > 6) throw new ApiError(400, 'Ofrece entre 1 y 6 cupos.');
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0 || cost > 200000) throw new ApiError(400, 'Ingresa un costo total entre $0 y $200.000 COP.');
  const notes = field(data, 'notes', 'El punto de encuentro', 0, 250);
  return { origin, destination, departure: new Date(departureTime).toISOString(), seats, cost, notes };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(req: IncomingMessage): string | undefined {
  return req.headers.cookie?.match(/(?:^|;\s*)parche_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function readUser(req: IncomingMessage): User | undefined {
  const token = sessionToken(req);
  if (!token) return;
  return db.prepare(`SELECT ${userFields} FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?`)
    .get(tokenHash(token), Date.now()) as User | undefined;
}

function setSession(req: IncomingMessage, res: ServerResponse, userId?: number): void {
  const previous = sessionToken(req);
  if (previous) db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(previous));
  if (!userId) {
    res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return;
  }
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), userId, Date.now() + sessionLifetime * 1000);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime}`);
}

function getUser(id: number): User {
  return db.prepare(`SELECT ${userFields} FROM users u WHERE id=?`).get(id) as User;
}

function checkEmail(email: string, id = 0): void {
  if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, id)) {
    throw new ApiError(409, 'Ya existe una cuenta con este correo.');
  }
}

function requireUser(user: User | undefined): User {
  if (!user) throw new ApiError(401, 'Inicia sesión para continuar.');
  return user;
}

const tripSelect = `SELECT t.*, u.name AS driver, u.institution, u.vehicle,
  (SELECT COUNT(*) FROM reservations WHERE trip_id=t.id) AS reserved,
  r.user_id IS NOT NULL AS booked, p.amount, p.receipt, own_rating.stars AS rating,
  scores.average AS driver_score, scores.total AS rating_count
  FROM trips t JOIN users u ON t.driver_id=u.id
  LEFT JOIN reservations r ON r.trip_id=t.id AND r.user_id=?
  LEFT JOIN payments p ON p.trip_id=r.trip_id AND p.user_id=r.user_id
  LEFT JOIN ratings own_rating ON own_rating.trip_id=r.trip_id AND own_rating.user_id=r.user_id
  LEFT JOIN (
    SELECT rated_trip.driver_id, AVG(rating.stars) AS average, COUNT(*) AS total
    FROM ratings rating JOIN trips rated_trip ON rated_trip.id=rating.trip_id
    GROUP BY rated_trip.driver_id
  ) scores ON scores.driver_id=t.driver_id`;

function presentTrip(row: Trip, user?: User) {
  const past = row.departure <= new Date().toISOString();
  return {
    id: row.id, origin: row.origin, destination: row.destination, departure: row.departure,
    seats: row.seats, reserved: row.reserved, cost: row.cost, notes: row.notes,
    status: row.status === 'cancelled' ? 'cancelled' : past ? 'past' : 'active',
    driver: row.driver, institution: row.institution, vehicle: row.vehicle,
    mine: row.driver_id === user?.id, booked: Boolean(row.booked),
    payment: row.receipt ? { amount: row.amount, receipt: row.receipt } : null,
    rating: row.rating,
    driverRating: { average: row.driver_score, count: row.rating_count ?? 0 },
  };
}

function findTrip(id: number, user?: User): Trip {
  const trip = db.prepare(`${tripSelect} WHERE t.id=?`).get(user?.id ?? 0, id) as Trip | undefined;
  if (!trip) throw new ApiError(404, 'Esta ruta ya no está disponible.');
  return trip;
}

function ensureActive(trip: Trip): void {
  if (trip.status !== 'active' || trip.departure <= new Date().toISOString()) {
    throw new ApiError(409, 'Esta ruta ya cerró y no admite cambios.');
  }
}

export async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method;
  const path = url.pathname;
  try {
    if (method !== 'GET' && req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Solicitud fuera de Parche.');
    const user = readUser(req);
    if (method === 'GET' && path === '/api/session') {
      return respond(res, { user: user ?? null });
    }
    if (method === 'POST' && path === '/api/register') {
      const data = await body(req);
      const profile = profileFields(data);
      const password = passwordHash(passwordField(data));
      const id = transaction(() => {
        checkEmail(profile.email);
        return Number(db.prepare('INSERT INTO users (name,email,password,institution) VALUES (?,?,?,?)')
          .run(profile.name, profile.email, password, profile.institution).lastInsertRowid);
      });
      setSession(req, res, id);
      return respond(res, { user: getUser(id) }, 201);
    }
    if (method === 'POST' && path === '/api/login') {
      const data = await body(req);
      const record = db.prepare('SELECT id,password FROM users WHERE email=?').get(emailField(data));
      if (!record || !passwordMatches(passwordField(data), String(record.password))) {
        throw new ApiError(401, 'El correo o la contraseña son incorrectos.');
      }
      setSession(req, res, Number(record.id));
      return respond(res, { user: getUser(Number(record.id)) });
    }
    if (method === 'POST' && path === '/api/logout') {
      setSession(req, res);
      return respond(res, { user: null });
    }
    if (method === 'PATCH' && path === '/api/profile') {
      const account = requireUser(user);
      if (account.demo) throw new ApiError(403, 'Crea una cuenta propia para personalizar tu perfil.');
      const data = await body(req);
      const { name, email, institution, bio, vehicle } = profileFields(data);
      transaction(() => {
        checkEmail(email, account.id);
        db.prepare('UPDATE users SET name=?,email=?,institution=?,bio=?,vehicle=? WHERE id=?').run(name, email, institution, bio, vehicle, account.id);
      });
      return respond(res, { user: getUser(account.id) });
    }
    if (method === 'PATCH' && path === '/api/password') {
      const account = requireUser(user);
      if (account.demo) throw new ApiError(403, 'Crea una cuenta propia para cambiar la contraseña.');
      const data = await body(req);
      const password = passwordField(data);
      const stored = db.prepare('SELECT password FROM users WHERE id=?').get(account.id);
      if (typeof data.current !== 'string' || data.current.length > 128 || !passwordMatches(data.current, String(stored?.password))) {
        throw new ApiError(400, 'La contraseña actual es incorrecta.');
      }
      transaction(() => {
        db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(password), account.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
      });
      setSession(req, res, account.id);
      return respond(res, { ok: true });
    }
    if (method === 'GET' && path === '/api/trips') {
      const now = new Date().toISOString();
      const trips = db.prepare(`${tripSelect} WHERE t.status='active' AND t.departure>? ORDER BY t.departure, t.id`).all(user?.id ?? 0, now);
      return respond(res, { trips: (trips as Trip[]).map(trip => presentTrip(trip, user)) });
    }
    if (method === 'GET' && path === '/api/my-trips') {
      const account = requireUser(user);
      const trips = db.prepare(`${tripSelect} WHERE t.driver_id=? OR EXISTS (SELECT 1 FROM reservations WHERE trip_id=t.id AND user_id=?) ORDER BY t.departure, t.id`)
        .all(account.id, account.id, account.id) as Trip[];
      return respond(res, { trips: trips.map(trip => presentTrip(trip, account)) });
    }
    if (method === 'POST' && path === '/api/trips') {
      const account = requireUser(user);
      const { origin, destination, departure, seats, cost, notes } = tripFields(await body(req));
      const id = db.prepare('INSERT INTO trips (driver_id,origin,destination,departure,seats,cost,notes) VALUES (?,?,?,?,?,?,?)')
        .run(account.id, origin, destination, departure, seats, cost, notes).lastInsertRowid;
      return respond(res, { trip: presentTrip(findTrip(Number(id), account), account) }, 201);
    }

    const matched = path.match(/^\/api\/trips\/(\d+)(\/reservation|\/payment|\/rating)?$/);
    if (!matched) throw new ApiError(404, 'Este recurso no está disponible.');
    const id = Number(matched[1]);
    if (method === 'GET' && !matched[2]) {
      const trip = findTrip(id, user);
      if (trip.status === 'cancelled' && trip.driver_id !== user?.id && !trip.booked) throw new ApiError(404, 'Esta ruta se canceló.');
      const riders = trip.driver_id === user?.id
        ? db.prepare('SELECT u.name,u.institution FROM users u JOIN reservations r ON u.id=r.user_id WHERE r.trip_id=? ORDER BY r.created_at,u.id').all(id)
        : [];
      return respond(res, { trip: presentTrip(trip, user), riders });
    }
    const account = requireUser(user);
    if (matched[2] === '/rating' && method === 'PUT') {
      const { stars } = await body(req);
      if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 0 || stars > 5) {
        throw new ApiError(400, 'Elige una calificación entera de 0 a 5 estrellas.');
      }
      const rated = transaction(() => {
        const trip = findTrip(id, account);
        if (!trip.booked || trip.driver_id === account.id) throw new ApiError(403, 'Solo puede calificar quien reservó un cupo.');
        if (trip.status !== 'active' || trip.departure > new Date().toISOString()) {
          throw new ApiError(409, 'Puedes calificar al conductor cuando el viaje haya terminado.');
        }
        db.prepare(`
          INSERT INTO ratings (trip_id, user_id, stars) VALUES (?, ?, ?)
          ON CONFLICT(trip_id, user_id) DO UPDATE SET stars=excluded.stars
        `).run(id, account.id, stars);
        return findTrip(id, account);
      });
      return respond(res, { trip: presentTrip(rated, account) });
    }
    if (matched[2] === '/payment' && method === 'POST') {
      const quote = await body(req);
      transaction(() => {
        const trip = findTrip(id, account);
        ensureActive(trip);
        if (!trip.booked) throw new ApiError(403, 'Reserva un cupo antes de pagar.');
        if (trip.receipt) return;
        const amount = Math.ceil(trip.cost / (1 + trip.reserved));
        if (!amount) throw new ApiError(400, 'Este viaje es gratuito.');
        if (quote.amount !== amount) throw new ApiError(409, 'Cambió la ocupación. Vuelve al detalle para revisar el nuevo aporte.');
        db.prepare('INSERT INTO payments (trip_id,user_id,amount,receipt) VALUES (?,?,?,?)')
          .run(id, account.id, amount, randomBytes(8).toString('hex').toUpperCase());
      });
      return respond(res, { trip: presentTrip(findTrip(id, account), account) });
    }
    if (matched[2] === '/reservation' && (method === 'POST' || method === 'DELETE')) {
      transaction(() => {
        const trip = findTrip(id, account);
        ensureActive(trip);
        if (method === 'DELETE') {
          db.prepare('DELETE FROM reservations WHERE trip_id=? AND user_id=?').run(id, account.id);
          return;
        }
        if (trip.driver_id === account.id) throw new ApiError(400, 'Esta ruta fue publicada por ti.');
        if (trip.booked) return;
        if (trip.reserved >= trip.seats) throw new ApiError(409, 'Ya se ocuparon todos los cupos.');
        db.prepare('INSERT INTO reservations (trip_id,user_id) VALUES (?,?)').run(id, account.id);
      });
      return respond(res, { trip: presentTrip(findTrip(id, account), account) });
    }
    if (!matched[2] && (method === 'PATCH' || method === 'DELETE')) {
      const data = method === 'PATCH' ? tripFields(await body(req)) : null;
      transaction(() => {
        const trip = findTrip(id, account);
        if (trip.driver_id !== account.id) throw new ApiError(403, 'Solo el conductor puede modificar esta ruta.');
        if (!data && trip.status === 'cancelled') return;
        ensureActive(trip);
        if (!data) {
          db.prepare("UPDATE trips SET status='cancelled' WHERE id=?").run(id);
          return;
        }
        if (trip.reserved && (data.origin !== trip.origin || data.destination !== trip.destination || data.departure !== trip.departure || data.cost !== trip.cost)) {
          throw new ApiError(409, 'La ruta tiene reservas. Puedes actualizar los cupos y el punto de encuentro.');
        }
        if (data.seats < trip.reserved) throw new ApiError(409, 'Conserva al menos los cupos que ya están reservados.');
        db.prepare('UPDATE trips SET origin=?,destination=?,departure=?,seats=?,cost=?,notes=?,demo=0 WHERE id=?')
          .run(data.origin, data.destination, data.departure, data.seats, data.cost, data.notes, id);
      });
      return respond(res, { trip: presentTrip(findTrip(id, account), account) });
    }
    throw new ApiError(405, 'Esta acción no está disponible.');
  } catch (error) {
    if (error instanceof ApiError) return respond(res, { error: error.message }, error.status);
    console.error(error);
    respond(res, { error: 'Ocurrió un error. Intenta de nuevo.' }, 500);
  }
}
