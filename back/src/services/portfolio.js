// La cartera de cada usuario: posiciones calculadas (con caché), precios y cotización en vivo.
import crypto from 'node:crypto';
import { buildPortfolio, isInvestRow, unknownTypes } from '../engine.js';
import { measure } from '../timing.js';

/**
 * @param db       repositorio de db.js
 * @param quotes   servicio de quotes.js (o null: sin cotizaciones en vivo)
 * @param history  servicio de history.js (o null)
 * @param watcher  vigilante de alertas (alerts.js)
 */
export function createPortfolio({ db, quotes, history, watcher }) {
  /** Splits conocidos de cada ISIN ({ ISIN: [[fecha, ratio]] }), para que el motor ajuste las acciones. */
  async function loadSplits(symbols) {
    const [bySymbol, known] = await Promise.all([db.getSplits(), symbols ?? db.getSymbols()]);
    const out = {};
    for (const [isin, s] of Object.entries(known)) if (s?.symbol && bySymbol[s.symbol]) out[isin] = bySymbol[s.symbol];
    return out;
  }

  // Posiciones calculadas de cada usuario, mientras no cambien sus operaciones ni los splits.
  const builtCache = new Map(); // usuario → { key, value }
  async function built(userId, rows, symbols) {
    const splits = await loadSplits(symbols);
    const key = `${db.rowsVersion?.(userId)}|${JSON.stringify(splits)}`;
    const hit = builtCache.get(userId);
    if (hit?.key === key && hit.rows === rows) return hit.value;
    const value = measure('calc', () => {
      const b = buildPortfolio(rows, splits);
      // Los eventos y lotes de cada posición son casi todo el peso de la cartera: viajan
      // aparte (/api/events), ya serializados, con una huella que solo cambia con ellos.
      const events = JSON.stringify({
        evs: Object.fromEntries(b.positions.map((p) => [p.isin, p.evs])),
        lots: Object.fromEntries(b.positions.map((p) => [p.isin, p.lots])),
      });
      return {
        ...b, events, etag: `"${crypto.createHash('sha1').update(events).digest('base64url')}"`,
        invest: rows.filter(isInvestRow).length, unknown: unknownTypes(rows),
        splits: b.positions.reduce((n, p) => n + p.evs.filter((e) => e.k === 'X').length, 0),
      };
    });
    builtCache.delete(userId);
    builtCache.set(userId, { key, rows, value });
    if (builtCache.size > 200) builtCache.delete(builtCache.keys().next().value);
    return value;
  }

  async function portfolio(userId) {
    const [rows, symbols, { prices, lastUpload, alerts, targets }] = await Promise.all([db.getRows(userId), db.getSymbols(), db.getUserState(userId)]);
    const b = await built(userId, rows, symbols);
    // Copias: las posiciones calculadas se comparten entre peticiones.
    const positions = b.positions.map(({ evs: _e, lots: _l, ...p }) => {
      const px = prices[p.isin];
      return {
        ...p,
        nev: _e.length, // cuántos eventos tiene (los eventos van en /api/events)
        price: px?.price ?? null,
        priceAt: px?.at ?? null,
        priceSource: px?.source ?? null, // 'manual' | 'live'
        priceInfo: px?.info ?? null, // símbolo, bolsa, divisa y cambio de la cotización en vivo
        quotable: !!symbols[p.isin]?.symbol, // hay una fuente de precio, aunque ahora mande uno a mano
        sector: symbols[p.isin]?.sector ?? null,
        industry: symbols[p.isin]?.industry ?? null,
      };
    });
    return {
      positions, alerts, targets,
      meta: {
        lastDate: b.lastDate, firstDate: b.firstDate, rows: b.invest, lastUpload, liveQuotes: !!quotes, history: !!history,
        splits: b.splits, unknown: b.unknown, v: db.rowsVersion?.(userId) ?? 0, stream: !!quotes,
        ev: b.etag, // huella de /api/events: si no cambia, los eventos que ya tiene el cliente valen
      },
    };
  }

  /**
   * Cotiza de una vez las posiciones abiertas de varios usuarios (las que no tienen precio a
   * mano), guarda las cotizaciones (son de todos) y marca las alertas que se cumplen.
   * Devuelve Map(usuario → { pf, at, prices, updated, failed, fired }).
   */
  async function quoteUsers(userIds) {
    const pfs = new Map();
    for (const id of userIds) pfs.set(id, await portfolio(id));
    const wanted = new Set(), manual = new Set(), names = {};
    for (const pf of pfs.values()) {
      for (const p of pf.positions) {
        if (!p.open) continue;
        names[p.isin] ??= p.name;
        (p.priceSource === 'manual' ? manual : wanted).add(p.isin);
      }
    }
    const known = await db.getSymbols();
    const { quotes: found, resolved, failed } = await quotes.quoteIsins([...wanted], known);
    // Las que tienen precio a mano también se buscan, para poder ofrecer la vuelta a la cotización.
    const pending = [...manual].filter((isin) => !wanted.has(isin));
    if (quotes.resolveIsins && pending.length) Object.assign(resolved, await quotes.resolveIsins(pending, { ...known, ...resolved }));
    await db.saveSymbols(resolved);
    const at = await db.setLivePrices(found);
    const out = new Map();
    for (const [id, pf] of pfs) {
      const mine = pf.positions.filter((p) => p.open && p.priceSource !== 'manual').map((p) => p.isin);
      const got = Object.fromEntries(mine.filter((isin) => found[isin]).map((isin) => [isin, found[isin]]));
      // Alertas de precio que se cumplen con las cotizaciones nuevas: saltan una sola vez.
      // La app está abierta y las enseña ella; no hace falta el aviso al dispositivo.
      const fired = await watcher.fire(id, pf.alerts, got, names, false);
      out.set(id, {
        pf, at, fired, resolved: Object.keys(resolved).length,
        prices: Object.fromEntries(Object.entries(got).map(([isin, q]) => [isin, { price: q.price, at, info: q.info ?? null }])),
        updated: Object.keys(got).length,
        // Solo cuentan como fallo los que tienen ISIN cotizable (no cripto, etc.).
        failed: failed.filter((isin) => mine.includes(isin)).map((isin) => names[isin]),
      });
    }
    return out;
  }

  // Una operación no puede dejar una posición en negativo (vender más de lo que hay).
  const oversold = async (rows) => {
    const splits = await loadSplits();
    return measure('calc', () => buildPortfolio(rows, splits).positions.find((p) => p.sh < -1e-6 || p.evs.some((e) => e.sa < -1e-6)));
  };

  return { loadSplits, built, portfolio, quoteUsers, oversold, forget: (userId) => builtCache.delete(userId) };
}
