// Reconstruye el valor de la cartera día a día a partir de las operaciones y de
// los cierres históricos, y calcula el índice de rentabilidad (TWR).

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const STALE_MS = 6 * 3600 * 1000;
export const BENCHMARKS = [
  { key: 'world', name: 'MSCI World', symbol: 'IWDA.AS' },
  { key: 'sp500', name: 'S&P 500', symbol: 'SXR8.DE' },
];

/** Valor en `d` de una serie [[fecha, valor]] ordenada, arrastrando el último dato conocido. */
function reader(rows) {
  let i = 0;
  return (d) => {
    while (i + 1 < rows.length && rows[i + 1][0] <= d) i++;
    return rows.length && rows[i][0] <= d ? rows[i][1] : null;
  };
}

/** Interpolación lineal entre puntos [[fecha, valor]]; plano antes del primero y tras el último. */
function interpolator(points) {
  const p = points.map(([d, v]) => [ms(d), v]).sort((a, b) => a[0] - b[0]);
  return (d) => {
    const t = ms(d);
    if (!p.length) return null;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (t - p[i - 1][0])) / (p[i][0] - p[i - 1][0] || 1);
    }
    return p.at(-1)[1];
  };
}

export function createHistory({ db, quotes, now = () => Date.now() }) {
  let running = null;

  /** Descarga lo que falte: needs = { símbolo: fecha desde la que hace falta }. */
  async function ensure(needs) {
    const meta = await db.getHistoryMeta();
    for (const [symbol, from] of Object.entries(needs)) {
      const m = meta[symbol];
      const covered = m && m.from_d <= from;
      if (covered && now() - Date.parse(m.fetched_at) < STALE_MS) continue;
      // Si ya hay histórico desde esa fecha, solo se piden los últimos días.
      const since = covered && m.last_d ? iso(ms(m.last_d) - 5 * DAY) : from;
      try {
        const h = await quotes.history(symbol, since);
        await db.saveHistory(symbol, { ...h, from: covered ? m.from_d : from });
      } catch { /* sin histórico para este símbolo: se valorará a coste */ }
    }
    return db.getHistoryMeta();
  }

  /**
   * @param positions  posiciones de engine.buildPortfolio
   * @param prices     precios actuales del usuario { isin: { price, at, source } }
   * @param valuations valoraciones manuales { isin: [{ d, price }] }
   */
  async function build({ positions, prices, valuations }) {
    const firstDate = positions.flatMap((p) => p.evs.map((e) => e.d)).sort()[0];
    if (!firstDate) return null;
    const today = iso(now());

    // 1) símbolo de cada ISIN (también de las posiciones ya cerradas)
    let symbols = await db.getSymbols();
    const resolved = await quotes.resolveIsins(positions.map((p) => p.isin), symbols);
    if (Object.keys(resolved).length) {
      await db.saveSymbols(resolved);
      symbols = { ...symbols, ...resolved };
    }

    // 2) cierres de cada símbolo desde su primera compra, índices y divisas
    const needs = {};
    for (const p of positions) {
      const s = symbols[p.isin]?.symbol;
      if (s) needs[s] = p.evs[0].d;
    }
    for (const b of BENCHMARKS) needs[b.symbol] = firstDate;
    let meta = await ensure(needs);
    const fx = {};
    for (const [symbol, from] of Object.entries(needs)) {
      const cur = meta[symbol]?.currency;
      if (cur && cur !== 'EUR') fx[`${cur}EUR=X`] = [fx[`${cur}EUR=X`], from].filter(Boolean).sort()[0];
    }
    meta = await ensure(fx);
    const hist = await db.getHistory([...Object.keys(needs), ...Object.keys(fx)]);

    // 3) función precio-en-euros por posición
    const unpriced = [];
    const pricer = (p) => {
      const s = symbols[p.isin]?.symbol;
      if (s && hist[s]?.length) {
        const close = reader(hist[s]);
        const cur = meta[s].currency;
        const rate = cur === 'EUR' ? () => 1 : reader(hist[`${cur}EUR=X`] ?? []);
        const live = p.open && prices[p.isin]?.price;
        return (d) => {
          if (d === today && live) return live; // el último punto coincide con la cotización actual
          const c = close(d), r = rate(d);
          return c != null && r != null ? c * r : null;
        };
      }
      // Sin cotización: de la compra a las valoraciones anotadas, en línea recta.
      const buys = p.evs.filter((e) => e.k === 'B'), sells = p.evs.filter((e) => e.k === 'S');
      const pts = [[buys[0].d, buys[0].net / buys[0].sh]];
      for (const v of valuations[p.isin] ?? []) pts.push([v.d, v.price]);
      const cur = prices[p.isin];
      if (p.open && cur?.price && !(valuations[p.isin] ?? []).length) pts.push([cur.at.slice(0, 10), cur.price]);
      if (!p.open && sells.length) pts.push([sells.at(-1).d, sells.at(-1).px]);
      if (p.open) unpriced.push(p.name);
      return interpolator(pts);
    };

    // 4) recorrido día a día
    const state = positions.map((p) => ({ p, price: pricer(p), i: 0, sh: 0, ca: 0, last: null }));
    const bench = BENCHMARKS.map((b) => ({ ...b, read: reader(hist[b.symbol] ?? []), c: [] }));
    const out = { d: [], v: [], cost: [], idx: [], buy: [], sell: [], div: [] };
    let prevV = 0, idx = 100;
    for (let t = ms(firstDate); t <= ms(today); t += DAY) {
      const d = iso(t);
      let v = 0, cost = 0, buy = 0, sell = 0, div = 0;
      for (const s of state) {
        const { evs } = s.p;
        while (s.i < evs.length && evs[s.i].d <= d) {
          const e = evs[s.i++];
          if (e.k === 'D') { div += e.net; continue; }
          if (e.k === 'B') buy += e.net; else sell += e.net;
          s.sh = e.sa; s.ca = e.ca;
        }
        if (s.sh <= 0) continue;
        const px = s.price(d) ?? s.last ?? s.ca / s.sh; // sin dato todavía: a coste
        s.last = px;
        v += s.sh * px;
        cost += s.ca;
      }
      // Rentabilidad del día con las compras al inicio y ventas y dividendos al final.
      const base = prevV + buy;
      if (base > 0) idx *= (v + sell + div) / base;
      prevV = v;
      out.d.push(d); out.v.push(+v.toFixed(2)); out.cost.push(+cost.toFixed(2)); out.idx.push(+idx.toFixed(4));
      out.buy.push(+buy.toFixed(2)); out.sell.push(+sell.toFixed(2)); out.div.push(+div.toFixed(2));
      for (const b of bench) b.c.push(b.read(d));
    }
    return {
      ...out,
      benchmarks: bench.filter((b) => b.c.some((x) => x != null)).map(({ key, name, c }) => ({ key, name, c })),
      unpriced: [...new Set(unpriced)],
    };
  }

  return {
    /** Una sola reconstrucción a la vez: la primera descarga tarda y no debe duplicarse. */
    build(args) {
      const run = (running ?? Promise.resolve()).catch(() => {}).then(() => build(args));
      running = run;
      return run;
    },
    /** Cierres en euros de un ISIN: [[fecha, precio]]. */
    async asset(isin, from) {
      const symbols = await db.getSymbols();
      const s = symbols[isin]?.symbol;
      if (!s) return null;
      let meta = await ensure({ [s]: from });
      const cur = meta[s]?.currency;
      if (!cur) return null;
      const fxs = cur === 'EUR' ? null : `${cur}EUR=X`;
      if (fxs) meta = await ensure({ [fxs]: from });
      const hist = await db.getHistory(fxs ? [s, fxs] : [s]);
      const rate = fxs ? reader(hist[fxs]) : () => 1;
      return {
        symbol: s, currency: cur,
        rows: hist[s].filter(([d]) => d >= from).map(([d, c]) => [d, +(c * (rate(d) ?? NaN)).toFixed(4)]).filter(([, c]) => Number.isFinite(c)),
      };
    },
  };
}
