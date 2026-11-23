import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanNavs } from '../src/plans.js';

const quiet = { info() {}, warn() {}, error() {} };

test('planes: guarda el precio y el valor liquidativo reciente solo de los planes de pensiones', async () => {
  const saved = [], live = [];
  const db = {
    getSymbols: async () => ({ N5396: { symbol: 'PLAN:N5396' }, US0378331005: { symbol: 'AAPL' }, XX: null }),
    setLivePrices: async (q) => { live.push(Object.keys(q)); },
    saveHistory: async (symbol, h) => { saved.push([symbol, h.from, h.rows]); },
  };
  const quotes = {
    quoteIsins: async (isins) => ({ quotes: Object.fromEntries(isins.map((i) => [i, { price: 20 }])), resolved: {}, failed: [] }),
    history: async () => ({ currency: 'EUR', rows: [['2026-10-31', 20.1], ['2026-11-19', 19.6]], divs: [], splits: [] }),
  };
  const job = createPlanNavs({ db, quotes, now: () => Date.parse('2026-11-23T05:00:00Z'), log: quiet });
  assert.equal(await job.run(), 1);
  assert.deepEqual(live, [['N5396']], 'solo los planes, no Apple');
  assert.deepEqual(saved, [['PLAN:N5396', '2026-10-31', [['2026-10-31', 20.1], ['2026-11-19', 19.6]]]]);
});
