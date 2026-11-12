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
    if (x.k === 'D' || x.k === 'X') { flush(); out.push(x); continue; }
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
      // Sin coste (acciones recibidas en una escisión) no hay porcentaje que calcular.
      plp: has && p.cost > 0 ? ((v - p.cost) / p.cost) * 100 : null,
      ...stats(p),
    };
  });
  const priced = o.filter((x) => x.has);
  const val = sum(priced, (x) => x.v);
  for (const x of o) x.w = x.has && val ? (x.v / val) * 100 : null;
  const c = closed.map((p) => ({ p, ...stats(p) }));

  const evs = (f) => vis.flatMap((p) => p.evs.filter(f).map((x) => ({ ...x, p })));
  // Los splits (k = 'X') solo se enseñan en la ficha del activo: no son operaciones con dinero.
  const all = evs((x) => x.k !== 'X').sort((x, y) => y.d.localeCompare(x.d));
  // Lo que se lista como operaciones: una fila por orden.
  const ops = vis.flatMap((p) => mergeFills(p.evs).filter((x) => x.k !== 'X').map((x) => ({ ...x, p }))).sort((x, y) => y.d.localeCompare(x.d));
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

const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/**
 * Regla de los dos meses: una pérdida no se puede compensar si se compran valores
 * homogéneos en los dos meses anteriores o posteriores a la venta y siguen en cartera.
 * Devuelve las compras que la activarían, o [] si no aplica. Es un aviso orientativo.
 */
export function washBuys(sale) {
  if (sale.reF >= 0) return [];
  const from = addMonths(sale.d, -2), to = addMonths(sale.d, 2);
  const consumed = new Set((sale.lotsUsed ?? []).map((l) => l.d));
  return sale.p.evs.filter((e) => e.k === 'B' && e.d >= from && e.d <= to && (
    e.d > sale.d // recompra posterior
    || (e.d < sale.d && !consumed.has(e.d) && sale.sa > 0) // compra previa que no es la vendida y sigue en cartera
  ));
}

/** Tramos de la base del ahorro (IRPF estatal + autonómico, desde 2025). */
const SAVINGS = [[6000, 0.19], [50000, 0.21], [200000, 0.23], [300000, 0.27], [Infinity, 0.30]];
export function savingsTax(base) {
  let tax = 0, prev = 0;
  for (const [top, rate] of SAVINGS) {
    if (base <= prev) break;
    tax += (Math.min(base, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

/** Venta simulada de `sh` unidades a `price` consumiendo los lotes por FIFO. */
export function simulateSale(lots, sh, price, fee = 1) {
  let left = sh, cost = 0;
  const used = [];
  for (const l of lots) {
    if (left <= 1e-9) break;
    const take = Math.min(l.sh, left);
    cost += take * l.unit;
    used.push({ d: l.d, sh: take, unit: l.unit });
    left -= take;
  }
  const proceeds = sh * price - fee;
  return { proceeds, cost, gain: proceeds - cost, used };
}

const CARRY_YEARS = 4; // las pérdidas pendientes se compensan en los cuatro ejercicios siguientes

/**
 * Resumen por ejercicio para la declaración: ventas (FIFO), dividendos y otros rendimientos.
 * income (opcional): { año: { interest: { g, t, n }, reward: { g, t, n } } } del servidor.
 *
 * Sobre el resultado FIFO se aplican, de forma orientativa:
 *  - la regla de los dos meses: la parte de la pérdida que corresponde a las acciones
 *    recompradas se difiere y se recupera cuando esas acciones se venden;
 *  - la compensación de pérdidas: primero con ganancias, después con hasta el 25 % de los
 *    rendimientos del capital mobiliario, y el resto queda pendiente cuatro ejercicios.
 */
export function taxYears(sl, dv, income = {}) {
  const by = {};
  const y = (k) => (by[k] ??= {
    year: k, sales: [], divs: [], proceeds: 0, costF: 0, gainF: 0, gainAvg: 0, wins: 0, losses: 0, divG: 0, divT: 0,
    wash: [], washLoss: 0, deferred: 0, released: 0,
  });
  // Pérdidas diferidas por valor: [{ d: fecha del lote recomprado, sh: acciones, per: pérdida por acción }]
  const pending = {};
  for (const x of [...sl].sort((a, b) => a.d.localeCompare(b.d))) {
    const r = y(x.d.slice(0, 4));
    r.sales.push(x);
    r.proceeds += x.net; r.costF += x.csF; r.gainF += x.reF; r.gainAvg += x.re;
    if (x.reF >= 0) r.wins += x.reF; else r.losses += x.reF;
    // Si esta venta consume acciones recompradas, aflora la pérdida que arrastraban.
    const pen = pending[x.p.isin] ?? [];
    for (const l of x.lotsUsed ?? []) {
      let left = l.sh;
      for (const q of pen) {
        if (q.d !== l.d || q.sh <= 1e-9 || left <= 1e-9) continue;
        const take = Math.min(q.sh, left);
        r.released += take * q.per;
        q.sh -= take; left -= take;
      }
    }
    const wb = washBuys(x);
    if (wb.length) {
      let left = Math.min(x.sh ?? 0, sum(wb, (b) => b.sh ?? 0));
      const deferred = x.sh ? (x.reF * left) / x.sh : 0;
      for (const b of wb) {
        const take = Math.min(b.sh ?? 0, left);
        if (take <= 1e-9) continue;
        (pending[x.p.isin] ??= []).push({ d: b.d, sh: take, per: x.reF / x.sh });
        left -= take;
      }
      r.wash.push({ sale: x, buys: wb, deferred });
      r.washLoss += deferred; r.deferred += deferred;
    }
  }
  for (const r of Object.values(by)) r.sales.reverse(); // las más recientes primero, como el resto de listas
  for (const x of dv) {
    const r = y(x.d.slice(0, 4));
    r.divs.push(x);
    r.divG += x.g; r.divT += x.tax;
  }
  for (const k of Object.keys(income)) y(k);

  // Base del ahorro de cada ejercicio, arrastrando las pérdidas pendientes de los anteriores.
  let carry = []; // [{ year, amt }] pérdidas sin compensar, de la más antigua a la más reciente
  for (const r of Object.values(by).sort((a, b) => a.year.localeCompare(b.year))) {
    const inc = income[r.year] ?? {};
    r.intG = inc.interest?.g ?? 0; r.intT = inc.interest?.t ?? 0; r.intN = inc.interest?.n ?? 0;
    r.rewG = inc.reward?.g ?? 0; r.rewT = inc.reward?.t ?? 0; r.rewN = inc.reward?.n ?? 0;
    r.rcm = r.divG + r.intG + r.rewG; // rendimientos del capital mobiliario
    r.withheld = r.divT + r.intT + r.rewT;
    r.gainTax = r.gainF - r.deferred + r.released; // resultado que cuenta este año

    carry = carry.filter((c) => Number(r.year) - Number(c.year) <= CARRY_YEARS);
    r.carryIn = sum(carry, (c) => c.amt);
    const use = (limit) => {
      let used = 0;
      for (const c of carry) { const t = Math.min(c.amt, limit - used); c.amt -= t; used += t; }
      return used;
    };
    r.usedPrev = r.gainTax > 0 ? use(r.gainTax) : 0; // contra las ganancias del año
    const net = r.gainTax - r.usedPrev;
    let cap = 0.25 * Math.max(0, r.rcm); // contra los rendimientos, con el límite del 25 %
    r.offsetRcm = 0;
    if (net < 0) {
      const o = Math.min(-net, cap);
      r.offsetRcm += o; cap -= o;
      if (-net - o > 0.005) carry.push({ year: r.year, amt: -net - o });
    }
    r.offsetRcm += use(cap);
    carry = carry.filter((c) => c.amt > 0.005);
    r.carryOut = sum(carry, (c) => c.amt);
    r.base = Math.max(0, net) + r.rcm - r.offsetRcm;
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

/**
 * Ajuste hacia unos pesos objetivo.
 * items: [{ isin, v, price }]; weights: { isin: % }; extra: aportación nueva en euros.
 * Sin aportación: compra y vende hasta el objetivo. Con aportación: solo compras, repartidas
 * entre lo que queda por debajo de su objetivo, en proporción a lo que le falta.
 */
export function rebalance(items, weights, extra = 0) {
  const total = items.reduce((t, i) => t + i.v, 0) + extra;
  const rows = {};
  let lacking = 0;
  for (const i of items) {
    const w = weights[i.isin] ?? 0;
    const gap = (w / 100) * total - i.v;
    rows[i.isin] = { w, gap, delta: 0 };
    if (gap > 0) lacking += gap;
  }
  let net = 0;
  for (const r of Object.values(rows)) {
    if (!r.w && extra <= 0) continue; // sin objetivo no se propone nada
    r.delta = extra > 0 ? (r.gap > 0 && lacking > 0 ? (r.gap / lacking) * Math.min(extra, lacking) : 0) : r.gap;
    net += r.delta;
  }
  return { rows, net };
}
