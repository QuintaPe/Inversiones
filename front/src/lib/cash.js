// Salud del efectivo a partir de lo que calcula el servidor (buildCash): saldo, meses por
// concepto y saldo día a día. Todo con signo: lo que entra en positivo, lo que sale en negativo.
//
// Gasto = tarjeta + retiradas y recibos. Ingresos = transferencias y aportaciones que entran.
// Las medias usan los últimos 12 meses completos (sin el mes en curso, que va a medias).

const get = (m, k) => m?.[k] ?? 0;
export const spendOf = (m) => -(get(m, 'card') + get(m, 'withdrawal')) || 0; // sin «−0»
export const incomeOf = (m) => get(m, 'deposit');
export const rentOf = (m) => get(m, 'dividend') + get(m, 'interest') + get(m, 'reward');
export const investOf = (m) => -get(m, 'invest') || 0;

const DAY = 86400000;
const t = (d) => Date.parse(`${d}T00:00:00Z`);

/** Saldo medio entre dos fechas (incluidas) con el saldo día a día escalonado. */
export function averageBalance(days, from, to) {
  if (!days.length || from > to) return null;
  let i = 0, bal = 0;
  while (i < days.length && days[i][0] <= from) bal = days[i++][1];
  let sum = 0, cur = t(from);
  const end = t(to) + DAY;
  while (cur < end) {
    const next = i < days.length ? Math.min(t(days[i][0]), end) : end;
    sum += bal * ((next - cur) / DAY);
    cur = next;
    if (i < days.length && t(days[i][0]) <= cur) bal = days[i++][1];
  }
  return sum / ((t(to) + DAY - t(from)) / DAY);
}

/**
 * @param cash  { balance, months: { 'AAAA-MM': { concepto: importe } }, days: [[fecha, saldo]] }
 * @returns { asOf, months: [...completos], avgSpend, avgIncome, saveRate, cushion, yieldPct, now: {...} }
 */
export function cashHealth(cash) {
  const asOf = cash.days.at(-1)?.[0]; // fecha del último movimiento: hasta ahí llega el CSV
  if (!asOf) return null;
  const cur = asOf.slice(0, 7);
  const done = Object.keys(cash.months).filter((m) => m < cur).sort().slice(-12);
  const n = done.length;
  const avg = (f) => (n ? done.reduce((s, m) => s + f(cash.months[m]), 0) / n : null);
  const avgSpend = avg(spendOf), avgIncome = avg(incomeOf);

  // Rentabilidad del efectivo: intereses de esos meses ÷ saldo medio, anualizada.
  let yieldPct = null;
  if (n) {
    const from = `${done[0]}-01`;
    const [y, mo] = done.at(-1).split('-').map(Number);
    const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); // último día de ese mes
    const avgBal = averageBalance(cash.days, from, to);
    const interest = done.reduce((s, m) => s + get(cash.months[m], 'interest'), 0);
    if (avgBal > 0 && interest > 0) yieldPct = (interest / avgBal) * (12 / n) * 100;
  }

  // Mes en curso hasta la fecha del CSV, y el gasto que tocaría a este ritmo.
  const m = cash.months[cur];
  const [y, mo, d] = asOf.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const now = {
    month: cur, day: d, daysIn,
    income: incomeOf(m), spend: spendOf(m), invest: investOf(m), rent: rentOf(m),
    pace: avgSpend != null ? avgSpend * (d / daysIn) : null, // gasto medio hasta este día del mes
  };

  return {
    asOf, months: done, avgSpend, avgIncome,
    saveRate: avgIncome > 0 ? (1 - avgSpend / avgIncome) * 100 : null,
    cushion: avgSpend > 0 ? cash.balance / avgSpend : null,
    yieldPct, now,
  };
}
