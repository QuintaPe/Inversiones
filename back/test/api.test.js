import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { AuthError } from '../src/auth.js';

const CSV = [
  '"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"',
  '"2025-01-01T10:00:00Z","2025-01-01","TRADING","BUY","STOCK","Acme","XX0000000001","10","10","-100.00","-1.00","","Buy","t-1"',
  '"2025-01-02T10:00:00Z","2025-01-02","CASH","CARD_TRANSACTION","","Bar","","","","-5","","","Card","t-2"',
].join('\n');

async function start() {
  const db = await openDb({ url: ':memory:' });
  // Verificador falso: la credencial "ok:<id>" identifica al usuario <id>.
  const verifyGoogle = async (c) => {
    if (!c.startsWith('ok:')) throw new AuthError('token inválido');
    return { id: c.slice(3), email: `${c.slice(3)}@example.com`, name: 'Test' };
  };
  // Cotizaciones falsas: 20 € para todo ISIN que no empiece por ZZ.
  const quotes = {
    async quoteIsins(isins, known) {
      const out = { quotes: {}, resolved: {}, failed: [] };
      for (const isin of isins) {
        if (known[isin] === undefined) out.resolved[isin] = isin.startsWith('ZZ') ? null : { symbol: 'ACME', exchange: 'Test', sector: 'Technology', industry: 'Software' };
        if (isin.startsWith('ZZ')) out.failed.push(isin);
        else out.quotes[isin] = { price: 20, info: { symbol: 'ACME', currency: 'EUR', raw: 20, rate: 1 } };
      }
      return out;
    },
  };
  const server = createApp({ db, verifyGoogle, quotes, googleClientId: 'cid', sessionSecret: 'secreto-de-test' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, opts = {}) => {
      const res = await fetch(base + path, { ...opts, headers: { ...opts.headers, cookie } });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { client, json, stop: () => { server.close(); db.close(); } };
}
const form = () => {
  const fd = new FormData();
  fd.append('file', new Blob([CSV], { type: 'text/csv' }), 'export.csv');
  return { method: 'POST', body: fd };
};

test('sin sesión la API responde 401', async () => {
  const { client, json, stop } = await start();
  const anon = client();
  assert.equal((await anon('/api/portfolio')).status, 401);
  assert.equal((await anon('/api/upload', form())).status, 401);
  assert.equal((await anon('/api/auth/google', json('POST', { credential: 'malo' }))).status, 401);
  assert.equal((await anon('/api/me')).body.user, null);
  stop();
});

test('login, subida, precios y aislamiento entre usuarios', async () => {
  const { client, json, stop } = await start();
  const ana = client(), luis = client();
  assert.equal((await ana('/api/auth/google', json('POST', { credential: 'ok:ana' }))).status, 200);
  assert.equal((await ana('/api/me')).body.user.email, 'ana@example.com');

  const up = await ana('/api/upload', form());
  assert.equal(up.status, 200);
  assert.deepEqual([up.body.upload.total, up.body.upload.relevant, up.body.upload.added], [2, 1, 2]);
  assert.equal(up.body.meta.rows, 1, 'solo cuentan las operaciones de inversión');
  assert.equal(up.body.positions[0].cost, 101);
  assert.equal((await ana('/api/upload', form())).body.upload.added, 0, 'resubir no duplica');

  const px = await ana('/api/prices/XX0000000001', json('PUT', { price: '12,5' }));
  assert.equal(px.body.price, 12.5);
  assert.equal((await ana('/api/portfolio')).body.positions[0].price, 12.5);

  await luis('/api/auth/google', json('POST', { credential: 'ok:luis' }));
  assert.equal((await luis('/api/portfolio')).body.positions.length, 0, 'otro usuario no ve nada');

  await ana('/api/auth/logout', { method: 'POST' });
  assert.equal((await ana('/api/portfolio')).status, 401);
  stop();
});

test('borrar datos solo afecta al usuario', async () => {
  const { client, json, stop } = await start();
  const ana = client(), luis = client();
  await ana('/api/auth/google', json('POST', { credential: 'ok:ana' }));
  await luis('/api/auth/google', json('POST', { credential: 'ok:luis' }));
  await ana('/api/upload', form());
  await luis('/api/upload', form());
  assert.equal((await ana('/api/data', { method: 'DELETE' })).body.positions.length, 0);
  assert.equal((await luis('/api/portfolio')).body.positions.length, 1);
  stop();
});

test('cotización en vivo: rellena precios y no pisa los manuales', async () => {
  const { client, json, stop } = await start();
  const ana = client();
  await ana('/api/auth/google', json('POST', { credential: 'ok:ana' }));
  await ana('/api/upload', form());

  let r = await ana('/api/quotes/refresh', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refresh.updated, 1);
  assert.deepEqual([r.body.positions[0].price, r.body.positions[0].priceSource], [20, 'live']);
  assert.equal(r.body.positions[0].priceInfo.symbol, 'ACME');
  assert.deepEqual([r.body.positions[0].sector, r.body.positions[0].industry], ['Technology', 'Software']);

  await ana('/api/prices/XX0000000001', json('PUT', { price: 15 }));
  r = await ana('/api/quotes/refresh', { method: 'POST' });
  assert.deepEqual([r.body.positions[0].price, r.body.positions[0].priceSource], [15, 'manual'], 'el manual manda');

  await ana('/api/prices/XX0000000001', json('PUT', { price: '' }));
  r = await ana('/api/quotes/refresh', { method: 'POST' });
  assert.deepEqual([r.body.positions[0].price, r.body.positions[0].priceSource], [20, 'live'], 'al borrarlo vuelve el vivo');
  stop();
});

test('operaciones a mano: añadir, validar, borrar y restaurar', async () => {
  const { client, json, stop } = await start();
  const ana = client();
  await ana('/api/auth/google', json('POST', { credential: 'ok:ana' }));
  await ana('/api/upload', form());
  const op = { type: 'BUY', isin: 'yy0000000002', name: 'Beta', date: '2025-02-01', shares: '5', price: '20,5', fee: 1 };

  let r = await ana('/api/transactions', json('POST', op));
  assert.equal(r.status, 200);
  const beta = r.body.positions.find((p) => p.isin === 'YY0000000002');
  assert.deepEqual([beta.sh, beta.cost], [5, 103.5]);
  const tid = beta.evs[0].tid;
  assert.match(tid, /^manual-/);

  r = await ana('/api/transactions', json('POST', { ...op, type: 'SELL', shares: 9 }));
  assert.equal(r.status, 400, 'no se puede vender más de lo que hay');
  r = await ana('/api/transactions', json('POST', { ...op, date: '2999-01-01' }));
  assert.equal(r.status, 400, 'fecha futura');

  r = await ana(`/api/transactions/${tid}`, json('PUT', { ...op, shares: 6 }));
  assert.equal(r.body.positions.find((p) => p.isin === 'YY0000000002').sh, 6);
  r = await ana(`/api/transactions/${tid}`, { method: 'DELETE' });
  assert.equal(r.body.positions.some((p) => p.isin === 'YY0000000002'), false);

  // Una operación del CSV quitada no vuelve al resubir, pero se puede restaurar.
  r = await ana('/api/transactions/t-1', { method: 'DELETE' });
  assert.equal(r.body.positions.length, 0);
  assert.equal((await ana('/api/upload', form())).body.positions.length, 0);
  assert.equal((await ana('/api/transactions/removed')).body.removed.length, 1);
  r = await ana('/api/transactions/t-1/restore', { method: 'POST' });
  assert.equal(r.body.positions[0].cost, 101);
  stop();
});

test('efectivo: saldo reconstruido con todas las filas', async () => {
  const { client, json, stop } = await start();
  const ana = client();
  await ana('/api/auth/google', json('POST', { credential: 'ok:ana' }));
  await ana('/api/upload', form());
  const { cash } = (await ana('/api/cash')).body;
  assert.equal(cash.balance, -106); // −100 − 1 de la compra y −5 de tarjeta
  assert.equal(cash.totals.card, -5);
  stop();
});
