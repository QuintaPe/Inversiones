// Índices de referencia con los que se compara la cartera: cada uno es un ETF que lo replica y
// cotiza en euros (el back descarga su histórico). El usuario puede mezclarlos en un índice propio.

export const BENCHMARKS = [
  { key: 'world', name: 'MSCI World', symbol: 'IWDA.AS' },
  { key: 'sp500', name: 'S&P 500', symbol: 'SXR8.DE' },
  { key: 'allworld', name: 'FTSE All-World', symbol: 'VWCE.DE' },
  { key: 'euro50', name: 'Euro Stoxx 50', symbol: 'EXW1.DE' },
  { key: 'em', name: 'Emergentes', symbol: 'IS3N.DE' },
  { key: 'bonds', name: 'Bonos globales', symbol: 'EUNA.DE' },
];
export const BENCHMARK_KEYS = BENCHMARKS.map((b) => b.key);
export const MINE = 'mine'; // clave del índice propio

/**
 * Añade al histórico el índice propio del usuario y lo pone el primero.
 * @param h      histórico ({ benchmarks: [{ key, name, c[] }], … })
 * @param blend  ajuste guardado: { parts: [{ key, w }] } con pesos en % (o null)
 * Una sola parte al 100 % es ese índice tal cual. Con varias, cada una pesa lo indicado el
 * primer día en que todas cotizan y después se deja correr (sin rebalancear).
 */
export function withBlend(h, blend) {
  const parts = (blend?.parts ?? []).filter((p) => p.w > 0).map((p) => ({ w: p.w, b: h.benchmarks.find((x) => x.key === p.key) })).filter((p) => p.b);
  const total = parts.reduce((t, p) => t + p.w, 0);
  if (!parts.length || !(total > 0)) return h;
  if (parts.length === 1) return { ...h, benchmarks: [parts[0].b, ...h.benchmarks.filter((x) => x !== parts[0].b)] };
  const n = h.d.length;
  let i0 = 0;
  while (i0 < n && parts.some((p) => p.b.c[i0] == null)) i0++;
  if (i0 >= n) return h;
  const last = parts.map((p) => p.b.c[i0]);
  const c = new Array(n).fill(null);
  for (let i = i0; i < n; i++) {
    let v = 0;
    parts.forEach((p, k) => { if (p.b.c[i] != null) last[k] = p.b.c[i]; v += (p.w / total) * (last[k] / p.b.c[i0]); });
    c[i] = +(v * 100).toFixed(4);
  }
  const name = parts.map((p) => `${Math.round((p.w / total) * 100)} % ${p.b.name}`).join(' + ');
  return { ...h, benchmarks: [{ key: MINE, name: 'Tu índice', mix: name, c }, ...h.benchmarks] };
}
