import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = process.env.PARCHE_DB ?? resolve('data/parche.sqlite');
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    institution TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
    demo INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL REFERENCES users(id), origin TEXT NOT NULL,
    destination TEXT NOT NULL, departure TEXT NOT NULL, seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 6),
    cost INTEGER NOT NULL CHECK (cost >= 0), notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')), demo INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS reservations (
    trip_id INTEGER NOT NULL REFERENCES trips(id), user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (trip_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    trip_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
    receipt TEXT NOT NULL UNIQUE, PRIMARY KEY (trip_id, user_id),
    FOREIGN KEY (trip_id, user_id) REFERENCES reservations(trip_id, user_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS ratings (
    trip_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    stars INTEGER NOT NULL CHECK(typeof(stars) = 'integer' AND stars BETWEEN 0 AND 5),
    PRIMARY KEY (trip_id, user_id),
    FOREIGN KEY (trip_id, user_id) REFERENCES reservations(trip_id, user_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS reservations_user ON reservations(user_id);
`);

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, value] = stored.split(':');
  const expected = Buffer.from(value, 'hex');
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

export function transaction<T>(run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function nextDayAt(offset: number, hour: number, minute: number): string {
  const local = new Date(Date.now() - 5 * 60 * 60 * 1000);
  local.setUTCDate(local.getUTCDate() + offset);
  local.setUTCHours(hour + 5, minute, 0, 0);
  return local.toISOString();
}

transaction(() => {
  if (db.prepare('SELECT id FROM users WHERE demo = 1 LIMIT 1').get()) return;
  const password = passwordHash('Parche123');
  const user = db.prepare('INSERT INTO users (name,email,password,institution,vehicle,demo) VALUES (?,?,?,?,?,1)');
  const valeria = user.run('Valeria Mendoza', 'valeria@parche.test', password, 'Universidad del Norte', 'Kia Picanto blanco').lastInsertRowid;
  const mateo = user.run('Mateo Torres', 'mateo@parche.test', password, 'Universidad Libre', 'Renault Sandero gris').lastInsertRowid;
  const juan = user.run('Juan Acosta', 'juan@parche.test', password, 'Universidad del Atlántico', 'Mazda 2 azul').lastInsertRowid;
  const sofia = user.run('Sofía Ríos', 'sofia@parche.test', password, 'Universidad Libre', '').lastInsertRowid;
  const trip = db.prepare('INSERT INTO trips (driver_id,origin,destination,departure,seats,cost,notes,demo) VALUES (?,?,?,?,?,?,?,1)');
  const reserve = db.prepare('INSERT INTO reservations (trip_id,user_id) VALUES (?,?)');
  const first = trip.run(valeria, 'buenavista', 'uninorte', nextDayAt(1, 7, 15), 3, 12000, 'Nos encontramos frente a la entrada principal de Buenavista 1.').lastInsertRowid;
  reserve.run(first, juan);
  const second = trip.run(mateo, 'portal', 'unilibre', nextDayAt(1, 8, 0), 4, 18000, 'Punto de encuentro junto a la entrada de la carrera 53.').lastInsertRowid;
  reserve.run(second, juan);
  trip.run(juan, 'viva', 'uniatlantico', nextDayAt(1, 12, 30), 3, 15000, 'Salida desde la bahía sobre la carrera 51B.');
  trip.run(valeria, 'uninorte', 'malecon', nextDayAt(2, 16, 20), 3, 14000, 'Salimos por la portería principal del campus.');
  trip.run(mateo, 'miramar', 'unisimon', nextDayAt(2, 7, 30), 3, 16000, 'Encuentro en la entrada del centro comercial Miramar.');
  const booked = trip.run(juan, 'uniatlantico', 'viva', nextDayAt(2, 17, 0), 2, 18000, 'Espérame en la portería principal.').lastInsertRowid;
  reserve.run(booked, sofia);
  trip.run(mateo, 'unilibre', 'portal', nextDayAt(3, 16, 0), 4, 18000, 'Regreso desde Sede Norte.');
});

// Keep the sample rides usable when the demonstration is opened again on a later date.
export function refreshDemo(): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO trips (driver_id, origin, destination, departure, seats, cost, notes)
    SELECT u.id, 'unilibre', 'malecon', ?, 3, 15000, 'Salida de ejemplo desde la portería principal.'
    FROM users u
    WHERE u.demo=1 AND u.email='mateo@parche.test'
      AND NOT EXISTS (
        SELECT 1 FROM trips t WHERE t.driver_id=u.id AND t.demo=0
          AND t.status='active' AND t.departure<=?
      )
  `).run(nextDayAt(-2, 16, 0), now);
  db.exec(`
    INSERT OR IGNORE INTO reservations (trip_id, user_id)
    SELECT t.id, passenger.id
    FROM trips t
    JOIN users driver ON driver.id = t.driver_id
    JOIN users passenger ON passenger.email='sofia@parche.test' AND passenger.demo=1
    WHERE driver.email='mateo@parche.test' AND driver.demo=1 AND t.demo=0
      AND t.origin='unilibre' AND t.destination='malecon'
      AND t.notes='Salida de ejemplo desde la portería principal.'
  `);
  const row = db.prepare('SELECT MIN(departure) AS first FROM trips WHERE demo=1 AND status=\'active\'').get();
  if (typeof row?.first !== 'string' || row.first > now) return;
  const days = Math.ceil((Date.parse(nextDayAt(1, 7, 15)) - Date.parse(row.first)) / 86400000);
  db.prepare(`UPDATE trips SET departure=strftime('%Y-%m-%dT%H:%M:%fZ', departure, ?) WHERE demo=1 AND status='active'`).run(`+${days} days`);
}
