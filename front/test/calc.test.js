import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFills, washBuys, savingsTax, simulateSale, rebalance, taxYears } from '../src/lib/calc.js';
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

test('rebalance: ajuste completo y reparto de una aportación', () => {
  const items = [{ isin: 'A', v: 700 }, { isin: 'B', v: 300 }];
  const full = rebalance(items, { A: 50, B: 50 });
  assert.deepEqual([full.rows.A.delta, full.rows.B.delta, full.net], [-200, 200, 0]);
  // Con 200 € nuevos el total es 1.200: A ya supera su mitad (600), todo va a B.
  const add = rebalance(items, { A: 50, B: 50 }, 200);
  assert.deepEqual([add.rows.A.delta, add.rows.B.delta, add.net], [0, 200, 200]);
});

test('fiscalidad: regla de los dos meses, compensación del 25 % y arrastre de pérdidas', () => {
  // 2024: se venden 10 con −100 de pérdida y se recompran 4 a los pocos días → se difieren −40.
  // 2025: se venden las 4 recompradas con +10 → afloran los −40.
  const p = { isin: 'A', evs: [{ k: 'B', d: '2024-01-10', sh: 10 }, { k: 'B', d: '2024-06-10', sh: 4 }] };
  const s1 = { p, k: 'S', d: '2024-06-01', sh: 10, net: 900, csF: 1000, reF: -100, re: -100, sa: 0, lotsUsed: [{ d: '2024-01-10', sh: 10 }] };
  const s2 = { p, k: 'S', d: '2025-03-01', sh: 4, net: 410, csF: 400, reF: 10, re: 10, sa: 0, lotsUsed: [{ d: '2024-06-10', sh: 4 }] };
  const div = (d, g) => ({ p, k: 'D', d, g, tax: g * 0.19, net: g * 0.81 });
  const income = { 2025: { interest: { g: 20, t: 3.8, n: 1 }, reward: { g: 0, t: 0, n: 0 } } };
  const [y25, y24] = taxYears([s2, s1], [div('2025-05-01', 80), div('2024-05-01', 100)], income);

  assert.equal(y24.deferred, -40);
  assert.equal(y24.gainTax, -60);
  assert.equal(y24.offsetRcm, 25, 'las pérdidas compensan como mucho el 25 % de 100 € de dividendos');
  assert.equal(y24.base, 75);
  assert.equal(y24.carryOut, 35);

  assert.equal(y25.released, -40);
  assert.equal(y25.gainTax, -30);
  assert.equal(y25.rcm, 100, 'dividendos más intereses');
  assert.equal(y25.carryIn, 35);
  // Límite del 25 % de 100 = 25: lo consume la pérdida del año; lo pendiente sigue arrastrándose.
  assert.equal(y25.offsetRcm, 25);
  assert.equal(y25.base, 75);
  assert.equal(y25.carryOut, 40);
  assert.ok(Math.abs(y25.withheld - (80 * 0.19 + 3.8)) < 1e-9);
});

test('fiscalidad: las pérdidas pendientes se restan de ganancias posteriores y caducan a los cuatro años', () => {
  const p = { isin: 'B', evs: [] };
  const sale = (d, reF) => ({ p, k: 'S', d, sh: 1, net: 0, csF: 0, reF, re: reF, sa: 0, lotsUsed: [] });
  const ys = taxYears([sale('2020-01-01', -100), sale('2022-01-01', 30), sale('2025-01-01', 500)], []);
  const by = Object.fromEntries(ys.map((r) => [r.year, r]));
  assert.equal(by['2022'].usedPrev, 30);
  assert.equal(by['2022'].base, 0);
  assert.equal(by['2022'].carryOut, 70);
  assert.equal(by['2025'].carryIn, 0, 'en 2025 ya han pasado más de cuatro ejercicios');
  assert.equal(by['2025'].base, 500);
});

test('periodStats: el índice con las mismas aportaciones', () => {
  const flows = { d: ['2025-01-01', '2025-01-02', '2025-01-03'], buy: [100, 0, 100], sell: [0, 0, 0], div: [0, 0, 0] };
  // Cartera plana (ni gana ni pierde) frente a un índice que sube un 10 % el segundo día y luego no se mueve.
  const h = prepare({ ...flows, v: [100, 100, 200], cost: [100, 100, 200], idx: [100, 100, 100], benchmarks: [{ key: 'w', name: 'W', c: [50, 55, 55] }] });
  const [b] = periodStats(h, null).bench;
  assert.ok(Math.abs(b.r - 10) < 1e-9, 'ponderada por tiempo: +10 %');
  // Solo los primeros 100 € estaban dentro cuando subió: +10 €, no el 10 % de los 200 €.
  assert.ok(Math.abs(b.gain - 10) < 1e-9, `${b.gain}`);
  assert.ok(b.mwr < b.r);
});

test('periodStats: la serie diaria del índice acaba en su resultado y empieza en cero dentro de un periodo', () => {
  const h = prepare({ d: ['2025-01-01', '2025-01-02', '2025-01-03'], buy: [100, 0, 100], sell: [0, 0, 0], div: [0, 0, 0],
    v: [100, 100, 200], cost: [100, 100, 200], idx: [100, 100, 100], benchmarks: [{ key: 'w', name: 'W', c: [50, 55, 55] }] });
  const all = periodStats(h, null), [b] = all.bench;
  assert.equal(b.g.length, all.i1 - all.first + 1);
  assert.ok(Math.abs(b.g[1] - 10) < 1e-9 && b.g.at(-1) === b.gain);
  const part = periodStats(h, '2025-01-03'), [b2] = part.bench;
  assert.deepEqual([b2.g.length, b2.g[0]], [part.i1 - part.first + 1, 0]);
});
