import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readBackup, BackupError } from '../src/backup.js';

async function start() {
  const db = await openDb({ url: ':memory:' });
  const server = createApp({ db, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0 }).listen(0);
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
  return { db, server, client };
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const file = (text) => { const fd = new FormData(); fd.append('file', new Blob([text]), 'cartera.json'); return { method: 'POST', body: fd }; };
const strip = ({ exported_at: _e, ...rest }) => rest;

test('copia: lo descargado se restaura idéntico tras borrar los datos', async () => {
  const { db, server, client } = await start();
  const call = client();
  await call('/api/auth/demo', { method: 'POST' });
  const pf = (await call('/api/portfolio')).body;
  const isin = pf.positions[0].isin;
  await call('/api/alerts', json('POST', { isin, dir: 'above', price: 500 }));
  await call('/api/targets', json('PUT', { targets: { [isin]: 40 } }));
  await call(`/api/prices/${isin}`, json('PUT', { price: 123.45 }));
  await call('/api/categories', json('PUT', { merchant: 'MERCADONA', category: 'super' }));
  // Una operación quitada a mano sigue quitada después de restaurar.
  const before = (await call('/api/export')).body;
  const divTid = before.transactions.find((t) => t.type === 'DIVIDEND').transaction_id;
  assert.equal((await call(`/api/transactions/${divTid}`, { method: 'DELETE' })).status, 200);

  const dump = (await call('/api/export')).body;
  assert.ok(dump.transactions.some((t) => t.deleted_at));
  const text = JSON.stringify(dump);

  await call('/api/data', { method: 'DELETE' });
  assert.equal((await call('/api/portfolio')).body.positions.length, 0);

  const pre = (await call('/api/import?preview=1', file(text))).body.preview;
  assert.equal(pre.current, 0);
  assert.equal(pre.transactions, dump.transactions.length - 1);
  assert.equal(pre.removed, 1);
  assert.deepEqual([pre.alerts, pre.targets, pre.prices, pre.categories], [1, 1, 1, 1]);
  assert.equal((await call('/api/portfolio')).body.positions.length, 0, 'la vista previa no guarda nada');

  const done = await call('/api/import', file(text));
  assert.equal(done.status, 200);
  assert.equal(done.body.positions.length, pf.positions.length);
  assert.deepEqual(strip((await call('/api/export')).body), strip(dump));
  // Restaurar dos veces deja lo mismo: sustituye, no acumula.
  await call('/api/import', file(text));
  assert.deepEqual(strip((await call('/api/export')).body), strip(dump));
  server.close(); db.close();
});

test('copia: un archivo que no es una copia se rechaza y no toca nada; cada cuenta restaura solo la suya', async () => {
  const { db, server, client } = await start();
  const a = client(), b = client();
  await a('/api/auth/demo', { method: 'POST' });
  await b('/api/auth/demo', { method: 'POST' });
  const mine = (await a('/api/export')).body;
  for (const bad of ['no es json', '{"app":"otra","transactions":[]}', JSON.stringify({ app: 'cartera', version: 99, transactions: [] }),
    JSON.stringify({ app: 'cartera', version: 2, transactions: [{ transaction_id: 'x', date: 'ayer', type: 'BUY' }] })]) {
    const r = await a('/api/import', file(bad));
    assert.equal(r.status, 400, bad);
    assert.ok(r.body.error);
  }
  assert.equal((await a('/api/export')).body.transactions.length, mine.transactions.length);
  assert.equal((await client()('/api/import', file(JSON.stringify(mine)))).status, 401);

  // Una copia vacía deja la cuenta vacía, pero solo esa cuenta.
  await a('/api/import', file(JSON.stringify({ app: 'cartera', version: 2, transactions: [] })));
  assert.equal((await a('/api/export')).body.transactions.length, 0);
  assert.equal((await b('/api/export')).body.transactions.length, mine.transactions.length);
  server.close(); db.close();
});

test('copia: se limpia lo que no encaja', () => {
  const b = readBackup(JSON.stringify({
    app: 'cartera', version: 2,
    transactions: [
      { transaction_id: 't1', date: '2025-01-02', type: 'BUY', user_id: 'otro', extra: 'x', name: 'A'.repeat(900), source: 'raro' },
      { transaction_id: 't1', date: '2025-01-02', type: 'BUY' },
    ],
    prices: [{ isin: 'us1', price: '12,5' }, { isin: 'US2', price: -1 }],
    alerts: [{ isin: 'US1', dir: 'sideways', price: 3 }, { isin: 'US1', dir: 'below', price: 3 }],
    targets: [{ isin: 'US1', weight: 140 }, { isin: 'US1', weight: 40 }],
    merchant_categories: [{ merchant: 'X', category: 'DROP TABLE' }, { merchant: 'Y', category: 'ocio' }],
  }));
  assert.equal(b.transactions.length, 1);
  assert.equal(b.transactions[0].user_id, undefined);
  assert.equal(b.transactions[0].extra, undefined);
  assert.equal(b.transactions[0].name.length, 500);
  assert.equal(b.transactions[0].source, 'csv');
  assert.deepEqual(b.prices.map((p) => [p.isin, p.price]), [['US1', 12.5]]);
  assert.deepEqual(b.alerts.map((a) => a.dir), ['below']);
  assert.deepEqual(b.targets, [{ isin: 'US1', weight: 40 }]);
  assert.deepEqual(b.merchant_categories, [{ merchant: 'Y', category: 'ocio' }]);
  assert.throws(() => readBackup('[]'), BackupError);
});
