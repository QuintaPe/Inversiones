import test from 'node:test';
import assert from 'node:assert/strict';
import { decimate } from '../src/lib/decimate.js';

test('decimate conserva extremos, extremos de columna y huecos', () => {
  const vals = [1, 5, 2, 3, null, 4, 4, 9, 0, 7];
  const px = (i) => Math.floor(i / 4); // 4 valores por columna
  const idx = decimate(vals.length, (i) => vals[i], px);
  // columna 0: 0..3 → primero 0, mínimo 0, máximo 1, último 3; hueco 4; columna 1: 5..7; columna 2: 8,9
  assert.deepEqual(idx, [0, 1, 3, 4, 5, 7, 8, 9]);
  const big = Array.from({ length: 5000 }, (_, i) => Math.sin(i / 50));
  const few = decimate(big.length, (i) => big[i], (i) => (i / big.length) * 300);
  assert.ok(few.length <= 4 * 301, `${few.length} puntos`);
  assert.equal(Math.max(...few.map((i) => big[i])), Math.max(...big));
  assert.equal(Math.min(...few.map((i) => big[i])), Math.min(...big));
});

test('marcas del eje de fechas: años, meses o días según el tramo', async () => {
  const { timeTicks } = await import('../src/lib/ticks.js');
  const utc = (y, m, d = 1) => Date.UTC(y, m, d);
  const labels = (t0, t1, w, room) => timeTicks(t0, t1, w, room).map((k) => k.s);
  // 15 años en 1100 px: un año por marca, nunca «ene 28, feb 29…».
  const long = timeTicks(utc(2026, 10), utc(2041, 10), 1100);
  assert.deepEqual(long.map((k) => k.s), ['2028', '2030', '2032', '2034', '2036', '2038', '2040']);
  assert.ok(long.every((k) => new Date(k.t).getUTCMonth() === 0 && new Date(k.t).getUTCDate() === 1));
  // Un año: meses alineados con el trimestre natural.
  assert.deepEqual(labels(utc(2026, 1, 10), utc(2027, 1, 10), 400), ['abr 26', 'jul 26', 'oct 26', 'ene 27']);
  // Tres meses con sitio: todos los meses.
  assert.deepEqual(labels(utc(2026, 7, 14), utc(2026, 10, 14), 800), ['sept 26', 'oct 26', 'nov 26']);
  // Dos semanas: días, dentro del tramo.
  const short = timeTicks(utc(2026, 10, 1), utc(2026, 10, 14), 400);
  assert.ok(short.length >= 1 && short.every((k) => k.t > utc(2026, 10, 1) && k.t < utc(2026, 10, 14)));
  assert.match(short[0].s, /^\d+ nov$/);
  // Nunca más marcas de las que caben, ni fuera del eje.
  for (const [a, b, w] of [[utc(2010, 0), utc(2026, 5), 320], [utc(2025, 0), utc(2026, 11), 320], [utc(2026, 0), utc(2026, 1), 1200]]) {
    const xt = timeTicks(a, b, w);
    assert.ok(xt.length <= Math.max(2, Math.floor(w / 80)) + 1, `${xt.length} marcas en ${w}px`);
    assert.ok(xt.every((k) => k.t > a && k.t < b));
  }
  assert.deepEqual(timeTicks(5, 5, 300), []);
});
