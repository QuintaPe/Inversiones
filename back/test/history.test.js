import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createHistory } from '../src/history.js';

const NOW = Date.parse('2025-01-10T12:00:00Z');
// Un valor en USD que sube de 10 a 12 y un cambio fijo de 0,5 €/USD.
const fake = {
  async resolveIsins(isins, known) {
    return Object.fromEntries(isins.filter((i) => known[i] === undefined).map((i) => [i, i.startsWith('US') ? { symbol: 'ACME', exchange: 'X' } : null]));
  },
  async history(symbol) {
    if (symbol === 'ACME') return { currency: 'USD', rows: [['2025-01-02', 10], ['2025-01-03', 11], ['2025-01-06', 12]], divs: [] };
    if (symbol === 'USDEUR=X') return { currency: 'EUR', rows: [['2025-01-01', 0.5]], divs: [] };
    throw new Error('sin histórico');
  },
};
const buy = (d, sh, net, sa, ca) => ({ k: 'B', d, sh, net, sa, ca, px: net / sh });

test('valor diario, flujos e índice de rentabilidad', async () => {
  const db = await openDb({ url: ':memory:' });
  const h = createHistory({ db, quotes: fake, now: () => NOW });
  const positions = [{
    isin: 'US0000000001', name: 'Acme', open: true,
    evs: [buy('2025-01-02', 10, 50, 10, 50), { k: 'D', d: '2025-01-03', net: 2 }, buy('2025-01-06', 10, 60, 20, 110)],
  }];
  const r = await h.build({ positions, prices: {}, valuations: {} });
  const at = (d) => r.d.indexOf(d);
  assert.equal(r.d[0], '2025-01-02');
  assert.equal(r.d.at(-1), '2025-01-10');
  assert.equal(r.v[at('2025-01-02')], 50); // 10 × 10 USD × 0,5
  assert.equal(r.v[at('2025-01-03')], 55);
  assert.equal(r.v[at('2025-01-05')], 55, 'el fin de semana arrastra el último cierre');
  assert.equal(r.v[at('2025-01-06')], 120);
  assert.equal(r.cost[at('2025-01-06')], 110);
  // TWR: día 2 → 50/50; día 3 → (55 + 2)/50; día 6 → 120/(55 + 60)
  const expected = 100 * (57 / 50) * (120 / 115);
  assert.ok(Math.abs(r.idx.at(-1) - expected) < 0.001, `${r.idx.at(-1)} ≠ ${expected}`);
  assert.deepEqual(r.unpriced, []);
  db.close();
});

test('lo que no cotiza se interpola entre la compra y las valoraciones', async () => {
  const db = await openDb({ url: ':memory:' });
  const h = createHistory({ db, quotes: fake, now: () => NOW });
  const positions = [{ isin: 'LU0000000001', name: 'Fondo', open: true, evs: [buy('2025-01-02', 10, 1000, 10, 1000)] }];
  const r = await h.build({ positions, prices: {}, valuations: { LU0000000001: [{ d: '2025-01-10', price: 108 }] } });
  assert.equal(r.v[0], 1000);
  assert.equal(r.v[r.d.indexOf('2025-01-06')], 1040); // mitad de camino entre 100 y 108
  assert.equal(r.v.at(-1), 1080);
  assert.deepEqual(r.unpriced, ['Fondo']);
  db.close();
});

test('split: los cierres ajustados se valoran con las acciones de cada día', async () => {
  const db = await openDb({ url: ':memory:' });
  // Split 2:1 el día 6: el proveedor devuelve los cierres anteriores ya divididos entre 2.
  const quotes = {
    async resolveIsins(isins, known) {
      return Object.fromEntries(isins.filter((i) => known[i] === undefined).map((i) => [i, { symbol: 'SPL', exchange: 'X' }]));
    },
    async history(symbol) {
      if (symbol === 'SPL') return { currency: 'EUR', rows: [['2025-01-02', 50], ['2025-01-03', 50], ['2025-01-06', 55]], divs: [], splits: [['2025-01-06', 2]] };
      throw new Error('sin histórico');
    },
  };
  const h = createHistory({ db, quotes, now: () => NOW });
  const before = [{ isin: 'DE0000000001', name: 'Split', open: true, evs: [buy('2025-01-02', 10, 1000, 10, 1000)] }];
  const after = [{ ...before[0], evs: [...before[0].evs, { k: 'X', d: '2025-01-06', ratio: 2, sa: 20, ca: 1000, net: 0 }] }];
  const r = await h.build({ positions: before, prices: {}, valuations: {}, rebuild: async () => after });
  const at = (d) => r.d.indexOf(d);
  assert.equal(r.v[at('2025-01-03')], 1000, '10 acciones a 100 € (50 × 2 sin ajustar)');
  assert.equal(r.v[at('2025-01-06')], 1100, '20 acciones a 55 €');
  assert.ok(Math.abs(r.idx.at(-1) - 110) < 0.001);
  assert.equal(r.splits, 1);
  assert.deepEqual(await db.getSplits(), { SPL: [['2025-01-06', 2]] });
  db.close();
});
