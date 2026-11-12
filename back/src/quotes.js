// Cotizaciones por ISIN desde los endpoints públicos de Yahoo Finance.
// No es una API oficial ni garantizada: puede ir con retraso (15 min en algunas
// bolsas) o dejar de responder; por eso todo se cachea y un fallo nunca rompe
// la cartera, solo deja el último precio guardado.

const SEARCH = 'https://query2.finance.yahoo.com/v1/finance/search';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const QUOTE_TTL = 60_000; // no se pide el mismo símbolo más de una vez por minuto
const PAUSE = 120; // ms entre peticiones, en serie
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createQuotes({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map(); // símbolo → { at, data }
  let chain = Promise.resolve(); // cola: una petición cada vez

  const get = (url) => {
    const run = async () => {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const p = chain.then(run, run);
    chain = p.then(() => sleep(PAUSE), () => sleep(PAUSE));
    return p;
  };

  /** ISIN → { symbol, exchange, sector, industry } o null si Yahoo no lo conoce. */
  async function resolve(isin) {
    const j = await get(`${SEARCH}?q=${encodeURIComponent(isin)}&quotesCount=8&newsCount=0`);
    const hit = (j.quotes ?? []).find((q) => q.symbol && ['EQUITY', 'ETF', 'MUTUALFUND'].includes(q.quoteType));
    if (!hit) return null;
    return {
      symbol: hit.symbol, exchange: hit.exchDisp || hit.exchange || '',
      // Los ETF y fondos no traen sector.
      sector: hit.sectorDisp || hit.sector || null, industry: hit.industryDisp || hit.industry || null,
    };
  }

  /** Último precio de un símbolo: { price, currency, time, exchange }. */
  async function quote(symbol) {
    const hit = cache.get(symbol);
    if (hit && now() - hit.at < QUOTE_TTL) return hit.data;
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

  /** Cuántos euros vale una unidad de la divisa. */
  async function eurRate(currency) {
    if (currency === 'EUR') return 1;
    return (await quote(`${currency}EUR=X`)).price;
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
          info: { symbol: sym.symbol, exchange: q.exchange || sym.exchange, currency: q.currency, raw: q.price, rate, time: q.time, dayPct: q.dayPct },
        };
      } catch {
        failed.push(isin);
      }
    }
    return { quotes: out, resolved, failed };
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

  return { quoteIsins, resolveIsins, history };
}
