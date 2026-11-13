import test from 'node:test';
import assert from 'node:assert/strict';
import { mccCategory, categoryOf, isSpend, CATS } from '../src/lib/categories.js';

test('categoría automática por MCC', () => {
  assert.equal(mccCategory('5411'), 'super');
  assert.equal(mccCategory('5812'), 'food');
  assert.equal(mccCategory('5814'), 'food');
  assert.equal(mccCategory('4121'), 'transport');
  assert.equal(mccCategory('5541'), 'fuel');
  assert.equal(mccCategory('5912'), 'health');
  assert.equal(mccCategory('4899'), 'subs');
  assert.equal(mccCategory('6011'), 'cash');
  assert.equal(mccCategory('3058'), 'travel'); // aerolínea con código propio
  assert.equal(mccCategory('5651'), 'shopping'); // ropa: resto del comercio minorista
  assert.equal(mccCategory(''), 'other');
  assert.equal(mccCategory('1234'), 'other');
});

test('la categoría elegida para un comercio manda sobre la automática', () => {
  const pay = ['2025-01-02', 'card', -12.5, 'MERCADONA', '5411'];
  assert.equal(categoryOf(pay), 'super');
  assert.equal(categoryOf(pay, { MERCADONA: 'home' }), 'home');
  assert.equal(categoryOf(['2025-01-03', 'withdrawal', -300, 'Ana']), 'transfer');
  assert.equal(categoryOf(['2025-01-03', 'withdrawal', -600, 'Casero'], { Casero: 'home' }), 'home');
  assert.equal(categoryOf(['2025-01-04', 'card', -10]), 'other'); // sin MCC (datos antiguos o comisiones)
});

test('qué es gasto', () => {
  assert.ok(isSpend(['d', 'card', -5]));
  assert.ok(isSpend(['d', 'withdrawal', -5]));
  assert.ok(!isSpend(['d', 'card', 5])); // devolución
  assert.ok(!isSpend(['d', 'invest', -5]));
  assert.equal(new Set(CATS.map((c) => c[0])).size, CATS.length);
});

test('nombres en mayúsculas, legibles', async () => {
  const { prettyName } = await import('../src/lib/categories.js');
  assert.equal(prettyName('MERCADONA'), 'Mercadona');
  assert.equal(prettyName('LA TAGLIATELLA'), 'La Tagliatella');
  assert.equal(prettyName('BAR EL RINCÓN'), 'Bar el Rincón');
  assert.equal(prettyName('NETFLIX.COM'), 'Netflix.com');
  assert.equal(prettyName('Ana García'), 'Ana García'); // ya viene bien escrito
  assert.equal(prettyName(''), '');
});

test('pagos recurrentes: una vez al mes, casi el mismo importe y aún activos', async () => {
  const { recurring } = await import('../src/lib/categories.js');
  const moves = [];
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, '0');
    moves.push([`2026-${mm}-05`, 'card', -13.99, 'NETFLIX.COM', '4899']); // suscripción
    moves.push([`2026-${mm}-10`, 'card', -(30 + m * 5), 'MERCADONA', '5411']); // varía mucho
    moves.push([`2026-${mm}-20`, 'card', -40, 'MERCADONA', '5411']); // varias veces al mes
    if (m % 2) moves.push([`2026-${mm}-15`, 'withdrawal', -20, 'Ana']); // cada dos meses
    if (m <= 4) moves.push([`2026-${mm}-01`, 'card', -30, 'GIMNASIO', '7997']); // dado de baja
    moves.push([`2026-${mm}-17`, 'card', -(40 + (m % 4) * 7), 'REPSOL', '5541']); // una vez al mes, pero varía: no es un cargo fijo
  }
  const r = recurring(moves, '2026-10-20');
  assert.deepEqual(r.map((x) => x.name), ['NETFLIX.COM']);
  assert.equal(r[0].amount, 13.99);
  assert.equal(r[0].day, 5);
  assert.ok(Math.abs(r[0].yearly - 167.88) < 1e-9);
});
