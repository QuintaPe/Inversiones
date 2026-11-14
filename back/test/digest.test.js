import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createPush } from '../src/push.js';
import { digestText, periodKey } from '../src/digest.js';

test('resumen: periodo en curso (lunes de la semana o día 1 del mes)', () => {
  const at = (s) => Date.parse(s);
  assert.equal(periodKey('week', at('2026-11-14T10:00:00Z')), '2026-11-09'); // sábado → su lunes
  assert.equal(periodKey('week', at('2026-11-09T00:00:00Z')), '2026-11-09');
  assert.equal(periodKey('week', at('2026-11-15T23:59:00Z')), '2026-11-09'); // domingo
  assert.equal(periodKey('week', at('2027-01-01T10:00:00Z')), '2026-12-28');
  assert.equal(periodKey('month', at('2026-11-14T10:00:00Z')), '2026-11-01');
});

test('resumen: el texto cuenta solo lo que se sabe', () => {
  assert.deepEqual(digestText({ every: 'week', value: 41131.93 }), { title: 'Tu semana en Cartera', body: 'Tu cartera vale 41.131,93 €.', url: '/resumen', tag: 'digest' });
  const full = digestText({ every: 'month', value: 1000, gain: -12.5, pct: -1.234, best: { name: 'NVIDIA', pct: 4.2 }, worst: { name: 'Inditex', pct: -2.1 }, drift: { name: 'Microsoft', points: 6.04 } });
  assert.equal(full.title, 'Tu mes en Cartera');
  assert.equal(full.body, 'Tu cartera vale 1.000,00 €. Este mes: −12,50 € (−1,23 %). Lo mejor: NVIDIA +4,20 %; lo peor: Inditex −2,10 %. Microsoft pesa 6 puntos más que su objetivo.');
  assert.match(digestText({ every: 'week', value: 1, best: { name: 'A', pct: 1 }, worst: { name: 'A', pct: 1 }, drift: { name: 'B', points: -7.5 } }).body, /A: \+1,00 %\. B pesa 7,5 puntos menos que su objetivo\.$/);
});

const csv = ['"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"',
  '"2024-01-02T10:00:00Z","2024-01-02","TRADING","BUY","STOCK","Acme","US0000000001","10","10","-100","-1.00","","Buy","t-1"',
  '"2024-01-03T10:00:00Z","2024-01-03","TRADING","BUY","STOCK","Beta","US0000000002","5","20","-100","-1.00","","Buy","t-2"'].join('\n');
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('resumen: se envía una vez por periodo a quien lo activa, con valor, resultado, movimientos y desvío', async () => {
  const db = await openDb({ url: ':memory:' });
  const sent = [];
  const push = await createPush({ db, send: async (_s, payload) => { sent.push(JSON.parse(payload)); } });
  const quotes = {
    async resolveIsins() { return {}; },
    async quoteIsins(isins) { return { quotes: Object.fromEntries(isins.map((i) => [i, { price: i.endsWith('1') ? 12 : 24 }])), resolved: {}, failed: [] }; },
    async history() { throw new Error('no debe descargar'); },
  };
  const app = createApp({ db, quotes, push, verifyGoogle: async (c) => ({ id: c, email: `${c}@x` }), googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'u' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (p, opts = {}) => { const r = await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } }); return { status: r.status, body: await r.json() }; };
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const digest = app.locals.digest;

  // Sin posiciones no hay nada que contar.
  assert.equal((await call('/api/digest/test', json('POST', {}))).status, 400);
  const fd = new FormData();
  fd.append('file', new Blob([csv]), 'a.csv');
  await call('/api/upload', { method: 'POST', body: fd });
  await db.addPushSub('u', { endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' });

  // Nadie lo ha activado todavía.
  assert.equal(await digest.run(), 0);
  assert.equal((await call('/api/settings/digest', json('PUT', { value: { every: 'day' } }))).status, 400);
  assert.deepEqual((await call('/api/settings/digest', json('PUT', { value: { every: 'week' } }))).body.settings.digest, { every: 'week' });

  // Histórico guardado (valía 200 hace diez días y no ha habido aportaciones), cierres y objetivos.
  const d = Array.from({ length: 12 }, (_, i) => day(11 - i));
  await db.saveHistoryCache('u', 'k', { d, v: d.map(() => 200), cost: d.map(() => 200), idx: d.map(() => 100), buy: d.map(() => 0), sell: d.map(() => 0), div: d.map(() => 0), benchmarks: [] });
  await db.saveSymbols({ US0000000001: { symbol: 'ACME', exchange: 'X' }, US0000000002: { symbol: 'BETA', exchange: 'X' } });
  await db.saveHistory('ACME', { currency: 'EUR', from: day(400), rows: [[day(9), 10], [day(1), 12]] });
  await db.saveHistory('BETA', { currency: 'EUR', from: day(400), rows: [[day(9), 25], [day(1), 24]] });
  await db.setTargets('u', { US0000000001: 40, US0000000002: 60 });

  assert.equal(await digest.run(), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Tu semana en Cartera');
  // 10 × 12 + 5 × 24 = 240: +40 € sobre 200 (+20 %); Acme +20 %, Beta −4 %; Acme pesa 50 % con objetivo 40 %.
  assert.equal(sent[0].body, 'Tu cartera vale 240,00 €. Esta semana: +40,00 € (+20,00 %). Lo mejor: Acme +20,00 %; lo peor: Beta −4,00 %. Acme pesa 10 puntos más que su objetivo.');
  // Una sola vez por periodo, y el estado interno no sale en los ajustes ni en la copia.
  assert.equal(await digest.run(), 0);
  assert.deepEqual((await call('/api/portfolio')).body.settings, { digest: { every: 'week' } });
  assert.deepEqual((await call('/api/export')).body.settings, [{ key: 'digest', value: { every: 'week' } }]);

  // «Enviar ahora» no depende del periodo.
  const now = await call('/api/digest/test', json('POST', { every: 'month' }));
  assert.equal(now.body.sent, 1);
  assert.equal(now.body.title, 'Tu mes en Cartera');
  assert.equal(sent.length, 2);
  // Desactivado: no se envía más.
  await call('/api/settings/digest', json('PUT', { value: null }));
  await db.setUserSetting('u', '_digest_sent', '2000-01-01');
  assert.equal(await digest.run(), 0);
  server.close();
  await db.close();
});
