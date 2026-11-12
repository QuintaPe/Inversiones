import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, buildPortfolio, CsvError } from '../src/engine.js';

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
  assert.equal(rows.length, 4, 'las filas de tarjeta no se guardan');
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
