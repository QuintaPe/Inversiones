// Esquema v2: migración de una base de datos anterior, escisiones, vista previa de la
// importación, copia de los datos y vigilancia de alertas con avisos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { openDb, SCHEMA_VERSION } from '../src/db.js';
import { parseCsv, buildPortfolio, buildCash, buildIncome } from '../src/engine.js';
import { createAlertWatcher } from '../src/alerts.js';
import { createPush } from '../src/push.js';
import { createApp } from '../src/app.js';

const HEAD = '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"';
const line = (o) => HEAD.split(',').map((h) => `"${o[h.slice(1, -1)] ?? ''}"`).join(',');
const CSV = [
  HEAD,
  line({ datetime: '2025-01-01T10:00:00Z', date: '2025-01-01', account_type: 'DEFAULT', category: 'TRADING', type: 'BUY', asset_class: 'STOCK', name: 'Matriz', symbol: 'US0000000001', shares: '10.0000000000', price: '10.000000', amount: '-100.000000', fee: '-1.00', currency: 'EUR', transaction_id: 't-1' }),
  line({ datetime: '2025-02-01T10:00:00Z', date: '2025-02-01', account_type: 'DEFAULT', category: 'CORPORATE_ACTION', type: 'SPIN_OFF', asset_class: 'STOCK', name: 'Escindida', symbol: 'US0000000002', shares: '2.5000000000', description: 'SPIN_OFF US0000000002', transaction_id: 't-2' }),
  line({ datetime: '2025-02-02T10:00:00Z', date: '2025-02-02', account_type: 'DEFAULT', category: 'CASH', type: 'CARD_TRANSACTION', amount: '-5.000000', currency: 'EUR', description: 'Bar', transaction_id: 't-3', counterparty_name: 'Bar Pepe', mcc_code: '5812' }),
  line({ datetime: '2025-02-03T10:00:00Z', date: '2025-02-03', account_type: 'DEFAULT', category: 'CASH', type: 'CARD_ORDERING_FEE', amount: '0.000000', fee: '-5.00', currency: 'EUR', transaction_id: 't-4' }),
  line({ datetime: '2025-02-04T10:00:00Z', date: '2025-02-04', account_type: 'DEFAULT', category: 'CASH', type: 'TIPO_NUEVO', amount: '1.000000', currency: 'EUR', transaction_id: 't-5' }),
  line({ datetime: '2025-03-01T10:00:00Z', date: '2025-03-01', account_type: 'DEFAULT', category: 'TRADING', type: 'SELL', asset_class: 'STOCK', name: 'Escindida', symbol: 'US0000000002', shares: '-1.0000000000', price: '8.000000', amount: '8.000000', fee: '-1.00', currency: 'EUR', transaction_id: 't-6' }),
].join('\n');

test('escisión: las acciones entran a coste cero y se pueden vender', () => {
  const { rows, invest, unknown } = parseCsv(CSV);
  assert.equal(invest, 3);
  assert.deepEqual(unknown, { TIPO_NUEVO: 1 });
  // De los pagos con tarjeta se guarda el comercio (name) y su MCC; nunca el concepto, ni el
  // IBAN o la referencia de una transferencia (no son columnas que se guarden).
  const card = rows.find((r) => r.transaction_id === 't-3');
  assert.equal(card.description, '');
  assert.equal(card.mcc_code, '5812');
  assert.equal(card.counterparty_iban, undefined);
  assert.equal(card.payment_reference, undefined);
  // Las operaciones de inversión no llevan MCC.
  assert.equal(rows.find((r) => r.type === 'BUY').mcc_code, '');
  assert.equal(rows[0].currency, 'EUR');

  const spun = buildPortfolio(rows).positions.find((p) => p.isin === 'US0000000002');
  assert.equal(spun.name, 'Escindida');
  assert.equal(spun.sh, 1.5);
  assert.equal(spun.cost, 0);
  const [entry, sale] = spun.evs;
  assert.equal(entry.spin, true);
  assert.equal(entry.net, 0);
  assert.equal(sale.reF, 7); // 8 − 1 de comisión, sin coste
  assert.equal(sale.re, 7);

  // La comisión de la tarjeta sale del efectivo como gasto de tarjeta, no como «otros».
  const cash = buildCash(rows);
  assert.equal(cash.totals.card, -10);
  // El extracto suma lo mismo que el saldo, y solo las operaciones con valor llevan nombre.
  assert.ok(Math.abs(cash.moves.reduce((t, m) => t + m[2], 0) - cash.ledger) < 0.01);
  for (const m of cash.moves) assert.equal(m.length === 4, m[1] === 'invest' || m[1] === 'dividend');
});

test('migración: una base de datos anterior conserva operaciones, quitadas y precios', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cartera-')), 'old.db');
  const url = `file:${file}`;
  const old = createClient({ url });
  const cols = ['transaction_id', 'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol', 'shares', 'price', 'amount', 'fee', 'tax', 'description', 'original_amount', 'original_currency', 'fx_rate'];
  await old.batch([
    'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT, created_at TEXT NOT NULL, last_login TEXT NOT NULL)',
    `CREATE TABLE transactions (user_id TEXT NOT NULL, ${cols.map((c) => `${c} TEXT NOT NULL DEFAULT ''`).join(', ')}, PRIMARY KEY (user_id, transaction_id))`,
    "CREATE TABLE prices (user_id TEXT NOT NULL, isin TEXT NOT NULL, price REAL NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', info TEXT, PRIMARY KEY (user_id, isin))",
    'CREATE TABLE removed (user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, row TEXT NOT NULL, removed_at TEXT NOT NULL, PRIMARY KEY (user_id, transaction_id))',
    'CREATE TABLE uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL, uploaded_at TEXT NOT NULL, total INTEGER NOT NULL, relevant INTEGER NOT NULL, added INTEGER NOT NULL)',
    "INSERT INTO users VALUES ('u', 'u@example.com', 'U', NULL, '2025-01-01', '2025-01-01')",
    "INSERT INTO transactions (user_id, transaction_id, datetime, date, category, type, name, symbol, shares, price, amount) VALUES ('u', 't-1', '2025-01-01T10:00:00Z', '2025-01-01', 'TRADING', 'BUY', 'Acme', 'XX0000000001', '10', '10', '-100.00')",
    "INSERT INTO transactions (user_id, transaction_id, datetime, date, category, type, name, symbol, shares, price, amount) VALUES ('u', 'manual-1', '2025-01-02T12:00:00Z', '2025-01-02', 'TRADING', 'BUY', 'Beta', 'XX0000000002', '1', '5', '-5.00')",
    `INSERT INTO removed VALUES ('u', 't-9', '${JSON.stringify({ transaction_id: 't-9', datetime: '2025-01-03T10:00:00Z', date: '2025-01-03', category: 'TRADING', type: 'BUY', name: 'Gamma', symbol: 'XX0000000003', shares: '1', price: '1', amount: '-1.00' })}', '2025-02-01T00:00:00Z')`,
    "INSERT INTO prices VALUES ('u', 'XX0000000001', 20, '2025-03-01T00:00:00Z', 'live', '{\"symbol\":\"ACME\"}')",
    "INSERT INTO prices VALUES ('u', 'XX0000000002', 7, '2025-03-01T00:00:00Z', 'manual', NULL)",
    "INSERT INTO uploads (user_id, name, uploaded_at, total, relevant, added) VALUES ('u', 'export.csv', '2025-01-05T00:00:00Z', 3, 2, 2)",
  ], 'write');
  old.close();

  const db = await openDb({ url });
  assert.deepEqual((await db.getRows('u')).map((r) => r.transaction_id).sort(), ['manual-1', 't-1']);
  assert.deepEqual((await db.getRemoved('u')).map((r) => [r.transaction_id, r.name, r.removed_at]), [['t-9', 'Gamma', '2025-02-01T00:00:00Z']]);
  const prices = await db.getPrices('u');
  assert.equal(prices.XX0000000001.source, 'live');
  assert.equal(prices.XX0000000001.price, 20);
  assert.equal(prices.XX0000000001.info.symbol, 'ACME');
  assert.equal(prices.XX0000000002.source, 'manual');
  assert.equal((await db.lastUpload('u')).name, 'export.csv');
  // La quitada vuelve con su contenido y resubir el CSV no la habría resucitado.
  assert.equal(await db.restoreRow('u', 't-9'), true);
  assert.equal((await db.getRows('u')).length, 3);
  db.close();

  // Abrirla otra vez no repite ninguna migración.
  const again = await openDb({ url });
  assert.equal((await again.getRows('u')).length, 3);
  again.close();
  const check = createClient({ url });
  const applied = (await check.execute('SELECT v FROM schema_migrations ORDER BY v')).rows.map((r) => Number(r.v));
  assert.deepEqual(applied, Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
  check.close();
});

test('una operación del CSV quitada no vuelve al resubir el archivo', async () => {
  const db = await openDb({ url: ':memory:' });
  await db.upsertUser({ id: 'u', email: 'u@example.com' });
  const { rows, total, invest } = parseCsv(CSV);
  assert.deepEqual(await db.previewUpload('u', rows), { added: 6, known: 0, removed: 0 });
  assert.equal((await db.saveUpload('u', { name: 'a.csv', total, rows, relevant: invest, sha256: 'x' })).added, 6);
  await db.removeRow('u', rows[5], true);
  assert.deepEqual(await db.previewUpload('u', rows), { added: 0, known: 5, removed: 1 });
  assert.equal((await db.saveUpload('u', { name: 'a.csv', total, rows, relevant: invest })).added, 0);
  assert.equal((await db.getRows('u')).length, 5);
  assert.equal((await db.saveUpload('u', { name: 'a.csv', total, rows, relevant: invest, replace: true })).added, 5);
  assert.equal((await db.getRows('u')).length, 5);
  assert.equal((await db.getImports('u')).length, 3);
  const dump = await db.exportUser('u');
  assert.equal(dump.transactions.length, 6);
  assert.equal(dump.transactions.filter((t) => t.deleted_at).length, 1);
  assert.equal(dump.imports[0].sha256, 'x');
  db.close();
});

test('el vigilante cotiza los valores con alertas, las marca y avisa al dispositivo', async () => {
  const db = await openDb({ url: ':memory:' });
  await db.upsertUser({ id: 'u', email: 'u@example.com' });
  await db.upsertUser({ id: 'w', email: 'w@example.com' });
  await db.putRow('u', { transaction_id: 'manual-1', datetime: '2025-01-01T12:00:00Z', date: '2025-01-01', category: 'TRADING', type: 'BUY', name: 'Acme', symbol: 'XX0000000001', shares: '1', price: '10', amount: '-10.00' });
  await db.addAlert('u', { isin: 'XX0000000001', dir: 'above', price: 15 });
  await db.addAlert('u', { isin: 'XX0000000001', dir: 'below', price: 5 });
  await db.addAlert('w', { isin: 'XX0000000001', dir: 'above', price: 50 });
  await db.addPushSub('u', { endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' });
  await db.addPushSub('u', { endpoint: 'https://push.example/caducado', p256dh: 'k', auth: 'a' });

  const sent = [];
  const push = await createPush({
    db,
    send: async (sub, payload) => {
      if (sub.endpoint.endsWith('caducado')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push([sub.endpoint, JSON.parse(payload)]);
    },
  });
  assert.equal((await createPush({ db })).publicKey, push.publicKey); // las claves se generan una sola vez
  let asked = [];
  const quotes = {
    async quoteIsins(isins) {
      asked = isins;
      return { quotes: Object.fromEntries(isins.map((i) => [i, { price: 20, info: { symbol: 'ACME' } }])), resolved: {}, failed: [] };
    },
  };
  const watcher = createAlertWatcher({ db, quotes, push });
  assert.equal(await watcher.sweep(), 1);
  assert.deepEqual(asked, ['XX0000000001']);
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].body, /Acme ha subido hasta 20 €/);
  assert.equal(sent[0][1].url, '/activo/XX0000000001');
  assert.equal((await db.getPushSubs('u')).length, 1); // el dispositivo caducado se olvida
  assert.equal((await db.getAlerts('u')).filter((a) => a.triggered_at).length, 1);
  assert.equal((await db.getPrices('u')).XX0000000001.price, 20); // la cotización queda para todos
  assert.equal(await watcher.sweep(), 0); // una alerta salta una sola vez
  assert.equal(sent.length, 1);
  db.close();
});

test('API: vista previa de la importación, tipos desconocidos, copia y política de contenido', async () => {
  const db = await openDb({ url: ':memory:' });
  const push = await createPush({ db, send: async () => {} });
  const server = createApp({ db, verifyGoogle: async (c) => ({ id: c, email: `${c}@example.com` }), googleClientId: 'cid', sessionSecret: 's', push }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (p, opts = {}) => {
    const res = await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = () => { const fd = new FormData(); fd.append('file', new Blob([CSV]), 'export.csv'); return { method: 'POST', body: fd }; };

  const cfg = await call('/api/config');
  assert.equal(cfg.body.pushKey, push.publicKey);
  assert.match(cfg.headers.get('content-security-policy'), /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  await call('/api/auth/google', json('POST', { credential: 'u' }));

  const pre = await call('/api/upload?preview=1', form());
  assert.deepEqual(pre.body.preview, { name: 'export.csv', total: 6, relevant: 3, unknown: { TIPO_NUEVO: 1 }, from: '2025-01-01', to: '2025-03-01', added: 6, known: 0, removed: 0 });
  assert.equal((await call('/api/portfolio')).body.positions.length, 0); // la vista previa no guarda nada

  const up = await call('/api/upload', form());
  assert.equal(up.body.upload.added, 6);
  assert.deepEqual(up.body.meta.unknown, { TIPO_NUEVO: 1 });
  assert.equal(up.body.positions.find((p) => p.isin === 'US0000000002').sh, 1.5);
  assert.equal((await call('/api/upload?preview=1', form())).body.preview.known, 6);
  assert.equal((await call('/api/imports')).body.imports.length, 1);

  const dump = await call('/api/export');
  assert.match(dump.headers.get('content-disposition'), /cartera-\d{4}-\d\d-\d\d\.json/);
  assert.equal(dump.body.transactions.length, 6);
  assert.equal(dump.body.transactions[0].user_id, undefined);

  assert.equal((await call('/api/push/subscribe', json('POST', { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } }))).status, 400);
  assert.equal((await call('/api/push/subscribe', json('POST', { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }))).status, 200);
  assert.equal((await call('/api/push/test', { method: 'POST' })).body.sent, 1);
  await call('/api/push/unsubscribe', json('POST', { endpoint: 'https://push.example/x' }));
  assert.equal((await call('/api/push/test', { method: 'POST' })).body.sent, 0);
  server.close();
  db.close();
});

test('símbolo: si Yahoo no conoce el ISIN se busca el ticker en una segunda fuente', async () => {
  const { createQuotes } = await import('../src/quotes.js');
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, json: async () => body });
    if (url.includes('openfigi')) {
      assert.deepEqual(JSON.parse(opts.body), [{ idType: 'ID_ISIN', idValue: 'US02079K3059', exchCode: 'US' }]);
      return ok([{ data: [{ ticker: 'GOOGL', marketSector: 'Equity' }] }]);
    }
    if (url.includes('q=US02079K3059')) return ok({ quotes: [] });
    if (url.includes('q=GOOGL')) return ok({ quotes: [{ symbol: 'GOOG', quoteType: 'EQUITY' }, { symbol: 'GOOGL', quoteType: 'EQUITY', exchDisp: 'NASDAQ', sectorDisp: 'Communication Services' }] });
    return ok({ quotes: [] });
  };
  const q = createQuotes({ fetchImpl });
  const found = await q.resolveIsins(['US02079K3059', 'XX0000000009'], {});
  assert.deepEqual(found.US02079K3059, { symbol: 'GOOGL', exchange: 'NASDAQ', sector: 'Communication Services', industry: null });
  assert.equal(found.XX0000000009, null);
});

test('fondo no cotizado: se toma su valor liquidativo y su histórico', async () => {
  const { createQuotes, NAV_EXCHANGE } = await import('../src/quotes.js');
  const ok = (body) => ({ ok: true, json: async () => body });
  const snapshot = { instrument: { name: 'FONDO PRIVADO Z EUR' }, quote: { last: 112.4565, isoCurrency: 'EUR', datetimeLast: '2026-09-30T06:00:00.000+00:00', market: { idNotation: 55 } } };
  let snaps = 0;
  const fetchImpl = async (url) => {
    if (url.includes('openfigi')) return ok([{ warning: 'No identifier found.' }]);
    if (url.includes('finance/search')) return ok({ quotes: [] });
    if (url.includes('/instruments/query')) return ok({ list: [{ isin: 'LU3176111881', entityType: 'FUND', entityValue: '308' }] });
    if (url.endsWith('/funds/308/snapshot')) { snaps++; return ok(snapshot); }
    if (url.includes('/instruments/FUND/308/eod_history?idNotation=55')) return ok({ isoCurrency: 'EUR', datetimeLast: [1764460800, 1767139200], last: [104.4925, 105.6164] });
    throw new Error(`inesperado: ${url}`);
  };
  const q = createQuotes({ fetchImpl });
  const { quotes, resolved, failed } = await q.quoteIsins(['LU3176111881'], {});
  assert.deepEqual(resolved.LU3176111881, { symbol: 'NAV:308:55', exchange: NAV_EXCHANGE, sector: null, industry: null });
  assert.deepEqual(failed, []);
  assert.equal(quotes.LU3176111881.price, 112.4565);
  assert.equal(quotes.LU3176111881.info.nav, true);
  assert.equal(quotes.LU3176111881.info.dayPct, null);
  assert.equal(quotes.LU3176111881.info.name, 'FONDO PRIVADO Z EUR');
  await q.quoteIsins(['LU3176111881'], resolved);
  assert.equal(snaps, 2); // uno al resolver y otro al cotizar; después se reutiliza varias horas
  const h = await q.history('NAV:308:55', '2025-09-01');
  assert.deepEqual(h, { currency: 'EUR', rows: [['2025-11-30', 104.4925], ['2025-12-31', 105.6164]], divs: [], splits: [] });
});

test('efectivo: los abonos sueltos suman y la serie va por fecha valor', () => {
  const row = (o) => ({ category: 'CASH', amount: '', fee: '', tax: '', name: '', symbol: '', description: '', ...o });
  const rows = [
    row({ transaction_id: 'a', type: 'CUSTOMER_INBOUND', datetime: '2025-10-01T10:00:00Z', date: '2025-10-01', amount: '100.000000' }),
    // Ajuste de impuestos ejecutado semanas después de su fecha valor, con +19 en la columna tax.
    row({ transaction_id: 'b', type: 'MANUAL', datetime: '2025-11-27T11:30:00Z', date: '2025-10-22', amount: '0.000000', tax: '19.00', description: 'Capital Gains Tax' }),
    row({ transaction_id: 'c', type: 'CARD_TRANSACTION', datetime: '2025-11-01T10:00:00Z', date: '2025-11-01', amount: '-10.000000' }),
  ];
  const cash = buildCash(rows);
  assert.equal(cash.balance, 109);
  assert.deepEqual(cash.days, [['2025-10-01', 100], ['2025-10-22', 119], ['2025-11-01', 109]]);
  // Un abono no es una retención: no cuenta en los impuestos del ejercicio.
  assert.deepEqual(buildIncome(rows), {});
});

test('efectivo: descuenta los redondeos de la tarjeta pendientes de invertir', () => {
  const card = (id, dt, amount) => ({ transaction_id: id, category: 'CASH', type: 'CARD_TRANSACTION', datetime: dt, date: dt.slice(0, 10), amount, fee: '', tax: '', name: '', symbol: '', description: '' });
  const plan = (id, dt, amount) => ({ transaction_id: id, category: 'TRADING', type: 'BUY', asset_class: 'FUND', name: 'ETF', symbol: 'IE00B3WJKG14', datetime: dt, date: dt.slice(0, 10), shares: '0.01', price: '40', amount, fee: '', tax: '', description: 'Savings plan execution IE00B3WJKG14' });
  const rows = [
    { transaction_id: 'in', category: 'CASH', type: 'CUSTOMER_INBOUND', datetime: '2026-01-01T09:00:00Z', date: '2026-01-01', amount: '100.00', fee: '', tax: '', name: '', symbol: '', description: '' },
    // Tres semanas: cada compra es el redondeo de los pagos desde la anterior (4,00 € redondea 1 €).
    card('c1', '2026-01-03T10:00:00Z', '-2.30'), card('c2', '2026-01-04T10:00:00Z', '-4.00'), plan('p1', '2026-01-05T14:00:00Z', '-1.70'),
    plan('p60', '2026-01-05T14:05:00Z', '-60.00'), // aportación fija del mismo día: no cuenta
    card('c3', '2026-01-10T10:00:00Z', '-9.95'), plan('p2', '2026-01-12T14:00:00Z', '-0.05'),
    card('c4', '2026-01-15T10:00:00Z', '-0.65'), plan('p3', '2026-01-19T14:00:00Z', '-0.35'),
    // Pendientes: 0,35 + 0,01.
    card('c5', '2026-01-20T10:10:00Z', '-0.65'), card('c6', '2026-01-20T10:15:00Z', '-2.99'),
  ];
  const cash = buildCash(rows);
  const ledger = 100 - 2.3 - 4 - 1.7 - 60 - 9.95 - 0.05 - 0.65 - 0.35 - 0.65 - 2.99;
  assert.equal(cash.ledger, +ledger.toFixed(2));
  assert.deepEqual(cash.roundUps, { amount: 0.36, n: 2, since: '2026-01-19' });
  assert.equal(cash.balance, +(ledger - 0.36).toFixed(2));
  assert.equal(cash.days.at(-1)[1], cash.balance);
  // Sin el patrón (menos de tres semanas que casen) no se resta nada.
  const loose = buildCash(rows.filter((r) => !['p2', 'p3'].includes(r.transaction_id)));
  assert.equal(loose.roundUps, null);
  assert.equal(loose.balance, loose.ledger);
});

test('categoría de un comercio: se guarda, se lee con el efectivo y se puede volver a la automática', async () => {
  const db = await openDb({ url: ':memory:' });
  await db.upsertUser({ id: 'u1', email: 'a@b.c', name: 'A' });
  await db.setMerchantCategory('u1', 'MERCADONA', 'food');
  await db.setMerchantCategory('u1', 'MERCADONA', 'super');
  assert.deepEqual(await db.getMerchantCategories('u1'), { MERCADONA: 'super' });
  await db.setMerchantCategory('u1', 'MERCADONA', null);
  assert.deepEqual(await db.getMerchantCategories('u1'), {});
  db.close();
});
