import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReturns, correlation, riskReport } from '../../shared/risk.ts';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const day = (n) => new Date(Date.UTC(2025, 0, 6) + n * 86400000).toISOString().slice(0, 10); // lunes 6 de enero de 2025
/** Cierres de los viernes de `rets.length` semanas seguidas a partir de 100. */
const prices = (rets, start = 100) => {
  let p = start;
  return [[day(4), p], ...rets.map((r, i) => [day(4 + 7 * (i + 1)), (p *= 1 + r)])];
};
// Rentabilidades semanales deterministas, con algo de forma.
const wave = (n, amp, phase = 0) => Array.from({ length: n }, (_, i) => amp * Math.sin(i * 1.3 + phase) + amp * 0.3 * Math.cos(i * 0.37));

test('rentabilidad semanal: último cierre de cada semana, sin saltar semanas vacías', () => {
  const rows = [[day(0), 100], [day(2), 104], [day(4), 110], [day(7), 121], [day(21), 200], [day(28), 100]];
  const r = [...weeklyReturns(rows).values()];
  // Semana 2 sobre la 1 (+10 %); la 4 no tiene semana anterior con dato; la 5 sobre la 4 (−50 %).
  assert.equal(r.length, 2);
  close(r[0], 0.1);
  close(r[1], -0.5);
});

test('correlación: idénticos 1, opuestos −1, pocas semanas en común null', () => {
  const a = weeklyReturns(prices(wave(30, 0.02)));
  close(correlation(a, weeklyReturns(prices(wave(30, 0.04), 50))), 1);
  close(correlation(a, weeklyReturns(prices(wave(30, -0.02)))), -1);
  assert.equal(correlation(a, weeklyReturns(prices(wave(5, 0.02)))), null);
});

test('informe de riesgo: dos valores iguales no diversifican; uno opuesto sí; el riesgo se reparte al 100 %', () => {
  const up = wave(40, 0.02), other = wave(40, 0.03, 2);
  const same = riskReport([{ key: 'A', v: 500, rows: prices(up) }, { key: 'B', v: 500, rows: prices(up, 20) }]);
  assert.equal(same.weeks, 40);
  close(same.ratio, 1);
  close(same.effN, 2);
  close(same.vol, same.assets[0].vol);
  assert.deepEqual(same.assets.map((x) => Math.round(x.share)), [50, 50]);
  close(same.corr[0][1], 1);

  const mix = riskReport([{ key: 'A', v: 600, rows: prices(up) }, { key: 'B', v: 300, rows: prices(other) }, { key: 'C', v: 100, rows: prices(wave(40, -0.02)) }]);
  assert.ok(mix.ratio > 1, `ratio ${mix.ratio}`);
  assert.ok(mix.vol < mix.weighted);
  close(mix.assets.reduce((t, x) => t + x.share, 0), 100, 1e-6);
  close(mix.assets.reduce((t, x) => t + x.w, 0), 100, 1e-6);
  close(mix.effN, 1 / (0.36 + 0.09 + 0.01));
  // C va al revés que A: resta riesgo y es la pareja menos correlacionada.
  assert.ok(mix.assets[2].share < 0);
  close(mix.corr[0][2], -1);
  assert.deepEqual([mix.pairs.at(-1).a, mix.pairs.at(-1).b], ['A', 'C']);
  close(mix.corr[1][0], mix.corr[0][1]);

  // Poco histórico o sin valor: fuera del cálculo y avisado; con menos de dos válidos no hay informe.
  const few = riskReport([{ key: 'A', v: 1, rows: prices(up) }, { key: 'B', v: 1, rows: prices(other) }, { key: 'N', v: 1, rows: prices(wave(4, 0.01)) }, { key: 'Z', v: 0, rows: prices(up) }]);
  assert.deepEqual(few.skipped, ['N']);
  assert.deepEqual(few.assets.map((x) => x.key), ['A', 'B']);
  assert.equal(riskReport([{ key: 'A', v: 1, rows: prices(up) }, { key: 'N', v: 1, rows: [] }]), null);
  assert.equal(riskReport([]), null);
});

test('índice propio: una parte lo pone primero; una mezcla pondera desde el primer día en que todas cotizan', async () => {
  const { withBlend, MINE } = await import('../../shared/benchmarks.ts');
  const h = {
    d: ['d0', 'd1', 'd2', 'd3'],
    benchmarks: [
      { key: 'world', name: 'MSCI World', c: [100, 110, 121, 121] },
      { key: 'sp500', name: 'S&P 500', c: [50, 50, 50, 50] },
      { key: 'bonds', name: 'Bonos globales', c: [null, 200, null, 220] },
    ],
  };
  assert.equal(withBlend(h, null), h);
  assert.equal(withBlend(h, { parts: [{ key: 'nope', w: 100 }] }), h);
  assert.deepEqual(withBlend(h, { parts: [{ key: 'sp500', w: 100 }] }).benchmarks.map((b) => b.key), ['sp500', 'world', 'bonds']);
  const mix = withBlend(h, { parts: [{ key: 'world', w: 80 }, { key: 'bonds', w: 20 }] });
  assert.deepEqual(mix.benchmarks.map((b) => b.key), [MINE, 'world', 'sp500', 'bonds']);
  // Empieza en d1 (los bonos no cotizan antes); en d2 los bonos arrastran su último cierre.
  assert.deepEqual(mix.benchmarks[0].c, [null, 100, 108, 110]);
  assert.equal(mix.benchmarks[0].mix, '80 % MSCI World + 20 % Bonos globales');
  assert.equal(h.benchmarks.length, 3);
});
