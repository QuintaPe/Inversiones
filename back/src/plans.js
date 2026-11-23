// Valor liquidativo diario de los planes de pensiones, aunque nadie abra la app. Su fuente
// (Quefondos) solo da el último valor publicado: si no se guarda cada día, entre dos fines de
// mes la gráfica sería una recta. La programa index.js una vez al día (jobs.daily).
import { isPlanSymbol } from './quotes.js';

const DAY = 86_400_000;

export function createPlanNavs({ db, quotes, now = () => Date.now(), log = console }) {
  /** Guarda el precio actual y el histórico reciente de cada plan. Devuelve cuántos se guardaron. */
  async function run() {
    const symbols = await db.getSymbols();
    const plans = Object.entries(symbols).filter(([, s]) => s?.symbol && isPlanSymbol(s.symbol));
    if (!plans.length) return 0;
    // El precio actual, para todas las cuentas que lo tengan.
    const { quotes: found } = await quotes.quoteIsins(plans.map(([isin]) => isin), symbols);
    if (Object.keys(found).length) await db.setLivePrices(found);
    // El histórico: el último mes (los fines de mes ya los trae la ficha; lo nuevo es el día).
    const from = new Date(now() - 40 * DAY).toISOString().slice(0, 10);
    let n = 0;
    for (const [, s] of plans) {
      try {
        const h = await quotes.history(s.symbol, from);
        if (h.rows.length) { await db.saveHistory(s.symbol, { ...h, from: h.rows[0][0] }); n++; }
      } catch (err) {
        log.warn(`Planes: sin valor liquidativo de ${s.symbol} (${err.message})`);
      }
    }
    if (n) log.info(`Planes: valor liquidativo de ${n} ${n === 1 ? 'plan' : 'planes'} guardado.`);
    return n;
  }

  return { run };
}
