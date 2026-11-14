import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('sesión: cerrar en los demás dispositivos invalida sus cookies y conserva esta', async () => {
  const db = await openDb({ url: ':memory:' });
  const server = createApp({ db, verifyGoogle: async (c) => ({ id: c, email: `${c}@example.com` }), googleClientId: 'cid', sessionSecret: 's', slowMs: 0 }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const device = () => {
    let cookie = '';
    return async (p, opts = {}) => {
      const res = await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const login = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'ana' }) };
  const phone = device(), laptop = device(), other = device();
  await phone('/api/auth/google', login);
  await laptop('/api/auth/google', login);
  await other('/api/auth/google', { ...login, body: JSON.stringify({ credential: 'luis' }) });
  assert.deepEqual((await phone('/api/me')).body.user, { id: 'ana', email: 'ana@example.com', name: null, picture: null });

  assert.equal((await device()('/api/auth/logout-others', { method: 'POST' })).status, 401);
  assert.equal((await laptop('/api/auth/logout-others', { method: 'POST' })).status, 200);
  assert.equal((await laptop('/api/portfolio')).status, 200, 'el dispositivo que lo pide sigue dentro');
  assert.equal((await phone('/api/portfolio')).status, 401);
  assert.equal((await phone('/api/me')).body.user, null);
  assert.equal((await other('/api/portfolio')).status, 200, 'las sesiones de otros usuarios no se tocan');

  // Volver a entrar da una sesión con la versión nueva.
  await phone('/api/auth/google', login);
  assert.equal((await phone('/api/portfolio')).status, 200);

  // Una cookie anterior a las versiones (sin `v`) vale mientras no se cierren las sesiones.
  const old = `session=${jwt.sign({ sub: 'luis' }, 's', { algorithm: 'HS256', expiresIn: 60 })}`;
  assert.equal((await fetch(`${base}/api/portfolio`, { headers: { cookie: old } })).status, 200);
  await other('/api/auth/logout-others', { method: 'POST' });
  assert.equal((await fetch(`${base}/api/portfolio`, { headers: { cookie: old } })).status, 401);
  server.close(); db.close();
});

test('eliminar la cuenta: se van sus datos y el usuario, la sesión deja de valer y las demás cuentas siguen', async () => {
  const { openDb } = await import('../src/db.js');
  const { createApp } = await import('../src/app.js');
  const db = await openDb({ url: ':memory:' });
  const quotes = { paused: () => ({ 'query1.finance.yahoo.com': 42000 }), async quoteIsins() { return { quotes: {}, resolved: {}, failed: [] }; }, async resolveIsins() { return {}; } };
  const app = createApp({ db, quotes, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0 });
  app.locals.jobs = { status: () => [{ name: 'alertas', runs: 3 }] };
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (p, opts = {}) => {
      const res = await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const a = client(), b = client();
  const idA = (await a('/api/auth/demo', { method: 'POST' })).body.user.id;
  await b('/api/auth/demo', { method: 'POST' });
  await a('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Piso', kind: 'property', amount: 1 }) });
  await a('/api/settings/digest', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: { every: 'week' } }) });

  // Estado del servidor: fuentes en pausa y tareas programadas, solo con sesión.
  assert.equal((await client()('/api/status')).status, 401);
  assert.deepEqual((await a('/api/status')).body, { providers: { 'query1.finance.yahoo.com': 42000 }, jobs: [{ name: 'alertas', runs: 3 }] });
  // La cotización avisa de la fuente en pausa.
  assert.deepEqual((await a('/api/quotes/refresh', { method: 'POST' })).body.refresh.paused, ['query1.finance.yahoo.com']);

  assert.equal((await client()('/api/account', { method: 'DELETE' })).status, 401);
  assert.equal((await a('/api/account', { method: 'DELETE' })).status, 200);
  assert.equal((await a('/api/me')).body.user, null);
  assert.equal((await a('/api/portfolio')).status, 401);
  assert.equal(await db.getUser(idA), null);
  assert.deepEqual(await db.getAccounts(idA), []);
  assert.deepEqual(await db.getUserSettings(idA), {});
  assert.equal((await db.getRows(idA)).length, 0);
  assert.ok((await b('/api/portfolio')).body.positions.length > 0);
  server.close();
  await db.close();
});
