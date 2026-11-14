// Cotizaciones por ISIN desde los endpoints públicos de Yahoo Finance (y OpenFIGI
// como segunda fuente para encontrar el símbolo de un ISIN).
// No es una API oficial ni garantizada: puede ir con retraso (15 min en algunas
// bolsas) o dejar de responder; por eso todo se cachea y un fallo nunca rompe
// la cartera, solo deja el último precio guardado.

const SEARCH = 'https://query2.finance.yahoo.com/v1/finance/search';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FIGI = 'https://api.openfigi.com/v3/mapping';
// Fondos que no cotizan en bolsa (Private Markets, ELTIF…): su gestora publica un valor
// liquidativo, normalmente mensual. Se toma de onvista; el símbolo es «NAV:<fondo>:<serie>».
const ONVISTA = 'https://api.onvista.de/api/v1';
const NAV_TTL = 6 * 3600_000; // un valor liquidativo no cambia en horas
const isNav = (symbol) => symbol.startsWith('NAV:');
export const NAV_EXCHANGE = 'Valor liquidativo';
const QUOTE_TTL = 60_000; // no se pide el mismo símbolo más de una vez por minuto
const PAUSE = 120; // ms entre peticiones, en serie
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// Tipos de cambio de referencia del BCE (uno al día): respaldo si Yahoo no da la divisa.
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ECB_TTL = 6 * 3600_000;
// Fallos pasajeros (red, 429, 5xx): se reintenta con espera creciente.
const RETRIES = 2;
const BACKOFF = 400; // ms; se dobla en cada reintento
// Tras varios fallos seguidos de un proveedor se deja de llamarle un rato (que se dobla si
// sigue caído): ni se le carga más ni cada petición espera a que venza el tiempo de respuesta.
const TRIP = 4;
const COOL = 60_000;
const MAX_COOL = 15 * 60_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param sleep  (ms) => Promise; las esperas entre peticiones y reintentos (los tests no esperan)
 * @param log    dónde se avisa de que un proveedor se da por caído
 */
export function createQuotes({ fetchImpl = fetch, now = () => Date.now(), sleep = wait, log = console } = {}) {
  const cache = new Map(); // símbolo → { at, data }
  let chain = Promise.resolve(); // cola: una petición cada vez
  const breakers = new Map(); // servidor → { fails, until, cool }

  /** Una petición con reintentos y corte por proveedor. Devuelve el cuerpo (JSON o texto). */
  async function request(url, opts = {}, as = 'json') {
    const host = new URL(url).host;
    let b = breakers.get(host);
    if (!b) breakers.set(host, (b = { fails: 0, until: 0, cool: COOL }));
    if (now() < b.until) throw new Error(`${host} no responde: en pausa`);
    for (let i = 0; ; i++) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), ...opts });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          // Un 4xx (salvo 429) es la respuesta del proveedor, no una caída: ni se reintenta ni cuenta.
          err.transient = res.status === 429 || res.status >= 500;
          err.after = Number(res.headers?.get?.('retry-after')) * 1000 || 0;
          throw err;
        }
        const body = await (as === 'text' ? res.text() : res.json());
        b.fails = 0; b.cool = COOL;
        return body;
      } catch (err) {
        if (err.transient === false) throw err;
        if (i < RETRIES) { await sleep(Math.min(err.after || BACKOFF * 2 ** i, 5000)); continue; }
        if (++b.fails >= TRIP) {
          b.until = now() + b.cool;
          log.warn(`Cotizaciones: ${host} lleva ${b.fails} fallos seguidos (${err.message}); en pausa ${Math.round(b.cool / 1000)} s.`);
          b.cool = Math.min(b.cool * 2, MAX_COOL);
        }
        throw err;
      }
    }
  }
  const queued = (run) => {
    const p = chain.then(run, run);
    chain = p.then(() => sleep(PAUSE), () => sleep(PAUSE));
    return p;
  };
  const get = (url, as) => queued(() => request(url, { headers: { accept: as === 'text' ? '*/*' : 'application/json' } }, as));

  const card = (hit) => ({
    symbol: hit.symbol, exchange: hit.exchDisp || hit.exchange || '',
    // Los ETF y fondos no traen sector.
    sector: hit.sectorDisp || hit.sector || null, industry: hit.industryDisp || hit.industry || null,
  });
  const search = async (q) => ((await get(`${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`)).quotes ?? [])
    .filter((x) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND'].includes(x.quoteType));

  /**
   * Segunda fuente: el buscador de Yahoo no conoce algunos ISIN (Alphabet A, varios ADR…).
   * OpenFIGI da su ticker en EE. UU., que en Yahoo es el mismo símbolo.
   */
  async function usTicker(isin) {
    const j = await queued(() => request(FIGI, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin, exchCode: 'US' }]),
    }));
    const ticker = j?.[0]?.data?.find((x) => x.ticker && x.marketSector === 'Equity')?.ticker;
    return ticker ? ticker.replace('/', '-') : null;
  }

  /** Fondo no cotizado → símbolo de su valor liquidativo, o null si la fuente no lo conoce. */
  async function navSymbol(isin) {
    const j = await get(`${ONVISTA}/instruments/query?limit=5&searchValue=${encodeURIComponent(isin)}`);
    const fund = (j.list ?? []).find((x) => x.isin === isin && x.entityType === 'FUND');
    if (!fund) return null;
    const snap = await get(`${ONVISTA}/funds/${fund.entityValue}/snapshot`);
    const notation = snap.quote?.market?.idNotation;
    if (!notation || !(snap.quote.last > 0)) return null;
    return { symbol: `NAV:${fund.entityValue}:${notation}`, exchange: NAV_EXCHANGE, sector: null, industry: null };
  }

  /** Valor liquidativo más reciente de un fondo no cotizado. */
  async function navQuote(symbol) {
    const [, fund] = symbol.split(':');
    const snap = await get(`${ONVISTA}/funds/${fund}/snapshot`);
    const q = snap.quote;
    if (!(q?.last > 0)) throw new Error('sin valor liquidativo');
    return {
      price: q.last, currency: q.isoCurrency || 'EUR', dayPct: null, // no hay variación diaria: se publica cada mes
      time: q.datetimeLast ?? q.datetimeBid ?? null, exchange: NAV_EXCHANGE, name: snap.instrument?.name ?? null, nav: true,
    };
  }

  /** Histórico de valores liquidativos: mismo formato que `history`. */
  async function navHistory(symbol, from) {
    const [, fund, notation] = symbol.split(':');
    const j = await get(`${ONVISTA}/instruments/FUND/${fund}/eod_history?idNotation=${notation}&range=Y5&startDate=${from}`);
    if (!j.datetimeLast?.length) throw new Error('sin histórico');
    const rows = j.datetimeLast.map((ts, i) => [new Date(ts * 1000).toISOString().slice(0, 10), j.last[i]])
      .filter(([, c]) => c > 0).sort((a, b) => a[0].localeCompare(b[0]));
    return { currency: j.isoCurrency || 'EUR', rows, divs: [], splits: [] };
  }

  /** ISIN → { symbol, exchange, sector, industry } o null si ninguna fuente lo conoce. */
  async function resolve(isin) {
    const hit = (await search(isin))[0];
    if (hit) return card(hit);
    const ticker = await usTicker(isin).catch(() => null);
    if (!ticker) return navSymbol(isin).catch(() => null);
    // Con el ticker, Yahoo sí da la ficha (bolsa, sector); si no, vale el ticker a secas.
    const same = (await search(ticker).catch(() => [])).find((x) => x.symbol === ticker);
    return same ? card(same) : { symbol: ticker, exchange: '', sector: null, industry: null };
  }

  /** Último precio de un símbolo: { price, currency, time, exchange }. */
  async function quote(symbol) {
    const hit = cache.get(symbol);
    if (hit && now() - hit.at < (isNav(symbol) ? NAV_TTL : QUOTE_TTL)) return hit.data;
    if (isNav(symbol)) {
      const nav = await navQuote(symbol);
      cache.set(symbol, { at: now(), data: nav });
      return nav;
    }
    const j = await get(`${CHART}/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const m = j.chart?.result?.[0]?.meta;
    if (!m || !(m.regularMarketPrice > 0)) throw new Error('sin precio');
    let price = m.regularMarketPrice, currency = m.currency;
    // Variación frente al cierre anterior, en la divisa de cotización.
    const prev = m.chartPreviousClose ?? m.previousClose;
    const dayPct = prev > 0 ? (price / prev - 1) * 100 : null;
    // Londres cotiza en peniques (GBp / GBX).
    if (currency === 'GBp' || currency === 'GBX') { price /= 100; currency = 'GBP'; }
    const data = {
      price, currency, dayPct,
      time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
      exchange: m.fullExchangeName || m.exchangeName || '',
    };
    cache.set(symbol, { at: now(), data });
    return data;
  }

  /** Tipos de referencia del BCE: { USD: unidades por euro, … }. */
  let ecb = null; // { at, rates }
  async function ecbRates() {
    if (ecb && now() - ecb.at < ECB_TTL) return ecb.rates;
    const xml = await get(ECB, 'text');
    const rates = Object.fromEntries([...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)].map((m) => [m[1], Number(m[2])]));
    if (!Object.keys(rates).length) throw new Error('sin tipos de cambio');
    ecb = { at: now(), rates };
    return rates;
  }

  /** Cuántos euros vale una unidad de la divisa. Si Yahoo no la da, el tipo de referencia del BCE. */
  async function eurRate(currency) {
    if (currency === 'EUR') return 1;
    try {
      return (await quote(`${currency}EUR=X`)).price;
    } catch (err) {
      const perEur = (await ecbRates().catch(() => ({})))[currency];
      if (!(perEur > 0)) throw err;
      return 1 / perEur;
    }
  }

  /**
   * Precio en euros de cada ISIN. `symbols` es la caché persistente ISIN → símbolo
   * (objeto { [isin]: { symbol, exchange } | null }); los que falten se resuelven
   * y se devuelven en `resolved` para guardarlos.
   */
  async function quoteIsins(isins, symbols = {}) {
    const out = {}, resolved = {}, failed = [];
    for (const isin of isins) {
      if (!ISIN_RE.test(isin)) continue;
      try {
        let sym = symbols[isin];
        if (sym === undefined) {
          sym = await resolve(isin);
          resolved[isin] = sym;
        }
        if (!sym) { failed.push(isin); continue; }
        const q = await quote(sym.symbol);
        const rate = await eurRate(q.currency);
        out[isin] = {
          price: q.price * rate,
          info: { symbol: sym.symbol, exchange: q.exchange || sym.exchange, currency: q.currency, raw: q.price, rate, time: q.time, dayPct: q.dayPct, ...(q.nav ? { nav: true, name: q.name } : {}) },
        };
      } catch {
        failed.push(isin);
      }
    }
    return { quotes: out, resolved, failed };
  }

  /** Nombre de un valor por su ISIN, o null. */
  async function nameOf(isin) {
    const hit = (await search(isin).catch(() => []))[0];
    return hit?.longname || hit?.shortname || null;
  }

  /** Resuelve los ISIN que falten en `symbols`; devuelve solo los nuevos. */
  async function resolveIsins(isins, symbols = {}) {
    const resolved = {};
    for (const isin of isins) {
      if (!ISIN_RE.test(isin) || symbols[isin] !== undefined) continue;
      try {
        resolved[isin] = await resolve(isin);
      } catch { /* se reintenta en la próxima llamada */ }
    }
    return resolved;
  }

  /**
   * Cierres diarios de un símbolo desde una fecha (AAAA-MM-DD), en su divisa.
   * Devuelve { currency, rows: [[fecha, cierre]], divs: [[fecha, importe por acción]], splits: [[fecha, ratio]] }.
   * Cierres y dividendos vienen ya ajustados por los splits posteriores.
   */
  async function history(symbol, from) {
    if (isNav(symbol)) return navHistory(symbol, from);
    const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400;
    const p2 = Math.floor(now() / 1000) + 86400;
    const j = await get(`${CHART}/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&events=div%2Csplits`);
    const r = j.chart?.result?.[0];
    if (!r?.timestamp) throw new Error('sin histórico');
    let currency = r.meta.currency, k = 1;
    if (currency === 'GBp' || currency === 'GBX') { currency = 'GBP'; k = 0.01; }
    const off = r.meta.gmtoffset ?? 0; // la fecha es la del día de mercado en su bolsa
    const day = (ts) => new Date((ts + off) * 1000).toISOString().slice(0, 10);
    const close = r.indicators?.quote?.[0]?.close ?? [];
    const byDay = new Map();
    r.timestamp.forEach((ts, i) => { if (close[i] > 0) byDay.set(day(ts), close[i] * k); });
    const divs = Object.values(r.events?.dividends ?? {}).map((e) => [day(e.date), e.amount * k]);
    // Ratio = acciones nuevas por cada acción antigua (4 en un split 4:1; 0,1 en un contrasplit 1:10).
    const splits = Object.values(r.events?.splits ?? {})
      .map((e) => [day(e.date), e.numerator / e.denominator])
      .filter(([, ratio]) => Number.isFinite(ratio) && ratio > 0 && ratio !== 1)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return { currency, rows: [...byDay].sort((a, b) => a[0].localeCompare(b[0])), divs, splits };
  }

  return {
    quoteIsins, resolveIsins, history, nameOf,
    /** Proveedores en pausa por fallos seguidos: { servidor: milisegundos que faltan }. */
    paused: () => Object.fromEntries([...breakers].filter(([, b]) => now() < b.until).map(([h, b]) => [h, b.until - now()])),
  };
}
