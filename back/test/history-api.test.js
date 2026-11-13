import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const CSV = [
  '"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"',
  '"2025-01-02T10:00:00Z","2025-01-02","TRADING","BUY","STOCK","Acme","US0000000001","10","10","-100.00","-1.00","","Buy","t-1"',
].join('\n');

/** Proveedor falso cuyo histórico tarda `delay` ms por símbolo. */
function slowQuotes(delay) {
  const q = {
    downloads: 0,
    async resolveIsins(isins, known) {
      return Object.fromEntries(isins.filter((i) => known[i] === undefined).map((i) => [i, { symbol: 'ACME', exchange: 'X' }]));
    },
    async quoteIsins(isins) { return { quotes: Object.fromEntries(isins.map((i) => [i, { price: 12 }])), resolved: {}, failed: [] }; },
    async history(symbol) {
      q.downloads++;
      await new Promise((r) => setTimeout(r, delay));
      return { currency: 'EUR', rows: [['2025-01-02', 10], ['2025-06-02', 11]], divs: [] };
    },
  };
  return q;
}

async function start(url, quotes, historyWaitMs) {
  const db = await openDb({ url });
  const app = createApp({ db, quotes, historyWaitMs, verifyGoogle: async (c) => ({ id: c, email: `${c}@x` }), googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'u' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (p, opts = {}) => (await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } })).json();
  return { call, stop: () => { server.close(); db.close(); } };
}
const form = () => { const fd = new FormData(); fd.append('file', new Blob([CSV]), 'a.csv'); return { method: 'POST', body: fd }; };

test('el histórico lento responde enseguida con su progreso y se guarda para después', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartera-'));
  const url = `file:${path.join(dir, 'h.db')}`;
  const quotes = slowQuotes(150);
  let s = await start(url, quotes, 20);
  await s.call('/api/upload', form());

  const first = await s.call('/api/history');
  assert.equal(first.pending, true);
  assert.equal(first.history, null);
  assert.ok(first.progress.total >= 1, 'sabe cuántos valores tiene que descargar');

  let r = first;
  for (let i = 0; i < 50 && r.pending; i++) {
    await new Promise((ok) => setTimeout(ok, 60));
    r = await s.call('/api/history');
  }
  assert.equal(r.pending, undefined);
  assert.equal(r.history.d[0], '2025-01-02');
  const downloads = quotes.downloads;
  // Mientras se reconstruía, las preguntas repetidas no lanzaron otra reconstrucción.
  assert.ok(downloads <= 3, `descargas: ${downloads}`);
  s.stop();

  // Tras reiniciar el servidor, la serie guardada sale sin descargar nada.
  s = await start(url, quotes, 20);
  const again = await s.call('/api/history');
  assert.equal(again.pending, undefined);
  assert.deepEqual(again.history.d, r.history.d);
  assert.equal(quotes.downloads, downloads);
  s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('si la reconstrucción es rápida, responde con la serie sin pasar por pendiente', async () => {
  const s = await start(':memory:', slowQuotes(0), 2000);
  await s.call('/api/upload', form());
  const r = await s.call('/api/history');
  assert.equal(r.pending, undefined);
  assert.ok(r.history.v.length > 100);
  s.stop();
});
