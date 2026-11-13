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
