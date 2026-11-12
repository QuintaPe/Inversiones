// Agregados de la vista. Las posiciones llegan calculadas del servidor (coste
// medio, realizado por venta, FIFO…); aquí se aplican el filtro y los precios.
export const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

export const GROUPS = [
  ['all', 'Todo'],
  ['ac', 'Acciones y ETF'],
  ['pm', 'Private Markets'],
];

/**
 * Junta las ejecuciones parciales de una misma orden: compras (o ventas) seguidas del
 * mismo día en las que solo una lleva comisión, que es como el bróker trocea una orden.
 * Solo afecta a cómo se listan; el coste, el realizado y el FIFO se calculan por ejecución.
 */
export function mergeFills(evs) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 1 && run.filter((x) => x.fee > 0).length === 1) {
      const add = (f) => run.reduce((t, x) => t + (x[f] || 0), 0);
      const main = run.find((x) => x.fee > 0), last = run.at(-1);
      const sh = add('sh'), g = add('g');
      const m = {
        ...last, id: main.id, ids: run.map((x) => x.id), parts: run,
        sh, g, px: g / sh, fee: add('fee'), tax: add('tax'), net: add('net'),
        note: run.map((x) => x.note).filter(Boolean).join(' ') || undefined,
      };
      if (last.k === 'S') {
        Object.assign(m, { cs: add('cs'), re: add('re'), csF: add('csF'), reF: add('reF'), lotsUsed: run.flatMap((x) => x.lotsUsed ?? []) });
        m.avb = m.cs / sh;
      }
      out.push(m);
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const x of evs) {
    if (x.k === 'D') { flush(); out.push(x); continue; }
    if (run.length && (run[0].k !== x.k || run[0].d !== x.d)) flush();
    run.push(x);
  }
  flush();
  return out;
}

export function analyze(positions, flt) {
  const vis = positions.filter((p) => flt === 'all' || p.grp === flt);
  const open = vis.filter((p) => p.open);
  const closed = vis.filter((p) => !p.open);
  const stats = (p) => {
    const ops = mergeFills(p.evs); // órdenes, con las ejecuciones parciales ya juntas
    const B = ops.filter((x) => x.k === 'B'), S = ops.filter((x) => x.k === 'S'), D = ops.filter((x) => x.k === 'D');
    return {
      ops, B, S, D,
      bought: sum(B, (x) => x.net), soldCost: sum(S, (x) => x.cs),
      real: sum(S, (x) => x.re), div: sum(D, (x) => x.net), divG: sum(D, (x) => x.g), divT: sum(D, (x) => x.tax),
      fees: sum(p.evs, (x) => x.fee || 0),
      first: B[0]?.d, last: B.at(-1)?.d,
    };
  };
  const o = open.map((p) => {
    const has = p.price > 0;
    const v = has ? p.sh * p.price : null;
    // Variación de la última sesión (solo con cotización en vivo).
    const dayPct = has && p.priceSource === 'live' && Number.isFinite(p.priceInfo?.dayPct) ? p.priceInfo.dayPct : null;
    const day = dayPct != null ? v - v / (1 + dayPct / 100) : null;
    return {
      p, has, v, avg: p.cost / p.sh, dayPct, day,
      pl: has ? v - p.cost : null,
      plp: has ? ((v - p.cost) / p.cost) * 100 : null,
      ...stats(p),
    };
  });
  const priced = o.filter((x) => x.has);
  const val = sum(priced, (x) => x.v);
  for (const x of o) x.w = x.has && val ? (x.v / val) * 100 : null;
  const c = closed.map((p) => ({ p, ...stats(p) }));

  const evs = (f) => vis.flatMap((p) => p.evs.filter(f).map((x) => ({ ...x, p })));
  const all = evs(() => true).sort((x, y) => y.d.localeCompare(x.d));
  // Lo que se lista como operaciones: una fila por orden.
  const ops = vis.flatMap((p) => mergeFills(p.evs).map((x) => ({ ...x, p }))).sort((x, y) => y.d.localeCompare(x.d));
  const dv = all.filter((x) => x.k === 'D');
  const sl = all.filter((x) => x.k === 'S');
  const fees = all.filter((x) => x.k !== 'D' && x.fee);
  const cost = sum(open, (p) => p.cost);
  const costPriced = sum(priced, (x) => x.p.cost);
  const pl = val - costPriced, real = sum(sl, (x) => x.re), divN = sum(dv, (x) => x.net);
  const withDay = priced.filter((x) => x.day != null);
  const day = withDay.length ? sum(withDay, (x) => x.day) : null;
  const dayTime = withDay.map((x) => x.p.priceInfo.time).filter(Boolean).sort().at(-1) ?? null;
  return {
    vis, open, closed, o, c, priced, all, ops, dv, sl, fees,
    missing: o.length - priced.length,
    cost, costPriced, val, pl,
    day, dayPct: day != null && val - day > 0 ? (day / (val - day)) * 100 : null, dayTime, dayN: withDay.length,
    plp: costPriced ? (pl / costPriced) * 100 : 0,
    divN, real,
    feeT: sum(fees, (x) => x.fee),
    total: pl + real + divN,
  };
}

const DAY = 86400000;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);

/** Capital invertido (coste de lo que tienes en cartera) tras cada día con operaciones. */
export function investedSeries(vis) {
  const evs = vis
    .flatMap((p) => p.evs.filter((x) => x.k !== 'D').map((x, i) => ({ isin: p.isin, d: x.d, ca: x.ca, i })))
    .sort((a, b) => a.d.localeCompare(b.d) || a.i - b.i);
  if (!evs.length) return [];
  const cur = new Map();
  let total = 0;
  const pts = [];
  for (const e of evs) {
    total += e.ca - (cur.get(e.isin) ?? 0);
    cur.set(e.isin, e.ca);
    if (pts.length && pts.at(-1).d === e.d) pts.at(-1).v = total;
    else pts.push({ d: e.d, t: ms(e.d), v: total });
  }
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (today > pts.at(-1).t) pts.push({ d: null, t: today, v: total });
  return [{ d: null, t: pts[0].t - DAY, v: 0 }, ...pts];
}

/** Dividendos netos por mes, sin huecos entre el primero y el último. */
export function monthlyDividends(dv) {
  if (!dv.length) return [];
  const by = {};
  for (const x of dv) {
    const k = x.d.slice(0, 7);
    (by[k] ??= { net: 0, n: 0 }).net += x.net;
    by[k].n++;
  }
  const keys = Object.keys(by).sort();
  const out = [];
  let [y, m] = keys[0].split('-').map(Number);
  const now = new Date();
  const end = [keys.at(-1), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`].sort().at(-1);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ key: k, v: by[k]?.net ?? 0, n: by[k]?.n ?? 0 });
    if (k >= end) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Resumen por ejercicio para la declaración: ventas (FIFO) y dividendos. */
export function taxYears(sl, dv) {
  const by = {};
  const y = (k) => (by[k] ??= { year: k, sales: [], divs: [], proceeds: 0, costF: 0, gainF: 0, gainAvg: 0, wins: 0, losses: 0, divG: 0, divT: 0 });
  for (const x of sl) {
    const r = y(x.d.slice(0, 4));
    r.sales.push(x);
    r.proceeds += x.net; r.costF += x.csF; r.gainF += x.reF; r.gainAvg += x.re;
    if (x.reF >= 0) r.wins += x.reF; else r.losses += x.reF;
  }
  for (const x of dv) {
    const r = y(x.d.slice(0, 4));
    r.divs.push(x);
    r.divG += x.g; r.divT += x.tax;
  }
  return Object.values(by).sort((a, b) => b.year.localeCompare(a.year));
}

/** Agrupa posiciones valoradas por una clave y devuelve [{ label, v, w, n }] ordenado. */
export function allocation(priced, keyOf, top = 8, labelOf = keyOf) {
  const by = {};
  for (const x of priced) {
    const k = keyOf(x.p);
    const r = (by[k] ??= { key: k, label: labelOf(x.p), v: 0, n: 0, cost: 0, isin: x.p.isin });
    r.v += x.v; r.cost += x.p.cost; r.n++;
  }
  const total = sum(priced, (x) => x.v) || 1;
  const rows = Object.values(by).sort((a, b) => b.v - a.v).map((r) => ({ ...r, w: (r.v / total) * 100, plp: r.cost ? (r.v / r.cost - 1) * 100 : 0 }));
  if (rows.length <= top + 1) return rows;
  const rest = rows.slice(top);
  return [...rows.slice(0, top), { key: '__otros', label: `Otros (${rest.length})`, v: sum(rest, (r) => r.v), w: sum(rest, (r) => r.w), n: sum(rest, (r) => r.n), other: true }];
}
