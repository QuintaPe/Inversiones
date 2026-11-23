// Patrimonio neto: la cartera y el efectivo de Trade Republic, más lo que el usuario anota a
// mano (otras cuentas, depósitos, inmuebles…), menos sus deudas. Cada cuenta lleva saldos
// fechados; entre dos anotaciones vale la última.

/** Tipos de cuenta y su nombre. 'debt' resta. */
export const KINDS = [['cash', 'Cuenta'], ['deposit', 'Depósito'], ['property', 'Inmueble'], ['other', 'Otro bien'], ['debt', 'Deuda']];
export const KIND_LABEL = Object.fromEntries(KINDS);

/** Saldo vigente en un día (el último anotado hasta entonces), o null si aún no había ninguno. */
export function balanceAt(balances, d) {
  let last = null;
  for (const b of balances) { if (b.d > d) break; last = b; }
  return last;
}

/**
 * Foto de hoy.
 * @param portfolio  valor de la cartera
 * @param cash       efectivo en Trade Republic (o null si no se conoce)
 * @param accounts   [{ id, name, kind, balances: [{ d, amount }] }] con los saldos por fecha
 * @returns foto: { total, assets, debts, parts: [{ key, label, kind, v, d }] } (v siempre positivo)
 */
export function netWorth({ portfolio = 0, cash = null, accounts = [] }, today = new Date().toISOString().slice(0, 10)) {
  const parts = [];
  if (portfolio > 0) parts.push({ key: 'portfolio', label: 'Inversiones', kind: 'portfolio', v: portfolio, d: null });
  if (cash > 0) parts.push({ key: 'tr-cash', label: 'Efectivo en Trade Republic', kind: 'cash', v: cash, d: null });
  for (const a of accounts) {
    const b = balanceAt(a.balances, today);
    if (b) parts.push({ key: a.id, label: a.name, kind: a.kind, v: b.amount, d: b.d });
  }
  const debts = parts.filter((p) => p.kind === 'debt').reduce((t, p) => t + p.v, 0);
  const assets = parts.filter((p) => p.kind !== 'debt').reduce((t, p) => t + p.v, 0);
  return { total: assets - debts, assets, debts, parts };
}

/** Lee una serie ordenada [[día, valor]] hacia delante: valor vigente en cada día pedido (días crecientes). */
function walker(points) {
  let i = -1;
  return (d) => {
    while (i + 1 < points.length && points[i + 1][0] <= d) i++;
    return i >= 0 ? points[i][1] : 0;
  };
}
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

/**
 * Evolución a fin de cada mes (y hoy), desde el primer dato que haya.
 * @param hist      histórico de la cartera: { d: [día], v: [valor] } (o null)
 * @param cashDays  saldo de efectivo: [[día, saldo]] (o null)
 * @returns serie: [{ d, portfolio, cash, other, debt, total }]
 */
export function netWorthSeries({ hist = null, cashDays = null, accounts = [] }, today = new Date().toISOString().slice(0, 10)) {
  const pf = hist?.d?.length ? hist.d.map((d, i) => [d, hist.v[i] ?? 0]) : [];
  const cash = cashDays ?? [];
  const firsts = [pf[0]?.[0], cash[0]?.[0], ...accounts.map((a) => a.balances[0]?.d)].filter(Boolean).sort();
  if (!firsts.length) return [];
  const days = [];
  let y = +firsts[0].slice(0, 4), m = +firsts[0].slice(5, 7) - 1;
  for (let n = 0; n < 1200; n++) {
    const d = lastDay(y, m);
    if (d >= today) break;
    days.push(d);
    if (++m > 11) { m = 0; y++; }
  }
  days.push(today);
  const readPf = walker(pf), readCash = walker(cash);
  const readers = accounts.map((a) => ({ debt: a.kind === 'debt', read: walker(a.balances.map((b) => [b.d, b.amount])) }));
  return days.map((d) => {
    let other = 0, debt = 0;
    for (const r of readers) { if (r.debt) debt += r.read(d); else other += r.read(d); }
    const portfolio = readPf(d), c = readCash(d);
    return { d, portfolio, cash: c, other, debt, total: portfolio + c + other - debt };
  });
}
