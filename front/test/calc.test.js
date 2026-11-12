import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFills, washBuys, savingsTax, simulateSale } from '../src/lib/calc.js';
import { prepare, periodStats } from '../src/lib/perf.js';

test('mergeFills junta ejecuciones del mismo día con una sola comisión', () => {
  const evs = [
    { id: 'a', k: 'B', d: '2025-01-01', sh: 97, g: 177.51, fee: 1, tax: 0, net: 178.51, sa: 97, ca: 178.51 },
    { id: 'b', k: 'B', d: '2025-01-01', sh: 0.5, g: 0.92, fee: 0, tax: 0, net: 0.92, sa: 97.5, ca: 179.43 },
    { id: 'c', k: 'B', d: '2025-02-01', sh: 1, g: 2, fee: 0, tax: 0, net: 2, sa: 98.5, ca: 181.43 },
  ];
  const out = mergeFills(evs);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[0].sh, 97.5);
  assert.ok(Math.abs(out[0].net - 179.43) < 1e-9);
  assert.equal(out[0].sa, 97.5);
});

test('regla de los dos meses: pérdida con recompra posterior', () => {
  const p = { evs: [{ k: 'B', d: '2025-01-10' }, { k: 'B', d: '2025-04-20' }, { k: 'B', d: '2025-09-01' }] };
  const loss = { p, d: '2025-03-15', reF: -50, sa: 0, lotsUsed: [{ d: '2025-01-10' }] };
  assert.deepEqual(washBuys(loss).map((b) => b.d), ['2025-04-20']);
  assert.deepEqual(washBuys({ ...loss, reF: 10 }), [], 'una ganancia nunca se marca');
  assert.deepEqual(washBuys({ ...loss, d: '2025-06-25' }), [], 'fuera de la ventana de dos meses');
});

test('tramos del ahorro y venta simulada por FIFO', () => {
  assert.equal(savingsTax(6000), 1140);
  assert.equal(savingsTax(10000), 1140 + 4000 * 0.21);
  const sim = simulateSale([{ d: 'a', sh: 10, unit: 10 }, { d: 'b', sh: 10, unit: 20 }], 15, 30);
  assert.equal(sim.cost, 200); // 10 × 10 + 5 × 20
  assert.equal(sim.proceeds, 449);
  assert.equal(sim.used.length, 2);
});

test('periodStats: resultado y rentabilidad de un periodo', () => {
  // día 0: se compran 100; día 1: vale 110; día 2: se aportan 100 más y vale 215
  const h = prepare({
    d: ['2025-01-01', '2025-01-02', '2025-01-03'], v: [100, 110, 215], cost: [100, 100, 200],
    idx: [100, 110, 112.619], buy: [100, 0, 100], sell: [0, 0, 0], div: [0, 0, 0], benchmarks: [],
  });
  const all = periodStats(h, null);
  assert.equal(all.gain, 15);
  assert.equal(all.contrib, 200);
  const last = periodStats(h, '2025-01-03');
  assert.equal(last.v0, 110);
  assert.equal(last.gain, 5);
});
