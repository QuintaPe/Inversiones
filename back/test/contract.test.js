// Fotos de la API: la respuesta de las rutas principales con la cartera de ejemplo en un día
// fijo, guardada en snapshots/contract.json. Es la red de seguridad de las refactorizaciones:
// si una cifra o un campo cambia sin querer, esta prueba lo dice.
//
//   node --test test/contract.test.js                     compara con la foto guardada
//   UPDATE_SNAPSHOTS=1 node --test test/contract.test.js  la vuelve a hacer (revisa el diff antes de subirlo)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { demoRows } from '../src/demo.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'contract.json');
const NOW = Date.parse('2026-06-15T12:00:00Z');
const DAY = 86400000;
const PRICES = {
  IE00B4L5Y983: 112.4, IE00BK5BQT80: 141.9, US0378331005: 238.15, US5949181045: 402.3, US67066G1040: 171.2,
  NL0010273215: 915.6, ES0144580Y14: 17.42, ES0148396007: 48.9, DE0008404005: 371.5, US1912161007: 61.05,
};

/** Proveedor de precios inventado pero determinista: mismo símbolo y fecha, mismo cierre. */
function fakeQuotes() {
  const seed = (s) => [...s].reduce((t, c) => (t * 31 + c.charCodeAt(0)) % 9973, 7);
  return {
    paused: () => ({}),
    async resolveIsins(isins, known) {
      return Object.fromEntries(isins.filter((i) => known[i] === undefined).map((i) => [i, { symbol: `S${i.slice(-6)}`, exchange: 'X', sector: i.startsWith('IE') ? null : 'Tecnología', industry: null }]));
    },
    async quoteIsins() { return { quotes: {}, resolved: {}, failed: [] }; },
    async history(symbol, since) {
      const k = seed(symbol), rows = [];
      for (let t = Date.parse(`${since}T00:00:00Z`); t <= NOW; t += DAY) {
        const wd = new Date(t).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        const i = Math.round(t / DAY);
        rows.push([new Date(t).toISOString().slice(0, 10), +(50 + (k % 40) + 8 * Math.sin((i + k) / 23) + i * 0.01 - 200).toFixed(4)]);
      }
      // Los valores estadounidenses, en dólares: así la foto cubre la conversión de divisa.
      const usd = symbol.startsWith('S0') === false && k % 3 === 0;
      const fx = symbol === 'USDEUR=X';
      return {
        currency: fx ? 'EUR' : usd ? 'USD' : 'EUR',
        rows: fx ? rows.map(([d], n) => [d, +(0.9 + 0.02 * Math.sin(n / 50)).toFixed(4)]) : rows.map(([d, c]) => [d, Math.max(1, c)]),
        divs: k % 2 ? rows.filter((_, n) => n % 63 === 20).map(([d]) => [d, 0.25]) : [],
        splits: [],
      };
    },
  };
}

/**
 * Deja la respuesta en algo que se puede leer y comparar en un diff: las listas largas se
 * resumen en su longitud, una huella de todo su contenido y una muestra repartida.
 */
function summarize(v) {
  if (Array.isArray(v)) {
    if (v.length <= 24) return v.map(summarize);
    const step = Math.ceil(v.length / 8);
    return { __lista: v.length, __huella: crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16), __muestra: v.filter((_, i) => i % step === 0 || i === v.length - 1).map(summarize) };
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, summarize(v[k])]));
  return v;
}

test('fotos de la API: las respuestas de la cartera de ejemplo no cambian sin querer', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = await openDb({ url: ':memory:' });
  const app = createApp({ db, quotes: fakeQuotes(), historyWaitMs: 20000, verifyGoogle: async (c) => ({ id: c, email: `${c}@x` }), googleClientId: 'cid', sessionSecret: 's', slowMs: 0 });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'u' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const call = async (p, opts = {}) => (await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } })).json();
    const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const { rows, total, invest } = demoRows(NOW);
    await db.saveUpload('u', { name: 'cartera-de-ejemplo.csv', total, rows, relevant: invest });
    await call('/api/prices', json('PUT', { prices: PRICES }));
    await call('/api/targets', json('PUT', { targets: { IE00B4L5Y983: 50, IE00BK5BQT80: 30 } }));
    await call('/api/alerts', json('POST', { isin: 'US0378331005', dir: 'below', price: 200 }));
    await call('/api/accounts', json('POST', { name: 'Piso', kind: 'property', amount: 180000, d: '2026-01-10' }));
    await call('/api/settings/plan', json('PUT', { value: { monthly: 500, rate: 6, years: 20, goal: null, since: null, start: null } }));

    const shots = {};
    for (const route of ['/api/portfolio', '/api/events', '/api/cash', '/api/history', '/api/risk', '/api/dividends/forecast', '/api/accounts', '/api/export']) {
      shots[route] = summarize(await call(route));
    }
    // Lo único que cambia de una ejecución a otra: el identificador aleatorio de cada cuenta del patrimonio.
    for (const acc of shots['/api/accounts'].accounts) acc.id = '<id>';
    assert.equal(shots['/api/history'].pending, undefined, 'el histórico debe llegar completo');

    const text = `${JSON.stringify(shots, null, 1)}\n`;
    if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(FILE)) {
      fs.writeFileSync(FILE, text);
      return;
    }
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const route of Object.keys(shots)) assert.deepEqual(JSON.parse(JSON.stringify(shots[route])), saved[route], `${route} ha cambiado (UPDATE_SNAPSHOTS=1 para aceptar el cambio)`);
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(shots).sort());
  } finally {
    server.close();
    await db.close();
    mock.timers.reset();
  }
});
