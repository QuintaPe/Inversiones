import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const csv = (rows) => ['"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"',
  ...rows.map(([isin, name, sh, px], i) => `"2024-01-0${i + 2}T10:00:00Z","2024-01-0${i + 2}","TRADING","BUY","STOCK","${name}","${isin}","${sh}","${px}","-${sh * px}","-1.00","","Buy","t-${i}"`)].join('\n');
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Un cierre por semana durante `weeks` semanas hasta hoy. */
const weekly = (weeks, f) => Array.from({ length: weeks }, (_, i) => [day((weeks - 1 - i) * 7), +f(i).toFixed(4)]);

test('riesgo: volatilidad, correlación y reparto del riesgo con los cierres guardados; sin histórico, nada', async () => {
  const db = await openDb({ url: ':memory:' });
  // Proveedor que no descarga nada: el análisis solo usa lo ya guardado.
  const quotes = { async resolveIsins() { return {}; }, async quoteIsins() { return { quotes: {}, resolved: {}, failed: [] }; }, async history() { throw new Error('no debe descargar'); } };
  const app = createApp({ db, quotes, verifyGoogle: async (c) => ({ id: c, email: `${c}@x` }), googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'u' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (p, opts = {}) => (await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } })).json();
  const fd = new FormData();
  fd.append('file', new Blob([csv([['US0000000001', 'Acme', 10, 10], ['US0000000002', 'Beta', 5, 20], ['US0000000003', 'Nueva', 1, 50]])]), 'a.csv');
  await call('/api/upload', { method: 'POST', body: fd });
  assert.deepEqual(await call('/api/risk'), { risk: null });

  await db.saveSymbols({ US0000000001: { symbol: 'ACME', exchange: 'X' }, US0000000002: { symbol: 'BETA', exchange: 'X' }, US0000000003: { symbol: 'NEW', exchange: 'X' } });
  const from = day(400);
  await db.saveHistory('ACME', { currency: 'EUR', from, rows: weekly(50, (i) => 10 * (1 + 0.03 * Math.sin(i * 1.3))) });
  // En dólares: se convierte con el cambio guardado.
  await db.saveHistory('BETA', { currency: 'USD', from, rows: weekly(50, (i) => 22 * (1 + 0.05 * Math.cos(i * 0.9))) });
  await db.saveHistory('USDEUR=X', { currency: 'EUR', from, rows: weekly(60, () => 0.9) });
  await db.saveHistory('NEW', { currency: 'EUR', from, rows: weekly(4, (i) => 50 + i) });
  await call('/api/prices', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prices: { US0000000001: 12, US0000000002: 24, US0000000003: 55 } }) });

  const { risk } = await call('/api/risk');
  assert.deepEqual(risk.assets.map((x) => x.key), ['US0000000001', 'US0000000002']);
  assert.deepEqual(risk.skipped, ['US0000000003']);
  assert.ok(risk.weeks >= 40, `semanas: ${risk.weeks}`);
  assert.ok(Math.abs(risk.assets[0].w - 50) < 1e-9 && Math.abs(risk.assets[1].w - 50) < 1e-9); // 10 × 12 y 5 × 24
  assert.ok(risk.assets.every((x) => x.vol > 0));
  assert.ok(Math.abs(risk.assets[0].share + risk.assets[1].share - 100) < 1e-6);
  assert.ok(risk.corr[0][1] > -1 && risk.corr[0][1] < 1);
  assert.ok(risk.ratio >= 1 && risk.vol > 0 && Math.abs(risk.effN - 2) < 1e-9);
  server.close();
  await db.close();
});
