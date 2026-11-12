const L = 'es-ES';
const nf = (min, max) => new Intl.NumberFormat(L, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const f2 = nf(2, 2), f0 = nf(0, 0), f6 = nf(0, 6), f1 = nf(0, 1);

/** 1.234,56 */
export const num = (n) => f2.format(n);
/** 1.234,56 € */
export const eur = (n) => `${f2.format(n)} €`;
/** +1.234,56 € (signo siempre visible) */
export const eurS = (n) => `${n >= 0 ? '+' : '−'}${f2.format(Math.abs(n))} €`;
/** +12,34 % */
export const pctS = (n) => `${n >= 0 ? '+' : '−'}${f2.format(Math.abs(n))} %`;
export const pct = (n) => `${f2.format(n)} %`;
/** Cantidades: hasta 6 decimales, sin ceros de relleno. */
export const qty = (n) => f6.format(parseFloat(n.toFixed(6)));
/** Eje de gráfico: 0 / 500 / 10 k / 1,5 M */
export const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${f1.format(n / 1e6)} M`;
  if (a >= 1e4) return `${f1.format(n / 1e3)} k`;
  return f0.format(n);
};
export const sign = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
/** 2025-03-05 → 05/03/2025 */
export const date = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** 2025-03 → mar 25 */
export const month = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
/** Hora local de un instante ISO: 21:43 */
export const time = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const dateLong = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
