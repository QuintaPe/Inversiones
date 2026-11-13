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
