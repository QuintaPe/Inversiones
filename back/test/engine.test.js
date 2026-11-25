import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, buildPortfolio, buildIncome, isShareSplit, CsvError, buildCash, manualRow } from '../src/engine.js';

const HEAD = '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id"';
const row = (o) => {
  const base = { datetime: '', date: '', account_type: 'DEFAULT', category: 'TRADING', type: 'BUY', asset_class: 'STOCK', name: 'Acme', symbol: 'XX0000000001', shares: '', price: '', amount: '', fee: '', tax: '', currency: 'EUR', original_amount: '', original_currency: '', fx_rate: '', description: '', transaction_id: '' };
  const r = { ...base, ...o, date: o.datetime.slice(0, 10) };
  return Object.values(r).map((v) => `"${v}"`).join(',');
};
const csv = (...rows) => [HEAD, ...rows].join('\n');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('coste medio ponderado, venta parcial y dividendos', () => {
  const { rows } = parseCsv(csv(
    row({ datetime: '2025-01-01T10:00:00Z', shares: '10', price: '10', amount: '-100.00', fee: '-1.00', transaction_id: 'aaaaaaaa-0001' }),
    row({ datetime: '2025-02-01T10:00:00Z', shares: '10', price: '20', amount: '-200.00', fee: '-1.00', tax: '-0.40', transaction_id: 'aaaaaaaa-0002' }),
    row({ datetime: '2025-03-01T10:00:00Z', type: 'SELL', shares: '-5', price: '30', amount: '150.00', fee: '-1.00', transaction_id: 'aaaaaaaa-0003' }),
    row({ datetime: '2025-04-01T10:00:00Z', category: 'CASH', type: 'DIVIDEND', shares: '15', amount: '3.00', tax: '-0.57', transaction_id: 'aaaaaaaa-0004' }),
    row({ datetime: '2025-04-02T10:00:00Z', category: 'CASH', type: 'CARD_TRANSACTION', name: 'Bar', symbol: '', amount: '-5', transaction_id: 'aaaaaaaa-0005' }),
  ));
  assert.equal(rows.length, 5);
  const card = rows.find((r) => r.type === 'CARD_TRANSACTION');
  assert.deepEqual([card.name, card.description, card.amount], ['Bar', '', '-5'], 'de la tarjeta se guarda el comercio, no el concepto');
  const { positions } = buildPortfolio(rows);
  assert.equal(positions.length, 1);
  const p = positions[0];
  // Entrada: 101 + 201,40 = 302,40 → medio 15,12; se venden 5 → coste 75,60
  close(p.sh, 15);
  close(p.cost, 302.4 - 75.6);
  const sell = p.evs.find((e) => e.k === 'S');
  close(sell.avb, 15.12);
  close(sell.re, 149 - 75.6);
  // FIFO: las 5 vendidas salen del primer lote (101 € / 10 acc. = 10,10 €)
  close(sell.csF, 50.5);
  close(sell.reF, 149 - 50.5);
  assert.equal(sell.lotsUsed.length, 1);
  const div = p.evs.find((e) => e.k === 'D');
  close(div.net, 2.43);
  assert.equal(p.open, true);
});

test('venta total cierra la posición a cero', () => {
  const { rows } = parseCsv(csv(
    row({ datetime: '2025-01-01T10:00:00Z', shares: '0.3572980000', price: '229.5', amount: '-82.00', transaction_id: 'b-1' }),
    row({ datetime: '2025-01-02T10:00:00Z', type: 'SELL', shares: '-0.3572980000', price: '242.5', amount: '86.64', transaction_id: 'b-2' }),
  ));
  const [p] = buildPortfolio(rows).positions;
  assert.equal(p.open, false);
  assert.equal(p.sh, 0);
  assert.equal(p.cost, 0);
  close(p.evs[1].re, 4.64);
});

test('Private Markets: la compra sin importe toma coste y comisión del pre-pago', () => {
  const pm = { asset_class: 'PRIVATE_FUND', name: 'Private Equity', symbol: 'LU0000000001' };
  const { rows } = parseCsv(csv(
    row({ ...pm, datetime: '2025-09-19T08:00:00Z', category: 'CASH', type: 'PRIVATE_MARKET_BUY', amount: '-10000.000000', fee: '-1.00', description: 'Private Markets pre-payment for buy order: 05a2243f-bb59-471c-ae1a-704d36dc8e27', transaction_id: 'c-1' }),
    row({ ...pm, datetime: '2025-09-19T08:00:01Z', category: 'CASH', type: 'PRIVATE_MARKET_BUY', amount: '-100.000000', description: 'Private Markets pre-payment for buy order: 704eccc0-ddfa-471e-b624-1c7d44b70537', transaction_id: 'c-2' }),
    row({ datetime: '2025-09-19T08:00:02Z', category: 'CASH', type: 'BONUS', asset_class: '', name: '', symbol: '', amount: '100.000000', description: 'Private Markets bonus 704eccc0-ddfa-471e-b624-1c7d44b70537 for buy order: 05a2243f-bb59-471c-ae1a-704d36dc8e27', transaction_id: 'c-3' }),
    row({ ...pm, datetime: '2025-11-04T09:00:00Z', shares: '1', price: '100', description: 'BUY', transaction_id: 'c-4' }),
    row({ ...pm, datetime: '2025-11-04T09:00:01Z', shares: '100', price: '100', description: 'BUY', transaction_id: 'c-5' }),
  ));
  const [p] = buildPortfolio(rows).positions;
  assert.equal(p.grp, 'pm');
  close(p.sh, 101);
  close(p.cost, 10101);
  assert.match(p.evs[0].note, /bonus/);
  assert.equal(p.evs[1].fee, 1);
});

test('rechaza un CSV que no es de Trade Republic', () => {
  assert.throws(() => parseCsv('a,b\n1,2\n'), CsvError);
});

test('split: multiplica las acciones y los lotes sin tocar el coste', () => {
  const { rows } = parseCsv(csv(
    row({ datetime: '2025-01-01T10:00:00Z', shares: '10', price: '100', amount: '-1000.00', transaction_id: 's-1' }),
    row({ datetime: '2025-03-01T10:00:00Z', type: 'SELL', shares: '-20', price: '30', amount: '600.00', transaction_id: 's-2' }),
  ));
  // Sin el split, la venta de 20 dejaría la posición en negativo.
  assert.ok(buildPortfolio(rows).positions[0].sh < 0);
  const splits = { XX0000000001: [['2024-06-01', 2], ['2025-02-01', 4]] }; // el de 2024 es anterior a la compra
  const { positions: [p], lastDate } = buildPortfolio(rows, splits);
  assert.deepEqual(p.evs.map((e) => e.k), ['B', 'X', 'S']);
  close(p.evs[1].sa, 40);
  close(p.evs[1].ca, 1000);
  close(p.sh, 20);
  close(p.cost, 500);
  const sell = p.evs[2];
  close(sell.csF, 500); // 20 acciones nuevas a 25 €
  close(sell.reF, 100);
  close(p.lots[0].unit, 25);
  assert.equal(lastDate, '2025-03-01');
  // El ajuste de una escisión (1,067) no es un split: las acciones no cambian.
  assert.deepEqual([4, 1.5, 20, 0.1, 1.25].map(isShareSplit), [true, true, true, true, true]);
  assert.deepEqual([1.067, 1, 0, 1.0331].map(isShareSplit), [false, false, false, false]);
  close(buildPortfolio(rows.slice(0, 1), { XX0000000001: [['2025-02-01', 1.067]] }).positions[0].sh, 10);
});

test('buildIncome: intereses y premios por ejercicio con su retención', () => {
  const cash = { category: 'CASH', asset_class: '', name: '', symbol: '' };
  const { rows } = parseCsv(csv(
    row({ ...cash, datetime: '2025-01-31T10:00:00Z', type: 'INTEREST_PAYMENT', amount: '10.00', tax: '-1.90', transaction_id: 'i-1' }),
    row({ ...cash, datetime: '2025-02-28T10:00:00Z', type: 'INTEREST_PAYMENT', amount: '5.00', tax: '-0.95', transaction_id: 'i-2' }),
    row({ datetime: '2025-03-01T10:00:00Z', category: 'CASH', type: 'BENEFITS_SAVEBACK', amount: '15.00', transaction_id: 'i-3' }),
    row({ datetime: '2025-03-01T10:00:01Z', shares: '1', price: '15', amount: '-15.00', tax: '-2.85', transaction_id: 'i-4' }),
    row({ ...cash, datetime: '2026-01-31T10:00:00Z', type: 'INTEREST_PAYMENT', amount: '1.00', transaction_id: 'i-5' }),
  ));
  const inc = buildIncome(rows);
  close(inc['2025'].interest.g, 15);
  close(inc['2025'].interest.t, 2.85);
  assert.equal(inc['2025'].interest.n, 2);
  close(inc['2025'].reward.g, 15);
  close(inc['2025'].reward.t, 2.85);
  close(inc['2026'].interest.g, 1);
});

test('buildIncome: intereses del 31 de diciembre y retención del bonus de Private Markets', () => {
  const r = (o) => ({ category: 'CASH', asset_class: '', name: '', symbol: '', amount: '', fee: '', tax: '', shares: '', description: '', ...o });
  const inc = buildIncome([
    // Los intereses de diciembre llegan el 1 de enero: cuentan en el año anterior.
    r({ transaction_id: 'a', type: 'INTEREST_PAYMENT', date: '2026-01-01', amount: '14.65', tax: '-2.78' }),
    r({ transaction_id: 'b', type: 'BONUS', date: '2025-09-19', amount: '100.000000' }),
    r({ transaction_id: 'c', type: 'BUY', category: 'TRADING', asset_class: 'PRIVATE_FUND', symbol: 'LU3170240538', date: '2025-10-22', shares: '100' }),
    // El ajuste del bonus llega con +19, pero es la retención del 19 % sobre él.
    r({ transaction_id: 'd', type: 'MANUAL', date: '2025-10-22', amount: '0.000000', tax: '19.00', description: 'Capital Gains Tax' }),
  ]);
  close(inc['2025'].interest.g, 14.65);
  close(inc['2025'].interest.t, 2.78);
  close(inc['2025'].reward.g, 100);
  close(inc['2025'].reward.t, 19);
  assert.equal(inc['2026'], undefined);
});

test('buildIncome: lo cobrado antes de la primera retención española va aparte', () => {
  const r = (o) => ({ category: 'CASH', asset_class: '', name: '', symbol: '', amount: '', fee: '', tax: '', shares: '', description: '', ...o });
  const inc = buildIncome([
    r({ transaction_id: 'a', type: 'INTEREST_PAYMENT', date: '2025-05-01', amount: '2.23' }), // sucursal alemana
    r({ transaction_id: 'b', type: 'BENEFITS_SAVEBACK', date: '2025-06-02', amount: '1.23' }),
    r({ transaction_id: 'c', type: 'INTEREST_PAYMENT', date: '2025-07-01', amount: '2.24', tax: '-0.43' }), // ya en España
    r({ transaction_id: 'd', type: 'INTEREST_PAYMENT', date: '2025-08-01', amount: '1.30', tax: '-0.25' }),
  ])['2025'];
  assert.equal(inc.since, '2025-06-30');
  close(inc.pre.g, 3.46);
  assert.equal(inc.pre.n, 2);
  close(inc.interest.g + inc.reward.g - inc.pre.g, 3.54);
});

test('externos: un plan de pensiones (código de la DGSFP) y lo marcado como externo van aparte de acciones y ETF', () => {
  const { rows } = parseCsv(csv(
    // Anotado como fondo, pero su identificador es un código de plan: es un plan de pensiones.
    row({ datetime: '2025-12-12T10:00:00Z', asset_class: 'FUND', name: 'MyInvestor Indexado Global, PP', symbol: 'N5396', shares: '87.368', price: '17.1687', amount: '-1500.00', transaction_id: 'e-1' }),
    row({ datetime: '2025-12-13T10:00:00Z', asset_class: 'EXTERNAL', name: 'Fondo en otro banco', symbol: 'ES0000000001', shares: '10', price: '10', amount: '-100.00', transaction_id: 'e-2' }),
    row({ datetime: '2025-12-14T10:00:00Z', name: 'Acme', symbol: 'XX0000000001', shares: '1', price: '50', amount: '-50.00', transaction_id: 'e-3' }),
  ));
  const by = Object.fromEntries(buildPortfolio(rows).positions.map((p) => [p.isin, p]));
  assert.deepEqual([by.N5396.cls, by.N5396.grp], ['PENSION_PLAN', 'ext']);
  assert.deepEqual([by.ES0000000001.cls, by.ES0000000001.grp], ['EXTERNAL', 'ext']);
  assert.deepEqual([by.XX0000000001.cls, by.XX0000000001.grp], ['STOCK', 'ac']);
});

test('efectivo: lo anotado como externo (o marcado sin efectivo) no toca el saldo de Trade Republic', () => {
  const { rows } = parseCsv(csv(
    row({ datetime: '2025-01-01T10:00:00Z', category: 'CASH', type: 'CUSTOMER_INBOUND', asset_class: '', name: '', symbol: '', amount: '1000.00', transaction_id: 'k-1' }),
  ));
  const op = (o) => manualRow({ type: 'BUY', date: '2025-02-01', fee: 0, tax: 0, ...o }, `manual-${o.isin}`);
  const plan = op({ isin: 'N5396', name: 'Plan', asset_class: 'PENSION_PLAN', shares: 87.368, price: 17.1687 });
  const otherBroker = op({ isin: 'US0378331005', name: 'Apple', asset_class: 'STOCK', shares: 1, price: 200, cash: false });
  const here = op({ isin: 'US5949181045', name: 'Microsoft', asset_class: 'STOCK', shares: 1, price: 300 });
  assert.equal(otherBroker.account_type, 'EXTERNAL');
  assert.equal(here.account_type, '');
  assert.equal(buildCash([...rows, plan, otherBroker]).balance, 1000, 'ni el plan ni la compra en otro bróker');
  assert.equal(buildCash([...rows, plan, otherBroker, here]).balance, 700, 'la compra normal sí descuenta');
  // Al editar se sabe cómo se anotó.
  const evs = Object.fromEntries(buildPortfolio([...rows, otherBroker, here]).positions.map((p) => [p.isin, p.evs[0]]));
  assert.equal(evs.US0378331005.noCash, true);
  assert.equal(evs.US5949181045.noCash, undefined);
});

test('parseCsv: el día del traspaso a la sucursal española sale de las filas MIGRATION', () => {
  const mig = (id, dt) => row({ datetime: dt, category: 'DELIVERY', type: 'MIGRATION', amount: '', transaction_id: id });
  const r = parseCsv(csv(
    row({ datetime: '2025-03-01T10:00:00Z', transaction_id: 'b-1' }),
    mig('m-2', '2025-06-11T00:13:07Z'),
    mig('m-1', '2025-06-10T00:13:07Z'),
  ));
  assert.equal(r.migrated, '2025-06-10');
  assert.ok(r.rows.every((x) => x.type !== 'MIGRATION')); // no entran en la cartera
  assert.equal(parseCsv(csv(row({ datetime: '2025-03-01T10:00:00Z', transaction_id: 'b-1' }))).migrated, null);
});
