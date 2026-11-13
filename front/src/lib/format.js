const L = 'es-ES';
const nf = (min, max) => new Intl.NumberFormat(L, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const f2 = nf(2, 2), f0 = nf(0, 0), f6 = nf(0, 6), f1 = nf(0, 1);

// Modo privado: con él activado, ninguna cifra llega a la página (ni al texto, ni a los
// atributos, ni a los gráficos). No es un desenfoque: el número no se escribe.
let masked = false;
export const MASK = '••••';
export const setMasked = (v) => { masked = !!v; };
export const isMasked = () => masked;
/**
 * Textos que ya traen cifras escritas (las notas que redacta el servidor): con el modo
 * privado se tapan los importes, porcentajes y números con decimales; fechas e ids quedan.
 */
export const maskText = (s) => (masked && s
  ? s.replace(/[+−-]?\d[\d.,]*\s*(€|%)/g, (_, u) => `${MASK} ${u}`).replace(/\d[\d.]*,\d+/g, MASK)
  : s);

/** 1.234,56 */
export const num = (n) => (masked ? MASK : f2.format(n));
/** 1.234,56 € */
// Entre la cifra y la unidad, espacio de no separación: el «€» o el «%» nunca se quedan solos en una línea.
const NB = '\u00a0';
export const eur = (n) => (masked ? `${MASK}${NB}€` : `${f2.format(n)}${NB}€`);
/** +1.234,56 € (signo siempre visible) */
export const eurS = (n) => (masked ? `${MASK}${NB}€` : `${n >= 0 ? '+' : '−'}${f2.format(Math.abs(n))}${NB}€`);
/** +12,34 % */
export const pctS = (n) => (masked ? `${MASK}${NB}%` : `${n >= 0 ? '+' : '−'}${f2.format(Math.abs(n))}${NB}%`);
export const pct = (n) => (masked ? `${MASK}${NB}%` : `${f2.format(n)}${NB}%`);
/** Cantidades: hasta 6 decimales, sin ceros de relleno. */
export const qty = (n) => (masked ? MASK : f6.format(parseFloat(n.toFixed(6))));
/** Eje de gráfico: 0 / 500 / 10 k / 1,5 M */
export const compact = (n) => {
  if (masked) return '';
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
