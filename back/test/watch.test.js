import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

test('seguimiento y notas: se añaden por ISIN con su cotización, se cotizan con la cartera y viajan en la copia', async () => {
  const db = await openDb({ url: ':memory:' });
  const asked = [];
  const quotes = {
    async quoteIsins(isins, symbols) {
      asked.push(isins);
      const out = {}, resolved = {}, failed = [];
      for (const i of isins) {
        if (i === 'XX0000000009') { failed.push(i); continue; }
        if (symbols[i] === undefined) resolved[i] = { symbol: 'SYM', exchange: 'X', sector: null, industry: null };
        out[i] = { price: 42, info: { symbol: 'SYM', dayPct: 1.5 } };
      }
      return { quotes: out, resolved, failed };
    },
    async nameOf(isin) { return isin === 'US5949181045' ? 'Microsoft Corporation' : null; },
  };
  const server = createApp({ db, quotes, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0 }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${base}/api/auth/demo`, { method: 'POST' })).headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  assert.equal((await call('POST', '/api/watchlist', { isin: 'no' })).status, 400);
  assert.equal((await call('POST', '/api/watchlist', { isin: 'XX0000000009' })).status, 404);
  const added = await call('POST', '/api/watchlist', { isin: 'us5949181045' });
  assert.deepEqual(added.body.watch.map((w) => [w.isin, w.name, w.price, w.info.dayPct]), [['US5949181045', 'Microsoft Corporation', 42, 1.5]]);
  await call('POST', '/api/watchlist', { isin: 'DE0007164600', name: 'SAP' });
  assert.deepEqual((await call('GET', '/api/watchlist')).body.watch.map((w) => w.name), ['Microsoft Corporation', 'SAP']);

  // Al refrescar las cotizaciones de la cartera también se piden los valores en seguimiento.
  await call('POST', '/api/quotes/refresh');
  assert.ok(asked.at(-1).includes('DE0007164600'));

  const isin = (await call('GET', '/api/portfolio')).body.positions[0].isin;
  assert.equal((await call('PUT', `/api/notes/${isin}`, { note: 'x'.repeat(2001) })).status, 400);
  await call('PUT', `/api/notes/${isin}`, { note: '  Para largo plazo.  ' });
  assert.equal((await call('GET', '/api/portfolio')).body.positions.find((p) => p.isin === isin).note, 'Para largo plazo.');

  const dump = (await call('GET', '/api/export')).body;
  assert.deepEqual(dump.watchlist.map((w) => w.isin), ['DE0007164600', 'US5949181045']);
  assert.deepEqual(dump.asset_notes, [{ isin, note: 'Para largo plazo.' }]);
  await call('DELETE', '/api/data');
  assert.deepEqual((await call('GET', '/api/watchlist')).body.watch, []);
  const fd = new FormData(); fd.append('file', new Blob([JSON.stringify(dump)]), 'c.json');
  assert.equal((await fetch(`${base}/api/import`, { method: 'POST', headers: { cookie }, body: fd })).status, 200);
  assert.equal((await call('GET', '/api/watchlist')).body.watch.length, 2);
  assert.equal((await call('GET', '/api/portfolio')).body.positions.find((p) => p.isin === isin).note, 'Para largo plazo.');

  await call('PUT', `/api/notes/${isin}`, { note: '' });
  assert.equal((await call('GET', '/api/portfolio')).body.positions.find((p) => p.isin === isin).note, null);
  assert.deepEqual((await call('DELETE', '/api/watchlist/US5949181045')).body.watch.map((w) => w.isin), ['DE0007164600']);
  server.close(); db.close();
});
