// Propiedades del motor con carteras aleatorias grandes. El motor calcula en coma flotante;
// aquí se compara con una referencia exacta en céntimos enteros (BigInt): si alguna vez la
// diferencia llega a medio céntimo, una cifra saldría distinta en pantalla o en la declaración.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolio, buildCash } from '../src/engine.js';

// Pseudoaleatorio con semilla: los casos son siempre los mismos.
const rng = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const cents = (n) => (n / 100).toFixed(2);
const HALF_CENT = 0.005;

/** Operaciones aleatorias de un valor: compras y ventas fraccionadas, y al final se vende todo si `closeAll`. */
function trades(seed, n, isin, closeAll) {
  const r = rng(seed);
  const rows = [];
  let units = 0n; // acciones en diezmilmillonésimas, como en el CSV (10 decimales)
  let bought = 0n, sold = 0n; // céntimos: pagado en compras (con comisión) y cobrado en ventas (sin ella)
  const SH = 10n ** 10n;
  const shares = (u) => `${u / SH}.${String(u % SH).padStart(10, '0')}`;
  const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 3 * 3600_000).toISOString();
  for (let i = 0; i < n; i++) {
    const last = closeAll && i === n - 1;
    const sell = last || (units > 0n && r() < 0.4);
    if (last && units === 0n) break;
    const price = (5 + r() * 400).toFixed(4);
    const fee = r() < 0.5 ? 100 : 0;
    if (sell) {
      const u = last ? units : (units * BigInt(1 + Math.floor(r() * 90))) / 100n || units;
      const amount = Math.max(1, Math.round((Number(u) / 1e10) * Number(price) * 100));
      units -= u; sold += BigInt(amount - fee);
      rows.push({ datetime: day(i), date: day(i).slice(0, 10), category: 'TRADING', type: 'SELL', asset_class: 'STOCK', name: isin, symbol: isin, shares: `-${shares(u)}`, price, amount: cents(amount), fee: fee ? `-${cents(fee)}` : '', tax: '', description: '', transaction_id: `${isin}-${i}` });
    } else {
      const u = BigInt(Math.floor(r() * 5e10)) + 1n;
      const amount = Math.max(1, Math.round((Number(u) / 1e10) * Number(price) * 100));
      units += u; bought += BigInt(amount + fee);
      rows.push({ datetime: day(i), date: day(i).slice(0, 10), category: 'TRADING', type: 'BUY', asset_class: 'STOCK', name: isin, symbol: isin, shares: shares(u), price, amount: `-${cents(amount)}`, fee: fee ? `-${cents(fee)}` : '', tax: '', description: '', transaction_id: `${isin}-${i}` });
    }
  }
  return { rows, units, bought, sold };
}

test('posición cerrada tras miles de operaciones: no queda nada y el resultado cuadra al céntimo', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const t = trades(seed, 4000, 'XX0000000001', true);
    const p = buildPortfolio(t.rows).positions[0];
    assert.equal(p.open, false);
    assert.equal(p.sh, 0);
    assert.equal(p.cost, 0);
    assert.equal(p.lots.length, 0);
    const exact = Number(t.sold - t.bought) / 100;
    const S = p.evs.filter((e) => e.k === 'S');
    const fifo = S.reduce((a, e) => a + e.reF, 0), avg = S.reduce((a, e) => a + e.re, 0);
    assert.ok(Math.abs(fifo - exact) < HALF_CENT, `FIFO ${fifo} ≠ ${exact} (semilla ${seed})`);
    assert.ok(Math.abs(avg - exact) < HALF_CENT, `coste medio ${avg} ≠ ${exact} (semilla ${seed})`);
  }
});

test('posición abierta: los lotes suman las acciones y el coste que queda, por FIFO y por coste medio', () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    const t = trades(seed, 4000, 'XX0000000002', false);
    const p = buildPortfolio(t.rows).positions[0];
    const exactSh = Number(t.units) / 1e10;
    assert.ok(Math.abs(p.sh - exactSh) < 1e-6, `acciones ${p.sh} ≠ ${exactSh}`);
    assert.ok(Math.abs(p.lots.reduce((a, l) => a + l.sh, 0) - p.sh) < 1e-6);
    const S = p.evs.filter((e) => e.k === 'S');
    const bought = Number(t.bought) / 100;
    // Lo comprado menos el coste de lo vendido es el coste de lo que queda.
    const leftFifo = bought - S.reduce((a, e) => a + e.csF, 0);
    assert.ok(Math.abs(p.lots.reduce((a, l) => a + l.sh * l.unit, 0) - leftFifo) < HALF_CENT);
    assert.ok(Math.abs(p.cost - (bought - S.reduce((a, e) => a + e.cs, 0))) < HALF_CENT);
    // Nunca se vende más de lo que hay ni queda un lote negativo.
    assert.ok(p.evs.every((e) => e.sa > -1e-9));
    assert.ok(p.lots.every((l) => l.sh > 0));
  }
});

// (Una de cada ocho operaciones cae a las 00:00:00 UTC, la misma hora exacta que el split de su día.)
test('un split no cambia el coste ni el resultado, solo el número de acciones', () => {
  const t = trades(21, 600, 'XX0000000003', true);
  const plain = buildPortfolio(t.rows).positions[0];
  const mid = t.rows[300].date;
  // Tras el split 4:1 el CSV trae cuatro veces más acciones a un cuarto del precio.
  const adj = t.rows.map((r) => (r.date >= mid ? { ...r, shares: String(Number(r.shares) * 4), price: String(Number(r.price) / 4) } : r));
  const split = buildPortfolio(adj, { XX0000000003: [[mid, 4]] }).positions[0];
  const sum = (p, k) => p.evs.filter((e) => e.k === 'S').reduce((a, e) => a + e[k], 0);
  assert.ok(Math.abs(sum(split, 'reF') - sum(plain, 'reF')) < HALF_CENT);
  assert.ok(Math.abs(sum(split, 're') - sum(plain, 're')) < HALF_CENT);
  assert.equal(split.open, false);
});

test('efectivo: el saldo de decenas de miles de movimientos es exacto al céntimo', () => {
  const r = rng(31);
  let exact = 0n;
  const rows = [];
  for (let i = 0; i < 40000; i++) {
    const inbound = i % 25 === 0;
    const amount = inbound ? 100000 + Math.floor(r() * 150000) : -(1 + Math.floor(r() * 9000));
    const tax = r() < 0.05 ? -Math.floor(r() * 300) : 0;
    exact += BigInt(amount + tax);
    const dt = new Date(Date.UTC(2019, 0, 1) + i * 5400_000).toISOString();
    rows.push({ datetime: dt, date: dt.slice(0, 10), category: 'CASH', type: inbound ? 'CUSTOMER_INBOUND' : 'CARD_TRANSACTION', name: '', symbol: '', amount: cents(amount), fee: '', tax: tax ? cents(tax) : '', description: '', transaction_id: `c${i}`, mcc_code: '' });
  }
  const cash = buildCash(rows);
  assert.equal(cash.ledger, Number(exact) / 100);
  assert.equal(cash.days.at(-1)[1] + (cash.roundUps?.amount ?? 0), Number(exact) / 100);
});
