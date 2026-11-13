import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { demoRows } from '../src/demo.js';
import { buildPortfolio, buildCash } from '../src/engine.js';

test('la cartera de ejemplo es coherente: posiciones abiertas, ventas cubiertas y efectivo positivo', () => {
  const { rows, unknown } = demoRows(Date.parse('2026-11-13T12:00:00Z'));
  assert.deepEqual(unknown, {});
  const { positions } = buildPortfolio(rows);
  assert.ok(positions.length >= 8);
  assert.ok(positions.every((p) => p.sh > 0 && p.evs.every((e) => e.sa == null || e.sa > -1e-9)), 'ninguna venta deja acciones negativas');
  assert.ok(positions.some((p) => p.evs.some((e) => e.k === 'S')), 'hay alguna venta');
  assert.ok(positions.some((p) => p.evs.some((e) => e.k === 'D' && e.tax > 0)), 'hay dividendos con retención');
  const cash = buildCash(rows);
  assert.ok(Math.min(...cash.days.map((d) => d[1])) > 0, 'el efectivo nunca queda en negativo');
  assert.ok(rows.every((r) => r.date <= '2026-11-13'), 'nada en el futuro');
});

async function start(opts = {}) {
  const db = await openDb({ url: ':memory:' });
  const app = createApp({ db, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0, ...opts });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, db, base, stop: () => { server.close(); db.close(); } };
}

test('entrar con la cartera de ejemplo crea una cuenta con datos y sesión', async () => {
  const { base, db, app, stop } = await start();
  assert.equal((await (await fetch(`${base}/api/config`)).json()).demo, true);
  const res = await fetch(`${base}/api/auth/demo`, { method: 'POST' });
  const { user } = await res.json();
  assert.match(user.id, /^demo-/);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const pf = await (await fetch(`${base}/api/portfolio`, { headers: { cookie } })).json();
  assert.ok(pf.positions.length >= 8);
  assert.equal(pf.meta.lastUpload.name, 'cartera-de-ejemplo.csv');
  // Otra cuenta de ejemplo no ve los datos de la primera.
  const other = await fetch(`${base}/api/auth/demo`, { method: 'POST' });
  assert.notEqual((await other.json()).user.id, user.id);

  // Limpieza: las de más de una semana se borran con todos sus datos.
  assert.equal(await app.locals.cleanDemo(), 0, 'las recién creadas se quedan');
  const old = await db.staleUsers('demo-', new Date(Date.now() + 86400000).toISOString());
  assert.equal(old.length, 2);
  await db.deleteUsers(old);
  assert.equal(await db.getUser(user.id), null);
  assert.equal((await db.getRows(user.id)).length, 0);
  assert.equal((await fetch(`${base}/api/portfolio`, { headers: { cookie } })).status, 401);
  stop();
});

test('DEMO=0 desactiva la cartera de ejemplo', async () => {
  const { base, stop } = await start({ demo: false });
  assert.equal((await fetch(`${base}/api/auth/demo`, { method: 'POST' })).status, 404);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).demo, false);
  stop();
});
