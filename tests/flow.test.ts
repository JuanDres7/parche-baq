import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import { locationDistance } from '../src/client/places.ts';

test('Búsqueda por nombre, barrio, alias y proximidad', () => {
  assert.equal(locationDistance('Uninorte', 'uninorte'), 0);
  assert.equal(locationDistance('Barrio Abajo', 'portal'), 0);
  assert.equal(locationDistance('Malecon', 'malecon'), 0);
  assert.equal(locationDistance('', 'portal'), 0);
  assert.equal(locationDistance('lugar inexistente', 'portal'), Infinity);
  const distance = locationDistance('Buenavista', 'viva');
  assert.ok(distance > 0 && distance < 1.5);
  assert.ok(locationDistance('Buenavista', 'portal') > 1.5);
});

process.env.PARCHE_DB = ':memory:';
const { api } = await import('../src/api.ts');
const { db } = await import('../src/database.ts');

test('Cuentas, rutas, reservas simultáneas y cancelaciones', async t => {
  const server = createServer((req, res) => api(req, res, new URL(req.url!, 'http://localhost')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api`;

  function client() {
    let cookie = '';
    return async (path: string, method = 'GET', data?: object) => {
      const headers = new Headers();
      if (cookie) headers.set('cookie', cookie);
      if (data) headers.set('content-type', 'application/json');
      const res = await fetch(`${base}${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined });
      const token = res.headers.getSetCookie()[0];
      if (token) cookie = token.split(';')[0];
      return { code: res.status, body: await res.json() };
    };
  }

  const driver = client(), passenger = client(), other = client(), guest = client();
  const institution = 'Universidad Libre';
  const password = 'Ejemplo123!';
  const account = { name: 'Ana de Prueba', email: 'ana@ejemplo.test', institution, password };
  assert.equal((await driver('/register', 'POST', account)).code, 201);
  assert.equal((await guest('/register', 'POST', account)).code, 409);
  assert.equal((await passenger('/register', 'POST', { ...account, email: 'otra@ejemplo.test' })).code, 201);
  assert.equal((await other('/register', 'POST', { ...account, email: 'tercera@ejemplo.test' })).code, 201);
  assert.equal((await driver('/session')).body.user.name, account.name);
  const updated = await driver('/profile', 'PATCH', { ...account, email: 'ana.nueva@ejemplo.test', name: 'Ana Gómez', vehicle: 'Kia blanco', bio: 'Hola' });
  assert.equal(updated.body.user.vehicle, 'Kia blanco');
  assert.equal((await driver('/password', 'PATCH', { current: 'equivocada', password: 'Actualizada123' })).code, 400);
  assert.equal((await driver('/password', 'PATCH', { current: password, password: 'Actualizada123' })).code, 200);
  await driver('/logout', 'POST');
  assert.equal((await driver('/session')).body.user, null);
  assert.equal((await driver('/login', 'POST', { email: 'ana.nueva@ejemplo.test', password })).code, 401);
  assert.equal((await driver('/login', 'POST', { email: 'ana.nueva@ejemplo.test', password: 'Actualizada123' })).code, 200);

  const departure = new Date(Date.now() + 86400000 - 18000000).toISOString().slice(0, 16);
  const details = { origin: 'buenavista', destination: 'unilibre', departure, seats: 1, cost: 18000, notes: 'Portería' };
  assert.equal((await guest('/trips', 'POST', details)).code, 401);
  assert.equal((await driver('/trips', 'POST', { ...details, destination: details.origin })).code, 400);
  const published = await driver('/trips', 'POST', details);
  assert.equal(published.code, 201);
  const id = published.body.trip.id;
  const path = `/trips/${id}`;
  assert.equal((await driver(`${path}/reservation`, 'POST')).code, 400);
  assert.equal((await passenger(path, 'PATCH', details)).code, 403);
  const result = await Promise.all([passenger(`${path}/reservation`, 'POST'), other(`${path}/reservation`, 'POST')]);
  assert.deepEqual(result.map(item => item.code).sort(), [200, 409]);
  const winner = result[0].code === 200 ? passenger : other;
  assert.equal((await winner(`${path}/reservation`, 'POST')).body.trip.reserved, 1);
  const pay = path + '/payment';
  assert.equal((await driver(pay, 'POST', { amount: 9000 })).code, 403);
  assert.equal((await winner(pay, 'POST', { amount: 500 })).code, 409);
  const paid = (await winner(pay, 'POST', { amount: 9000 })).body.trip.payment;
  assert.equal(paid.amount, 9000);
  assert.ok(paid.receipt);
  assert.deepEqual((await winner(pay, 'POST', { amount: 9000 })).body.trip.payment, paid);
  assert.deepEqual((await winner('/my-trips')).body.trips.find((trip: { id: number }) => trip.id === id).payment, paid);
  assert.equal((await guest(path)).body.trip.payment, null);
  assert.equal((await driver(path)).body.riders.length, 1);
  assert.deepEqual((await guest(path)).body.riders, []);
  assert.equal((await driver(path, 'PATCH', { ...details, cost: 16000 })).code, 409);
  assert.equal((await driver(path, 'PATCH', { ...details, seats: 2 })).body.trip.seats, 2);
  assert.equal((await winner(`${path}/reservation`, 'DELETE')).body.trip.reserved, 0);
  assert.equal((await winner(`${path}/reservation`, 'POST')).body.trip.payment, null);
  assert.equal((await driver(path, 'DELETE')).body.trip.status, 'cancelled');
  assert.equal((await guest(path)).code, 404);
  assert.equal((await winner('/my-trips')).body.trips.find((trip: { id: number }) => trip.id === id).status, 'cancelled');
  assert(!(await guest('/trips')).body.trips.some((trip: { id: number }) => trip.id === id));
  assert.equal((await winner(path + '/rating', 'PUT', { stars: 5 })).code, 409);

  const completed = (await driver('/trips', 'POST', { ...details, seats: 2 })).body.trip;
  const ride = '/trips/' + completed.id;
  const rate = ride + '/rating';
  await passenger(ride + '/reservation', 'POST');
  await other(ride + '/reservation', 'POST');
  assert.equal((await passenger(rate, 'PUT', { stars: 5 })).code, 409);
  db.prepare('UPDATE trips SET departure=? WHERE id=?').run(new Date(Date.now() - 3600000).toISOString(), completed.id);
  assert.equal((await driver(rate, 'PUT', { stars: 5 })).code, 403);
  assert.equal((await guest(rate, 'PUT', { stars: 5 })).code, 401);
  for (const stars of [-1, 2.5, 6, '5']) {
    assert.equal((await passenger(rate, 'PUT', { stars })).code, 400);
  }
  const zero = (await passenger(rate, 'PUT', { stars: 0 })).body.trip;
  assert.equal(zero.rating, 0);
  assert.deepEqual(zero.driverRating, { average: 0, count: 1 });
  assert.equal((await other(rate, 'PUT', { stars: 5 })).code, 200);
  assert.deepEqual((await guest(ride)).body.trip.driverRating, { average: 2.5, count: 2 });
  await other(rate, 'PUT', { stars: 4 });
  assert.deepEqual((await driver(ride)).body.trip.driverRating, { average: 2, count: 2 });
  assert.equal((await guest(ride)).body.trip.rating, null);
  const nextTrip = await driver('/trips', 'POST', details);
  assert.deepEqual(nextTrip.body.trip.driverRating, { average: 2, count: 2 });
});
