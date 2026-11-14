import test from 'node:test';
import assert from 'node:assert/strict';
import { cashHealth, averageBalance } from '../../shared/cash.js';

test('saldo medio con el saldo escalonado día a día', () => {
  const days = [['2025-01-01', 100], ['2025-01-11', 200]];
  // 10 días a 100 y 21 días a 200 en enero
  assert.ok(Math.abs(averageBalance(days, '2025-01-01', '2025-01-31') - (10 * 100 + 21 * 200) / 31) < 1e-9);
  // empieza antes del primer movimiento: saldo 0 hasta entonces
  assert.ok(Math.abs(averageBalance(days, '2024-12-31', '2025-01-01') - 50) < 1e-9);
});

test('salud del efectivo: medias de los meses completos, colchón, ahorro, rentabilidad y mes en curso', () => {
  const months = {};
  for (let k = 1; k <= 12; k++) {
    const m = `2025-${String(k).padStart(2, '0')}`;
    months[m] = { deposit: 2000, card: -800, withdrawal: -200, interest: 10, invest: -500 };
  }
  months['2026-01'] = { deposit: 2000, card: -300 }; // mes en curso, a medias
  const cash = { balance: 6000, months, days: [['2025-01-01', 6000], ['2026-01-10', 6000]] };
  const h = cashHealth(cash);
  assert.equal(h.asOf, '2026-01-10');
  assert.equal(h.months.length, 12);
  assert.equal(h.avgSpend, 1000);
  assert.equal(h.avgIncome, 2000);
  assert.equal(h.saveRate, 50);
  assert.equal(h.cushion, 6);
  assert.ok(Math.abs(h.yieldPct - 2) < 1e-9); // 120 € de intereses al año sobre 6.000 €
  assert.equal(h.now.spend, 300);
  assert.equal(h.now.day, 10);
  assert.ok(Math.abs(h.now.pace - 1000 * (10 / 31)) < 1e-9);
});

test('sin meses completos no hay medias', () => {
  const h = cashHealth({ balance: 100, months: { '2026-01': { deposit: 100 } }, days: [['2026-01-05', 100]] });
  assert.equal(h.avgSpend, null);
  assert.equal(h.cushion, null);
  assert.equal(h.saveRate, null);
  assert.equal(h.yieldPct, null);
});
