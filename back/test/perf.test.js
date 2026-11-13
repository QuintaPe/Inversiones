import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const HEAD = '"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"';
const CSV = [
  HEAD,
  '"2025-01-01T10:00:00Z","2025-01-01","TRADING","BUY","STOCK","Acme","XX0000000001","10","10","-100.00","-1.00","","Buy","t-1"',
].join('\n');

async function start({ cache = true } = {}) {
  const db = await openDb({ url: ':memory:', cache });
  let calls = 0;
  const quotes = {
    async quoteIsins(isins) {
      calls++;
      return { quotes: Object.fromEntries(isins.map((i) => [i, { price: 25, info: { symbol: 'ACME' } }])), resolved: {}, failed: [] };
    },
  };
  const app = createApp({ db, verifyGoogle: async (c) => ({ id: c, email: `${c}@example.com` }), quotes, googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = async (id) => {
    const res = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: id }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const call = async (path, opts = {}) => {
      const r = await fetch(base + path, { ...opts, headers: { ...opts.headers, cookie } });
      return { status: r.status, headers: r.headers, body: await r.json() };
    };
    call.raw = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...opts.headers, cookie } });
    return call;
  };
  const upload = (csv = CSV) => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'export.csv');
    return { method: 'POST', body: fd };
  };
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { app, db, client, upload, json, calls: () => calls, stop: () => { app.locals.stream?.close(); server.close(); db.close(); } };
}

/** Lee eventos SSE hasta que `until` devuelva true. */
async function readEvents(res, until) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = '';
  while (!until(events)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (ev) events.push({ event: ev, data: JSON.parse(data) });
    }
  }
  reader.cancel();
  return events;
}

test('las respuestas llevan Server-Timing con la base de datos y el cálculo', async () => {
  const { client, upload, stop } = await start();
  const me = await client('u1');
  await me('/api/upload', upload());
  const r = await me('/api/portfolio');
  const st = r.headers.get('server-timing');
  assert.match(st, /db;dur=[\d.]+;desc="Base de datos \(\d+\)"/);
  assert.match(st, /total;dur=[\d.]+/);
  assert.equal(r.body.positions[0].sh, 10);
  stop();
});

test('la caché de operaciones se invalida al añadir, quitar y restaurar', async () => {
  for (const cache of [true, false]) {
    const { client, upload, json, stop } = await start({ cache });
    const me = await client('u1');
    await me('/api/upload', upload());
    const v0 = (await me('/api/portfolio')).body.meta.v;
    const add = await me('/api/transactions', json('POST', { type: 'BUY', isin: 'XX0000000001', name: 'Acme', date: '2025-02-01', shares: 5, price: 12 }));
    assert.equal(add.body.positions[0].sh, 15);
    assert.notEqual(add.body.meta.v, v0);
    assert.equal((await me('/api/portfolio')).body.positions[0].sh, 15);
    await me('/api/transactions/t-1', { method: 'DELETE' });
    assert.equal((await me('/api/portfolio')).body.positions[0].sh, 5);
    await me('/api/transactions/t-1/restore', { method: 'POST' });
    assert.equal((await me('/api/portfolio')).body.positions[0].sh, 15);
    await me('/api/data', { method: 'DELETE' });
    assert.equal((await me('/api/portfolio')).body.positions.length, 0);
    stop();
  }
});

test('las posiciones de un usuario no se mezclan con las de otro', async () => {
  const { client, upload, stop } = await start();
  const a = await client('a'), b = await client('b');
  await a('/api/upload', upload());
  assert.equal((await a('/api/portfolio')).body.positions.length, 1);
  assert.equal((await b('/api/portfolio')).body.positions.length, 0);
  stop();
});

test('getUserState devuelve lo mismo que las consultas por separado', async () => {
  const db = await openDb({ url: ':memory:' });
  await db.upsertUser({ id: 'u', email: 'u@x' });
  await db.addAlert('u', { isin: 'X', dir: 'above', price: 10 });
  await db.setTargets('u', { X: 50 });
  await db.setPrices('u', { X: 12 });
  const s = await db.getUserState('u');
  assert.deepEqual(s.alerts, await db.getAlerts('u'));
  assert.deepEqual(s.targets, await db.getTargets('u'));
  assert.deepEqual(s.prices, await db.getPrices('u'));
  assert.deepEqual(s.lastUpload, await db.lastUpload('u'));
  db.close();
});

test('el histórico se guarda por lotes y los splits nuevos cambian la versión', async () => {
  const db = await openDb({ url: ':memory:' });
  const rows = Array.from({ length: 950 }, (_, i) => [new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10), 100 + i]);
  await db.saveHistory('ACME', { currency: 'EUR', from: rows[0][0], rows, divs: [['2020-06-01', 1]], splits: [] });
  assert.equal((await db.getHistory(['ACME'])).ACME.length, 950);
  const v0 = db.splitsVersion();
  await db.saveHistory('ACME', { currency: 'EUR', from: rows[0][0], rows: rows.slice(-5), splits: [['2021-01-04', 4]] });
  assert.equal(db.splitsVersion(), v0 + 1);
  assert.deepEqual((await db.getSplits()).ACME, [['2021-01-04', 4]]);
  // El mismo split otra vez no es nuevo.
  await db.saveHistory('ACME', { currency: 'EUR', from: rows[0][0], rows: rows.slice(-5), splits: [['2021-01-04', 4]] });
  assert.equal(db.splitsVersion(), v0 + 1);
  db.close();
});

test('el canal envía las cotizaciones a cada usuario y una sola consulta para todos', async () => {
  const { app, client, upload, json, calls, stop } = await start();
  const a = await client('a'), b = await client('b');
  await a('/api/upload', upload());
  await b('/api/upload', upload());
  await a('/api/alerts', json('POST', { isin: 'XX0000000001', dir: 'above', price: 22 }));
  const [ra, rb] = await Promise.all([a.raw('/api/stream'), b.raw('/api/stream')]);
  assert.equal(ra.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const before = calls();
  const evA = readEvents(ra, (evs) => evs.some((e) => e.event === 'quotes'));
  const evB = readEvents(rb, (evs) => evs.some((e) => e.event === 'quotes'));
  await new Promise((r) => setTimeout(r, 50)); // las dos conexiones registradas
  assert.equal(app.locals.stream.connected(), 2);
  await app.locals.stream.tick();
  const qa = (await evA).find((e) => e.event === 'quotes').data;
  const qb = (await evB).find((e) => e.event === 'quotes').data;
  assert.equal(calls() - before, 1);
  assert.equal(qa.prices.XX0000000001.price, 25);
  assert.equal(qa.fired.length, 1);
  assert.equal(qa.alerts[0].triggered_at != null, true);
  assert.equal(qb.fired.length, 0);
  // La cotización queda guardada para la siguiente carga.
  assert.equal((await a('/api/portfolio')).body.positions[0].price, 25);
  stop();
});

test('las demás pestañas se enteran de que cambian las operaciones', async () => {
  const { client, upload, json, stop } = await start();
  const me = await client('u');
  await me('/api/upload', upload());
  const res = await me.raw('/api/stream');
  const evs = readEvents(res, (list) => list.some((e) => e.event === 'changed'));
  await new Promise((r) => setTimeout(r, 50));
  const add = await me('/api/transactions', json('POST', { type: 'BUY', isin: 'XX0000000001', name: 'Acme', date: '2025-02-01', shares: 1, price: 12 }));
  const changed = (await evs).find((e) => e.event === 'changed');
  assert.equal(changed.data.v, add.body.meta.v);
  stop();
});

test('el refresco devuelve los precios nuevos y las alertas saltadas sin releer la cartera', async () => {
  const { client, upload, json, stop } = await start();
  const me = await client('u');
  await me('/api/upload', upload());
  await me('/api/alerts', json('POST', { isin: 'XX0000000001', dir: 'above', price: 22 }));
  const r = await me('/api/quotes/refresh', { method: 'POST' });
  assert.equal(r.body.positions[0].price, 25);
  assert.equal(r.body.positions[0].priceSource, 'live');
  assert.equal(r.body.fired.length, 1);
  assert.equal(r.body.alerts[0].triggered_at, r.body.refresh.at);
  const again = await me('/api/portfolio');
  assert.equal(again.body.positions[0].price, 25);
  assert.ok(again.body.alerts[0].triggered_at);
  stop();
});

test('los eventos viajan aparte, con huella y 304 si no han cambiado', async () => {
  const { client, upload, json, stop } = await start();
  const me = await client('u');
  await me('/api/upload', upload());
  const pf = (await me('/api/portfolio')).body;
  assert.equal(pf.positions[0].evs, undefined);
  assert.equal(pf.positions[0].nev, 1);
  const r1 = await me.raw('/api/events');
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('etag'), pf.meta.ev);
  const ev = await r1.json();
  assert.equal(ev.evs.XX0000000001[0].k, 'B');
  assert.equal(ev.lots.XX0000000001[0].sh, 10);
  const r2 = await me.raw('/api/events', { headers: { 'if-none-match': pf.meta.ev, 'cache-control': 'max-age=0' } });
  assert.equal(r2.status, 304);
  // Una operación nueva cambia la huella.
  const add = await me('/api/transactions', json('POST', { type: 'BUY', isin: 'XX0000000001', name: 'Acme', date: '2025-02-01', shares: 1, price: 12 }));
  assert.notEqual(add.body.meta.ev, pf.meta.ev);
  const r3 = await me.raw('/api/events', { headers: { 'if-none-match': pf.meta.ev, 'cache-control': 'max-age=0' } });
  assert.equal(r3.status, 200);
  assert.equal((await r3.json()).evs.XX0000000001.length, 2);
  stop();
});

test('sin servicio de logotipos el 404 no se guarda en caché', async () => {
  const { client, stop } = await start();
  const me = await client('u');
  const r = await me.raw('/api/logos/US0378331005');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  stop();
});
