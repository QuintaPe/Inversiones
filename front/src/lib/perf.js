// Rentabilidad por periodo a partir del histórico diario que devuelve el back:
// h = { d[], v[], cost[], idx[], buy[], sell[], div[], benchmarks: [{ key, name, c[] }] }

/** Sumas acumuladas de los flujos, para consultar cualquier tramo sin recorrerlo. */
export function prepare(h) {
  const n = h.d.length;
  const cumBuy = new Array(n), cumSell = new Array(n), cumDiv = new Array(n);
  let b = 0, s = 0, d = 0;
  for (let i = 0; i < n; i++) {
    cumBuy[i] = b += h.buy[i]; cumSell[i] = s += h.sell[i]; cumDiv[i] = d += h.div[i];
  }
  return { ...h, cumBuy, cumSell, cumDiv, t: h.d.map((x) => Date.parse(`${x}T00:00:00Z`)) };
}

/** Índice del último día anterior a `start` (−1 si el periodo empieza antes que la cartera). */
export function baseIndex(h, start) {
  if (!start) return -1;
  let lo = 0, hi = h.d.length; // primer índice con fecha >= start
  while (lo < hi) { const m = (lo + hi) >> 1; if (h.d[m] < start) lo = m + 1; else hi = m; }
  return lo - 1;
}

const at = (arr, i) => (i < 0 ? 0 : arr[i]);

/** Resultado en euros entre el cierre del día i0 y el del día i: lo ganado sin contar aportaciones. */
export function gainBetween(h, i0, i) {
  const contrib = (at(h.cumBuy, i) - at(h.cumBuy, i0)) - (at(h.cumSell, i) - at(h.cumSell, i0)) - (at(h.cumDiv, i) - at(h.cumDiv, i0));
  return h.v[i] - at(h.v, i0) - contrib;
}

export function periodStats(h, start) {
  const i0 = baseIndex(h, start), i1 = h.d.length - 1;
  const v0 = at(h.v, i0), v1 = h.v[i1];
  const bought = at(h.cumBuy, i1) - at(h.cumBuy, i0), sold = at(h.cumSell, i1) - at(h.cumSell, i0);
  const divs = at(h.cumDiv, i1) - at(h.cumDiv, i0);
  const gain = gainBetween(h, i0, i1);

  // Ponderada por dinero (Dietz modificado): resultado ÷ capital medio realmente expuesto.
  const first = Math.max(i0, 0), T = i1 - first || 1;
  let weighted = v0;
  for (let i = i0 + 1; i <= i1; i++) {
    const cf = h.buy[i] - h.sell[i] - h.div[i];
    if (cf) weighted += cf * ((i1 - i) / T); // cuanto antes entra el dinero, más pesa
  }
  const mwr = weighted > 0 ? (gain / weighted) * 100 : null;

  // Ponderada por tiempo: no depende de cuándo aportas; es la comparable con un índice.
  const idx0 = i0 < 0 ? 100 : h.idx[i0];
  const twr = (h.idx[i1] / idx0 - 1) * 100;

  // Caída máxima desde un máximo dentro del periodo.
  let peak = idx0, mdd = 0;
  for (let i = first; i <= i1; i++) {
    if (h.idx[i] > peak) peak = h.idx[i];
    mdd = Math.min(mdd, h.idx[i] / peak - 1);
  }

  const bench = h.benchmarks.map((b) => {
    let j = first;
    while (j < i1 && b.c[j] == null) j++;
    const c0 = b.c[j], c1 = b.c[i1];
    return { key: b.key, name: b.name, r: c0 && c1 ? (c1 / c0 - 1) * 100 : null, from: j };
  });
  return { i0, i1, first, v0, v1, bought, sold, divs, contrib: bought - sold, gain, mwr, twr, mdd: mdd * 100, bench, avg: weighted };
}
