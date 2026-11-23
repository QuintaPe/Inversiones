// Riesgo y diversificación a partir de los cierres en euros de cada posición: volatilidad,
// correlación entre valores, cuánto del riesgo de la cartera aporta cada uno y cuántas
// posiciones «de verdad» tienes. Todo con rentabilidades semanales, que no dependen de que
// las bolsas abran los mismos días.

const WEEK = 7 * 86400000;
const MIN_WEEKS = 12; // con menos semanas la estadística no dice nada
/** Semana de un día AAAA-MM-DD (número entero; cambia cada lunes). */
const weekOf = (d) => Math.floor((Date.parse(`${d}T00:00:00Z`) - 4 * 86400000) / WEEK);

/** Último cierre de cada semana: Map(semana → precio). rows: [[día, precio]] en orden. */
export function weeklyCloses(rows) {
  const out = new Map();
  for (const [d, c] of rows) if (c > 0) out.set(weekOf(d), c);
  return out;
}
/** Rentabilidad de cada semana respecto a la anterior: Map(semana → r). Sin semana anterior, no hay dato. */
export function weeklyReturns(rows) {
  const closes = weeklyCloses(rows), out = new Map();
  for (const [w, c] of closes) { const prev = closes.get(w - 1); if (prev) out.set(w, c / prev - 1); }
  return out;
}

const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;
function cov(a, b) {
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}
const annual = (weeklyVar) => Math.sqrt(Math.max(0, weeklyVar) * 52) * 100;

/** Correlación de dos series de rentabilidades en las semanas que comparten, o null si son pocas. */
export function correlation(ra, rb) {
  const a = [], b = [];
  for (const [w, x] of ra) { const y = rb.get(w); if (y != null) { a.push(x); b.push(y); } }
  if (a.length < MIN_WEEKS) return null;
  const va = cov(a, a), vb = cov(b, b);
  return va > 0 && vb > 0 ? Math.max(-1, Math.min(1, cov(a, b) / Math.sqrt(va * vb))) : null;
}

/**
 * @param items  [{ key, v, rows }]: valor de la posición hoy y sus cierres en euros [[día, precio]]
 * @returns informe: {
 *   weeks, assets: [{ key, w, vol, share }], skipped: [key], corr: [[ρ]], vol, weighted, ratio, effN, pairs
 * } o null si no hay al menos dos valores con histórico suficiente. Pesos (w) y parte del riesgo
 *   (share) en %, volatilidades anualizadas en %; ratio = volatilidad media ponderada / la de la
 *   cartera (cuanto más por encima de 1, más diversificación); effN = posiciones efectivas (1/Σw²);
 *   pairs: las parejas más correlacionadas [{ a, b, r }].
 */
export function riskReport(items) {
  const withR = items.filter((i) => i.v > 0).map((i) => ({ ...i, r: weeklyReturns(i.rows ?? []) }));
  const ok = withR.filter((i) => i.r.size >= MIN_WEEKS);
  const skipped = withR.filter((i) => i.r.size < MIN_WEEKS).map((i) => i.key);
  if (ok.length < 2) return null;
  // Semanas en las que todos tienen dato: sobre ellas se mide la cartera.
  let weeks = [...ok[0].r.keys()];
  for (const i of ok.slice(1)) weeks = weeks.filter((w) => i.r.has(w));
  weeks.sort((a, b) => a - b);
  if (weeks.length < MIN_WEEKS) return null;
  const total = ok.reduce((t, i) => t + i.v, 0);
  const series = ok.map((i) => weeks.map((w) => i.r.get(w)));
  const w = ok.map((i) => i.v / total);
  const port = weeks.map((_, k) => series.reduce((t, s, i) => t + w[i] * s[k], 0));
  const pv = cov(port, port);
  const vols = series.map((s) => annual(cov(s, s)));
  const assets = ok.map((i, k) => ({
    key: i.key, w: w[k] * 100, vol: vols[k],
    // Parte del riesgo: peso × covarianza con la cartera, sobre la varianza de la cartera (suman 100).
    share: pv > 0 ? ((w[k] * cov(series[k], port)) / pv) * 100 : 0,
  }));
  const corr = ok.map((a) => ok.map((b) => (a === b ? 1 : correlation(a.r, b.r))));
  const pairs = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) if (corr[i][j] != null) pairs.push({ a: ok[i].key, b: ok[j].key, r: corr[i][j] });
  pairs.sort((x, y) => y.r - x.r);
  const vol = annual(pv), weighted = vols.reduce((t, v, k) => t + w[k] * v, 0);
  return {
    weeks: weeks.length, assets, skipped, corr, vol, weighted, ratio: vol > 0 ? weighted / vol : null,
    effN: 1 / w.reduce((t, x) => t + x * x, 0), pairs: pairs.slice(0, 5),
  };
}
