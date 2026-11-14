import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createLog } from '../src/log.js';

test('salud: comprueba la base de datos y pasa a 503 al apagar; los errores llevan identificador', async () => {
  const db = await openDb({ url: ':memory:' });
  const lines = [];
  const log = createLog({ json: true, out: { log: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) } });
  let broken = false;
  const flaky = { ...db, ping: () => (broken ? Promise.reject(new Error('caída')) : db.ping()), getUser: (id) => { if (broken) throw new Error('caída'); return db.getUser(id); } };
  const app = createApp({ db: flaky, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0, log });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
  const demo = await fetch(`${base}/api/auth/demo`, { method: 'POST' });
  const cookie = demo.headers.get('set-cookie').split(';')[0];

  broken = true;
  assert.equal((await fetch(`${base}/api/health`)).status, 503);
  const res = await fetch(`${base}/api/alerts`, { method: 'DELETE', headers: { cookie } });
  // (ruta inexistente con sesión: el fallo salta al leer el usuario)
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.id, res.headers.get('x-request-id'));
  const entry = JSON.parse(lines.at(-1));
  assert.equal(entry.level, 'error');
  assert.equal(entry.id, body.id);
  assert.equal(entry.path, '/api/alerts');
  assert.match(entry.stack, /caída/);

  broken = false;
  app.locals.closing = true;
  const closing = await fetch(`${base}/api/health`);
  assert.equal(closing.status, 503);
  assert.equal((await closing.json()).closing, true);
  server.close(); db.close();
});

test('registro: texto en desarrollo, una línea JSON con campos en producción', () => {
  const out = [];
  const sink = { log: (...a) => out.push(a), warn: (...a) => out.push(a), error: (...a) => out.push(a) };
  createLog({ json: false, out: sink }).info('hola', 3);
  assert.deepEqual(out[0], ['hola', 3]);
  createLog({ json: true, out: sink }).warn('Lenta:', 'GET /x', { ms: 12 });
  const e = JSON.parse(out[1][0]);
  assert.deepEqual([e.level, e.msg, e.ms], ['warn', 'Lenta: GET /x', 12]);
});

test('validación: activos, fechas y tamaños de lo que llega', async () => {
  const db = await openDb({ url: ':memory:' });
  const server = createApp({ db, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0 }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${base}/api/auth/demo`, { method: 'POST' })).headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return [res.status, (await res.json().catch(() => ({}))).error];
  };
  const long = 'X'.repeat(21);
  assert.deepEqual(await call('PUT', `/api/prices/${long}`, { price: 1 }), [400, 'Activo no válido.']);
  assert.deepEqual(await call('PUT', '/api/valuations/US0378331005/2025-02-30x', { price: 1 }), [400, 'Fecha no válida.']);
  assert.deepEqual(await call('PUT', '/api/valuations/US0378331005/2025-02-03', { price: -1 }), [400, 'Precio no válido.']);
  assert.equal((await call('PUT', '/api/valuations/US0378331005/2025-02-03', { price: '12,5' }))[0], 200);
  assert.deepEqual(await call('POST', '/api/alerts', { isin: long, dir: 'above', price: 1 }), [400, 'Alerta no válida.']);
  assert.deepEqual(await call('DELETE', '/api/alerts/1;DROP'), [400, 'Alerta no válida.']);
  assert.deepEqual(await call('POST', '/api/alerts', { isin: 'US0378331005', dir: 'move', price: 150 }), [400, 'Alerta no válida.']);
  assert.equal((await call('POST', '/api/alerts', { isin: 'US0378331005', dir: 'move', price: 5 }))[0], 200);
  assert.deepEqual(await call('PUT', '/api/targets', { targets: { [long]: 10 } }), [400, 'Activo no válido.']);
  assert.deepEqual(await call('PUT', '/api/targets', {}), [400, 'Faltan pesos.']);
  assert.deepEqual(await call('PUT', '/api/prices', { prices: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`A${i}`, 1])) }), [400, 'Demasiados precios en una sola petición.']);
  assert.equal((await call('PUT', '/api/prices', { prices: { US0378331005: 10 } }))[0], 200);
  assert.equal((await call('PUT', '/api/targets', { targets: { US0378331005: 25 } }))[0], 200);
  server.close(); db.close();
});
