import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, mergeFills, washBuys, savingsTax, simulateSale, rebalance, taxYears } from '../src/lib/calc.js';
import { prepare, periodStats, xirr } from '../src/lib/perf.js';

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

test('splitWithholding: separa la retención de origen de la española', async () => {
  const { splitWithholding } = await import('../src/lib/calc.js');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.011, `${a} ≈ ${b}`);
  // EE. UU.: 15 % en origen y 19 % sobre el resto (1,73 → 0,26 + 0,28).
  let w = splitWithholding(1.73, 0.54, 'US9252831030');
  near(w.foreign, 0.26); near(w.es, 0.28);
  // Alemania: 26,375 % en origen.
  w = splitWithholding(14, 5.65, 'DE0007164600');
  near(w.foreign, 3.69); near(w.es, 1.96);
  // Solo la española (19 %), con el redondeo de un importe pequeño.
  assert.deepEqual(splitWithholding(2.36, 0.45, 'CA21037X1006'), { es: 0.45, foreign: 0 });
  // Menos del 19 %: solo se retuvo en origen.
  assert.deepEqual(splitWithholding(10, 1.5, 'US0378331005'), { es: 0, foreign: 1.5 });
  // Valor español: todo es retención española.
  assert.deepEqual(splitWithholding(10, 1.9, 'ES0177542018'), { es: 1.9, foreign: 0 });
  assert.deepEqual(splitWithholding(10, 0, 'US0378331005'), { es: 0, foreign: 0 });
});

test('taxYears: doble imposición, cuota y ventas por entidad emisora', () => {
  const us = { isin: 'US0378331005', name: 'Apple', evs: [] }, de = { isin: 'DE0007164600', name: 'SAP', evs: [] };
  const sale = (p, d, net, csF) => ({ p, k: 'S', d, sh: 1, net, csF, cs: csF, re: net - csF, reF: net - csF, lotsUsed: [], sa: 0 });
  const [y] = taxYears(
    [sale(us, '2025-03-01', 1500, 1000), sale(us, '2025-04-01', 700, 600), sale(de, '2025-05-01', 400, 500)],
    [
      { p: us, k: 'D', d: '2025-06-01', g: 100, tax: 15 + 0.19 * 85 }, // 15 % origen + 19 % del resto
      { p: de, k: 'D', d: '2025-06-02', g: 100, tax: 26.375 + 0.19 * 73.625 },
    ],
  );
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  near(y.divFor, 15 + 26.375);
  near(y.forDed, 30); // 15 % de convenio por país
  near(y.forExcess, 11.375); // lo que Alemania retiene de más se reclama allí
  near(y.withheld, 0.19 * 85 + 0.19 * 73.625);
  near(y.base, 500 + 200); // +500 de ventas netas y 200 de dividendos
  near(y.quota, 700 * 0.19);
  near(y.dii, 30); // 15 % < tipo medio del 19 %
  near(y.due, y.quota - 30 - y.withheld);
  assert.deepEqual(y.issuers.map((e) => [e.p.name, e.n, e.proceeds, e.cost, e.gain]), [['Apple', 2, 2200, 1600, 600], ['SAP', 1, 400, 500, -100]]);
  assert.deepEqual(Object.keys(y.countries).sort(), ['DE', 'US']);
});

test('modo privado: ningún formateador devuelve una cifra', async () => {
  const f = await import('../src/lib/format.js');
  f.setMasked(true);
  try {
    for (const out of [f.num(1234.5), f.eur(1234.5), f.eurS(-12), f.pct(3.2), f.pctS(-3.2), f.qty(0.123456), f.compact(15000)]) {
      assert.doesNotMatch(out, /\d/, out);
    }
  } finally {
    f.setMasked(false);
  }
  assert.equal(f.eur(1234.5), '1.234,50\u00a0€'); // espacio de no separación
});

test('modo privado: las notas del servidor pierden sus cifras, no sus fechas', async () => {
  const f = await import('../src/lib/format.js');
  const note = 'Pre-pago el 19/09/2025: 10.000 € + 1 € de comisión; 101,5 participaciones (ID 3f2a9c81).';
  assert.equal(f.maskText(note), note);
  f.setMasked(true);
  try {
    assert.equal(f.maskText(note), 'Pre-pago el 19/09/2025: •••• € + •••• € de comisión; •••• participaciones (ID 3f2a9c81).');
  } finally {
    f.setMasked(false);
  }
});

test('analyze reutiliza lo que depende de los eventos, pero no los precios', () => {
  const evs = [{ k: 'B', d: '2025-01-02', sh: 10, net: 100, fee: 1, sa: 10, ca: 100 }];
  const base = { isin: 'X1', name: 'Uno', grp: 'ac', open: true, sh: 10, cost: 100, evs, lots: [] };
  const a1 = analyze([{ ...base, price: 12 }], 'all');
  const a2 = analyze([{ ...base, price: 15 }], 'all');
  assert.equal(a1.val, 120);
  assert.equal(a2.val, 150, 'el precio nuevo cuenta');
  assert.equal(a2.ops, a1.ops, 'mismos eventos: misma lista');
  // Eventos nuevos (otra lista): se recalcula.
  const evs2 = [...evs, { k: 'D', d: '2025-02-01', g: 5, tax: 1, net: 4, fee: 0 }];
  const a3 = analyze([{ ...base, evs: evs2, price: 15 }], 'all');
  assert.notEqual(a3.ops, a1.ops);
  assert.equal(a3.dv.length, 1);
  assert.equal(a3.divN, 4);
});

test('TIR anualizada: interés anual equivalente contando cuándo entra cada euro', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≠ ${b}`);
  close(xirr([[0, -1000], [365, 1100]]), 10);
  close(xirr([[0, -1000], [730, 1210]]), 10); // dos años al 10 %
  close(xirr([[0, -1000], [365, 900]]), -10);
  // 1.000 € al inicio y 1.000 € a mitad de año, al 10 % anual: 1.100 + 1.000 × 1,1^0,5
  close(xirr([[0, -1000], [182.5, -1000], [365, 1100 + 1000 * 1.1 ** 0.5]]), 10);
  assert.equal(xirr([[0, -1000]]), null);
  assert.equal(xirr([[0, 500], [10, 600]]), null);

  // En el periodo: 100 días con 1.000 € que acaban en 1.050 → (1,05)^(365/99) − 1
  const n = 100;
  const d = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const v = d.map((_, i) => 1000 + (50 * i) / (n - 1));
  const h = prepare({ d, v, cost: d.map(() => 1000), idx: v.map((x) => x / 10), buy: d.map((_, i) => (i ? 0 : 1000)), sell: d.map(() => 0), div: d.map(() => 0), benchmarks: [] });
  close(periodStats(h, null).irr, (1.05 ** (365 / 99) - 1) * 100);
  assert.equal(periodStats(h, d[60]).irr, null, 'con menos de tres meses no se anualiza');
});

test('antes de fin de año: ahorro al aflorar una pérdida, tope del 25 % y margen para realizar ganancias', async () => {
  const { yearEnd } = await import('../src/lib/calc.js');
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≠ ${b}`);
  const pos = (isin, sh, unit, price) => {
    const p = { isin, name: isin, sh, cost: sh * unit, lots: [{ sh, unit, d: '2024-01-10' }], evs: [{ k: 'B', d: '2024-01-10', sh }] };
    return { p, has: true, v: sh * price };
  };
  const lose = pos('L', 10, 100, 50); // −500 latentes (−501 con la comisión)
  const win = pos('W', 10, 100, 130);
  const sold = (reF, d = '2026-03-01') => ({ k: 'S', d, sh: 1, net: 1000 + reF, csF: 1000, reF, re: reF, sa: 0, lotsUsed: [], p: { isin: 'Z', name: 'Z', evs: [] } });

  // Con 2.000 € de ganancias ya realizadas, aflorar −501 ahorra el 19 % de 501.
  const a = yearEnd([lose, win], [sold(2000)], [], {}, '2026-11-14');
  assert.equal(a.year, '2026');
  assert.deepEqual(a.losses.map((r) => r.x.p.isin), ['L']);
  close(a.losses[0].gain, -501);
  close(a.losses[0].saving, 501 * 0.19);
  close(a.losses[0].carried, 0);
  assert.equal(a.room, 0);
  close(a.rows.find((r) => r.x.p.isin === 'W').saving, -(299 * 0.19)); // vender la ganadora sube la cuota
  assert.equal(a.noRebuyUntil, '2027-01-14');

  // Sin ganancias, solo compensa el 25 % de los rendimientos (400 € de dividendos → 100 €) y el resto queda pendiente.
  const div = { k: 'D', d: '2026-05-01', g: 400, tax: 76, net: 324, p: { isin: 'ES0000000001', name: 'D' } };
  const b = yearEnd([lose], [], [div], {}, '2026-11-14');
  close(b.losses[0].saving, 100 * 0.19);
  close(b.losses[0].carried, 401);

  // Con pérdidas ya realizadas hay margen para realizar ganancias gratis; vender la ganadora no cuesta nada.
  const c = yearEnd([win], [sold(-800)], [], {}, '2026-11-14');
  close(c.room, 800);
  assert.equal(c.losses.length, 0);
  close(c.rows[0].saving, 0);
});

test('proyección: interés compuesto con aportaciones, meta y aportación habitual', async () => {
  const { project, monthsToGoal, monthlyContribution } = await import('../src/lib/calc.js');
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
  const flat = project({ start: 1000, monthly: 100, rate: 0, years: 2 });
  assert.equal(flat.length, 25);
  close(flat.at(-1).v, 3400);
  close(flat.at(-1).put, 3400);
  const one = project({ start: 1000, monthly: 0, rate: 10, years: 3 });
  close(one[12].v, 1100); close(one[36].v, 1331);
  // Aportando 100 al final de cada mes al 12 % anual: anualidad con el tipo mensual equivalente.
  const r = 1.12 ** (1 / 12) - 1;
  close(project({ start: 0, monthly: 100, rate: 12, years: 1 }).at(-1).v, (100 * ((1 + r) ** 12 - 1)) / r);
  assert.equal(monthsToGoal(flat, 1000), 0);
  assert.equal(monthsToGoal(flat, 2000), 10);
  assert.equal(monthsToGoal(flat, 1e6), null);
  // Media de los 12 meses completos anteriores: no cuenta el mes en curso ni lo de hace más de un año.
  const all = [
    { k: 'B', d: '2026-11-03', net: 9999 }, { k: 'B', d: '2026-10-15', net: 1200 }, { k: 'S', d: '2026-02-01', net: 600 },
    { k: 'D', d: '2026-03-01', net: 50 }, { k: 'B', d: '2025-11-01', net: 600 }, { k: 'B', d: '2025-10-31', net: 5000 },
  ];
  close(monthlyContribution(all, '2026-11-14'), 100);
});
