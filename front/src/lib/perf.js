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

  // Riesgo: volatilidad anualizada de las variaciones diarias (solo días de mercado) y
  // rentabilidad anualizada por unidad de riesgo. Con menos de un mes de datos no dicen nada.
  const rets = [];
  for (let i = first + 1; i <= i1; i++) {
    const wd = new Date(`${h.d[i]}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6 || !(h.idx[i - 1] > 0)) continue;
    rets.push({ d: h.d[i], r: h.idx[i] / h.idx[i - 1] - 1 });
  }
  let vol = null, ratio = null, best = null, worst = null;
  if (rets.length >= 20) {
    const mean = rets.reduce((t, x) => t + x.r, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((t, x) => t + (x.r - mean) ** 2, 0) / (rets.length - 1));
    vol = sd * Math.sqrt(252) * 100;
    const days = i1 - first;
    const annual = days >= 90 ? ((1 + twr / 100) ** (365 / days) - 1) * 100 : null;
    ratio = annual != null && vol > 0 ? annual / vol : null;
    best = rets.reduce((a, x) => (x.r > a.r ? x : a));
    worst = rets.reduce((a, x) => (x.r < a.r ? x : a));
    best = { d: best.d, r: best.r * 100 }; worst = { d: worst.d, r: worst.r * 100 };
  }

  const bench = h.benchmarks.map((b) => {
    let j = first;
    while (j < i1 && b.c[j] == null) j++;
    const c0 = b.c[j], c1 = b.c[i1];
    if (!c0 || !c1) return { key: b.key, name: b.name, r: null, gain: null, mwr: null, from: j };
    // El mismo dinero, los mismos días, pero metido en el índice: es la comparación justa con tu
    // resultado en euros (la ponderada por tiempo da el mismo peso a una época con 100 € que a otra con 100.000 €).
    let last = (i0 >= 0 && b.c[i0]) || c0;
    let units = v0 / last, put = 0;
    const g = i0 >= 0 ? [0] : []; // resultado acumulado en euros, día a día desde `first`
    for (let i = i0 + 1; i <= i1; i++) {
      const c = b.c[i] ?? last;
      units += h.buy[i] / last; // las compras entran al cierre anterior, como en tu cartera
      units -= (h.sell[i] + h.div[i]) / c; // ventas y dividendos salen al cierre del día
      put += h.buy[i] - h.sell[i] - h.div[i];
      g.push(units * c - v0 - put);
      last = c;
    }
    const bGain = g.at(-1);
    return { key: b.key, name: b.name, r: (c1 / c0 - 1) * 100, gain: bGain, mwr: weighted > 0 ? (bGain / weighted) * 100 : null, from: j, g };
  });
  return { i0, i1, first, v0, v1, bought, sold, divs, contrib: bought - sold, gain, mwr, twr, mdd: mdd * 100, vol, ratio, best, worst, bench, avg: weighted };
}
