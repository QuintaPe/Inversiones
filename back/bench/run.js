// Benchmark del motor y de la API con una cartera sintética.
//   npm run bench                       5.000 y 20.000 operaciones, sin latencia
//   npm run bench -- --latency 40       simula 40 ms por ida y vuelta (Turso remoto)
//   npm run bench -- --rows 50000 --no-cache
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { buildPortfolio, buildCash, buildIncome } from '../src/engine.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const { values: opt } = parseArgs({
  options: {
    rows: { type: 'string', multiple: true },
    latency: { type: 'string', default: '0' },
    'no-cache': { type: 'boolean', default: false },
    runs: { type: 'string', default: '20' },
  },
});
const SIZES = (opt.rows ?? ['5000', '20000']).map(Number);
const LATENCY = Number(opt.latency);
const RUNS = Number(opt.runs);

/** Operaciones de Trade Republic inventadas: compras, ventas, dividendos y tarjeta. */
function synthetic(n, assets = 60) {
  const isins = Array.from({ length: assets }, (_, i) => `XX${String(i).padStart(9, '0')}${i % 10}`);
  const held = new Map();
  const head = '"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id"';
  const out = [head];
  let t = Date.UTC(2018, 0, 1);
  for (let i = 0; i < n; i++) {
    t += 3 * 3600_000;
    const dt = new Date(t).toISOString(), d = dt.slice(0, 10);
    const isin = isins[i % assets], price = (50 + (i % 97)).toFixed(2), have = held.get(isin) ?? 0;
    const kind = i % 10;
    if (kind < 6 || have < 2) {
      held.set(isin, have + 2);
      out.push(`"${dt}","${d}","TRADING","BUY","STOCK","Valor ${isin}","${isin}","2","${price}","-${(2 * price).toFixed(2)}","-1.00","","Buy","t-${i}"`);
    } else if (kind < 8) {
      held.set(isin, have - 1);
      out.push(`"${dt}","${d}","TRADING","SELL","STOCK","Valor ${isin}","${isin}","1","${price}","${price}","-1.00","","Sell","t-${i}"`);
    } else if (kind < 9) {
      out.push(`"${dt}","${d}","CASH","DIVIDEND","STOCK","Valor ${isin}","${isin}","${have}","","${(have * 0.3).toFixed(2)}","","-${(have * 0.05).toFixed(2)}","Dividend","t-${i}"`);
    } else {
      out.push(`"${dt}","${d}","CASH","CARD_TRANSACTION","","","","","","-12.50","","","Card","t-${i}"`);
    }
  }
  return out.join('\n');
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `p50 ${q(0.5).toFixed(1)} ms · p95 ${q(0.95).toFixed(1)} ms`;
};
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const timeAsync = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };

/** Retrasa cada ida y vuelta del cliente libSQL, como si cruzara la red hasta Turso. */
function withLatency(ms) {
  if (!ms) return (c) => c;
  const sleep = () => new Promise((r) => setTimeout(r, ms));
  return (c) => new Proxy(c, {
    get(target, k) {
      const v = target[k];
      if (k === 'execute' || k === 'batch') return async (...a) => { await sleep(); return v.apply(target, a); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

console.log(`Node ${process.version} · latencia simulada ${LATENCY} ms · caché ${opt['no-cache'] ? 'no' : 'sí'} · ${RUNS} repeticiones\n`);

for (const n of SIZES) {
  const csv = synthetic(n);
  const raw = await openDb({ url: ':memory:', cache: !opt['no-cache'], wrap: withLatency(LATENCY) });
  const db = raw;
  const quotes = { async quoteIsins(isins) { return { quotes: Object.fromEntries(isins.map((i) => [i, { price: 80 }])), resolved: {}, failed: [] }; } };
  const app = createApp({ db, verifyGoogle: async (c) => ({ id: c, email: `${c}@example.com` }), quotes, googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'bench' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'bench.csv');
  const up = await timeAsync(() => fetch(`${base}/api/upload`, { method: 'POST', body: fd, headers: { cookie } }).then((r) => r.arrayBuffer()));
  const rows = await raw.getRows('bench');

  const engine = { portfolio: [], cash: [], income: [] };
  for (let i = 0; i < RUNS; i++) {
    engine.portfolio.push(time(() => buildPortfolio(rows)));
    engine.cash.push(time(() => buildCash(rows)));
    engine.income.push(time(() => buildIncome(rows)));
  }
  const api = { portfolio: [], refresh: [] };
  let bytes = 0, serverTiming = '';
  for (let i = 0; i < RUNS; i++) {
    api.portfolio.push(await timeAsync(async () => {
      const r = await fetch(`${base}/api/portfolio`, { headers: { cookie, 'accept-encoding': 'gzip' } });
      serverTiming = r.headers.get('server-timing');
      bytes = (await r.arrayBuffer()).byteLength;
    }));
    api.refresh.push(await timeAsync(() => fetch(`${base}/api/quotes/refresh`, { method: 'POST', headers: { cookie } }).then((r) => r.arrayBuffer())));
  }
  console.log(`— ${n.toLocaleString('es-ES')} operaciones (${rows.length} guardadas) · subida ${up.toFixed(0)} ms`);
  console.log(`  motor   buildPortfolio ${stats(engine.portfolio)} | buildCash ${stats(engine.cash)} | buildIncome ${stats(engine.income)}`);
  console.log(`  API     GET /portfolio ${stats(api.portfolio)} (${(bytes / 1024).toFixed(0)} KB sin comprimir) | POST /quotes/refresh ${stats(api.refresh)}`);
  console.log(`          Server-Timing: ${serverTiming}\n`);
  server.close();
  raw.close();
}
