// Simulación de varias ventas a la vez (Fiscalidad → Simular). Va aparte de calc.js para que
// solo se descargue con esa sección.
import { sum, taxYears, simulateSale, washBuys } from './calc.js';

/**
 * Varias ventas simuladas a la vez, como si se hicieran hoy: el efecto conjunto en la
 * declaración de este año (las pérdidas de unas compensan las ganancias de otras, con el
 * límite del 25 % de los rendimientos para lo que sobre).
 *
 * o: posiciones abiertas de analyze(); picks: [{ isin, sh, price? }] (sin precio, el actual).
 * Devuelve { year, rows, proceeds, cost, gain, before, after, tax, carried, keep }:
 *  - rows: [{ x, sh, price, proceeds, cost, gain, wash }] por venta (FIFO, con `fee` de comisión);
 *    wash = compras de los dos últimos meses que impedirían compensar la pérdida;
 *  - before / after: lo que pagarías este año sin y con estas ventas; tax = after − before;
 *  - carried: pérdida que quedaría pendiente para los cuatro años siguientes;
 *  - keep: lo cobrado menos el impuesto que añaden.
 */
export function simulateSales(o, picks, sl, dv, income = {}, today = new Date().toISOString().slice(0, 10), fee = 1) {
  const year = today.slice(0, 4);
  const of = (sales) => taxYears(sales, dv, income).find((r) => r.year === year);
  const base = of(sl);
  const rows = [], sales = [];
  for (const pick of picks) {
    const x = o.find((r) => r.p.isin === pick.isin);
    const sh = Math.min(x?.p.sh ?? 0, pick.sh);
    const price = pick.price > 0 ? pick.price : x?.has ? x.v / x.p.sh : 0;
    if (!x || !(sh > 0) || !(price > 0) || !x.p.lots?.length) continue;
    const sim = simulateSale(x.p.lots, sh, price, fee);
    const avg = x.p.cost * (sh / x.p.sh);
    const sale = {
      id: `sim-${x.p.isin}`, k: 'S', d: today, sh, net: sim.proceeds, csF: sim.cost, reF: sim.gain,
      cs: avg, re: sim.proceeds - avg, sa: x.p.sh - sh, lotsUsed: sim.used, p: x.p,
    };
    sales.push(sale);
    rows.push({ x, sh, price, proceeds: sim.proceeds, cost: sim.cost, gain: sim.gain, wash: x.p.evs ? washBuys(sale) : [] });
  }
  const y = sales.length ? of([...sl, ...sales]) : base;
  const before = base?.due ?? 0, after = y?.due ?? 0;
  const proceeds = sum(rows, (r) => r.proceeds);
  return {
    year, rows, proceeds, cost: sum(rows, (r) => r.cost), gain: sum(rows, (r) => r.gain),
    before, after, tax: after - before, carried: Math.max(0, (y?.carryOut ?? 0) - (base?.carryOut ?? 0)), keep: proceeds - (after - before),
  };
}
