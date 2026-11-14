import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceAt, netWorth, netWorthSeries } from '../../shared/wealth.js';

const piso = { id: 'p', name: 'Piso', kind: 'property', balances: [{ d: '2025-01-10', amount: 180000 }, { d: '2025-03-05', amount: 185000 }] };
const hipoteca = { id: 'h', name: 'Hipoteca', kind: 'debt', balances: [{ d: '2025-02-01', amount: 90000 }, { d: '2025-04-01', amount: 88000 }] };

test('patrimonio: vale el último saldo anotado hasta cada día', () => {
  assert.equal(balanceAt(piso.balances, '2025-01-09'), null);
  assert.equal(balanceAt(piso.balances, '2025-01-10').amount, 180000);
  assert.equal(balanceAt(piso.balances, '2025-03-04').amount, 180000);
  assert.equal(balanceAt(piso.balances, '2099-01-01').amount, 185000);
});

test('patrimonio neto de hoy: lo que tienes menos lo que debes', () => {
  const w = netWorth({ portfolio: 40000, cash: 6000, accounts: [piso, hipoteca] }, '2025-04-15');
  assert.equal(w.assets, 40000 + 6000 + 185000);
  assert.equal(w.debts, 88000);
  assert.equal(w.total, 143000);
  assert.deepEqual(w.parts.map((p) => [p.key, p.v, p.d]), [['portfolio', 40000, null], ['tr-cash', 6000, null], ['p', 185000, '2025-03-05'], ['h', 88000, '2025-04-01']]);
  // Sin cartera, sin efectivo conocido y con una cuenta aún sin saldo en esa fecha.
  assert.deepEqual(netWorth({ portfolio: 0, cash: null, accounts: [hipoteca] }, '2025-01-01'), { total: 0, assets: 0, debts: 0, parts: [] });
});

test('evolución del patrimonio: fin de cada mes y hoy, sumando cada parte desde que existe', () => {
  const hist = { d: ['2025-02-15', '2025-02-28', '2025-03-31', '2025-04-14'], v: [1000, 1100, 1300, 1250] };
  const cashDays = [['2025-01-20', 500], ['2025-03-10', 700]];
  const s = netWorthSeries({ hist, cashDays, accounts: [piso, hipoteca] }, '2025-04-15');
  assert.deepEqual(s.map((p) => p.d), ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-15']);
  assert.deepEqual(s[0], { d: '2025-01-31', portfolio: 0, cash: 500, other: 180000, debt: 0, total: 180500 });
  assert.deepEqual(s[1], { d: '2025-02-28', portfolio: 1100, cash: 500, other: 180000, debt: 90000, total: 91600 });
  assert.deepEqual(s[2], { d: '2025-03-31', portfolio: 1300, cash: 700, other: 185000, debt: 90000, total: 97000 });
  assert.deepEqual(s[3], { d: '2025-04-15', portfolio: 1250, cash: 700, other: 185000, debt: 88000, total: 98950 });
  assert.deepEqual(netWorthSeries({}, '2025-04-15'), []);
  // Todo empieza hoy: un solo punto.
  assert.equal(netWorthSeries({ accounts: [{ kind: 'cash', balances: [{ d: '2025-04-15', amount: 5 }] }] }, '2025-04-15').length, 1);
  // Cambio de año.
  assert.deepEqual(netWorthSeries({ cashDays: [['2024-11-30', 1]] }, '2025-01-02').map((p) => p.d), ['2024-11-30', '2024-12-31', '2025-01-02']);
});

test('plan frente a realidad: lo que esperabas tener hoy y la diferencia', async () => {
  const { planProgress, monthsBetween } = await import('../../shared/plan.js');
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
  assert.equal(monthsBetween('2026-01-15', '2026-01-15'), 0);
  assert.equal(monthsBetween('2026-01-15', '2026-02-14'), 0);
  assert.equal(monthsBetween('2026-01-15', '2026-02-15'), 1);
  assert.equal(monthsBetween('2025-11-30', '2026-11-14'), 11);
  assert.equal(monthsBetween('2026-05-01', '2026-01-01'), 0);

  // Sin rentabilidad: partida más las aportaciones de los meses completos.
  const flat = planProgress({ start: 10000, since: '2026-01-10', monthly: 500, rate: 0 }, 13500, '2026-07-09');
  assert.equal(flat.months, 5);
  close(flat.expected, 12500);
  close(flat.diff, 1000);
  close(flat.pct, 8);
  // Con rentabilidad, un año sin aportar es exactamente ese porcentaje.
  const year = planProgress({ start: 10000, since: '2025-11-14', monthly: 0, rate: 6 }, 10000, '2026-11-14');
  close(year.expected, 10600);
  close(year.diff, -600);
  // Recién fijado: sin diferencia. Sin fijar: nada que medir.
  close(planProgress({ start: 5000, since: '2026-11-14', monthly: 300, rate: 5 }, 5000, '2026-11-14').diff, 0);
  assert.equal(planProgress({ monthly: 300, rate: 5, start: null, since: null }, 5000), null);
  assert.equal(planProgress(undefined, 5000), null);
});
