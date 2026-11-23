// Resumen periódico por aviso push: una vez a la semana o al mes, cómo va la cartera (valor,
// resultado del periodo, lo mejor y lo peor, y si algo se ha desviado de la cartera objetivo).
import { prepare, baseIndex } from '../../shared/perf.ts';

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const eur = (n) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const signed = (n, unit) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} ${unit}`;
const DRIFT_MIN = 5; // puntos de desvío del objetivo a partir de los que se menciona

/**
 * Clave del periodo en curso: el lunes de esta semana o el día 1 de este mes. Si el último
 * resumen enviado es anterior, toca enviar otro.
 */
export function periodKey(every, now) {
  const d = new Date(now);
  if (every === 'month') return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
}

/**
 * Texto del aviso.
 * @param data  { every, value, gain, pct, best, worst, drift }: gain/pct del periodo (o null si no se
 *              conoce), best/worst = { name, pct } y drift = { name, points } (positivo: pesa de más)
 */
export function digestText({ every, value, gain = null, pct = null, best = null, worst = null, drift = null }) {
  const span = every === 'month' ? 'Este mes' : 'Esta semana';
  const parts = [`Tu cartera vale ${eur(value)}.`];
  if (gain != null) parts.push(`${span}: ${signed(gain, '€')}${pct != null ? ` (${signed(pct, '%')})` : ''}.`);
  if (best && worst && best.name !== worst.name) parts.push(`Lo mejor: ${best.name} ${signed(best.pct, '%')}; lo peor: ${worst.name} ${signed(worst.pct, '%')}.`);
  else if (best) parts.push(`${best.name}: ${signed(best.pct, '%')}.`);
  if (drift) parts.push(`${drift.name} pesa ${Math.abs(drift.points).toLocaleString('es-ES', { maximumFractionDigits: 1 })} puntos ${drift.points > 0 ? 'más' : 'menos'} que su objetivo.`);
  return { title: every === 'month' ? 'Tu mes en Cartera' : 'Tu semana en Cartera', body: parts.join(' '), url: '/resumen', tag: 'digest' };
}

/**
 * @param pf       servicio de cartera (services/portfolio.js)
 * @param history  servicio de history.js (o null: sin lo mejor y lo peor)
 * @param hour     hora UTC a partir de la que se envía
 */
export function createDigest({ db, quotes = null, history = null, push = null, pf, log = console, now = () => Date.now(), hour = 7 }) {
  /** Reúne los datos del resumen de un usuario. null si no tiene posiciones con precio. */
  async function build(userId, every) {
    const rows = await db.getRows(userId);
    const open = (await pf.built(userId, rows)).positions.filter((p) => p.open);
    if (!open.length) return null;
    // Con la app cerrada los precios guardados pueden ser de hace días: se cotiza antes.
    if (quotes) {
      try {
        const { quotes: found, resolved } = await quotes.quoteIsins(open.map((p) => p.isin), await db.getSymbols());
        await db.saveSymbols(resolved);
        await db.setLivePrices(found);
      } catch (err) { log.warn('Resumen: sin cotizaciones nuevas', err.message); }
    }
    const prices = await db.getPrices(userId);
    const priced = open.filter((p) => prices[p.isin]?.price > 0).map((p) => ({ p, v: p.sh * prices[p.isin].price }));
    const value = priced.reduce((t, x) => t + x.v, 0);
    if (!(value > 0)) return null;
    const days = every === 'month' ? 30 : 7;
    const since = iso(now() - days * DAY);
    const data = { every, value };

    // Resultado del periodo: con el histórico guardado, si llega hasta estos días.
    const cache = await db.getHistoryCache(userId);
    const h = cache?.value?.d?.length ? prepare(cache.value) : null;
    if (h && h.d.at(-1) >= iso(now() - 3 * DAY)) {
      const i0 = baseIndex(h, since), last = h.d.length - 1;
      if (i0 >= 0 && h.v[i0] > 0) {
        const put = (h.cumBuy[last] - h.cumBuy[i0]) - (h.cumSell[last] - h.cumSell[i0]) - (h.cumDiv[last] - h.cumDiv[i0]);
        data.gain = value - h.v[i0] - put;
        data.pct = (data.gain / h.v[i0]) * 100;
      }
    }
    // Lo mejor y lo peor: variación de cada valor entre el cierre de entonces y el último.
    if (history) {
      const closes = await history.closes(priced.map((x) => x.p.isin), days + 10);
      const moves = [];
      for (const { p } of priced) {
        const list = closes[p.isin];
        if (!list?.length) continue;
        const from = list.findLast(([d]) => d <= since) ?? list[0], to = list.at(-1);
        if (from[1] > 0 && to[0] > from[0]) moves.push({ name: p.name, pct: (to[1] / from[1] - 1) * 100 });
      }
      moves.sort((a, b) => b.pct - a.pct);
      if (moves.length) { data.best = moves[0]; data.worst = moves.at(-1); }
    }
    // El mayor desvío de la cartera objetivo.
    const targets = await db.getTargets(userId);
    let drift = null;
    for (const { p, v } of priced) {
      const t = targets[p.isin];
      if (!(t > 0)) continue;
      const points = (v / value) * 100 - t;
      if (Math.abs(points) >= DRIFT_MIN && (!drift || Math.abs(points) > Math.abs(drift.points))) drift = { name: p.name, points };
    }
    if (drift) data.drift = drift;
    return data;
  }

  /** Envía ahora el resumen de un usuario. Devuelve { sent, title, body } o null si no hay nada que contar. */
  async function send(userId, every) {
    const data = await build(userId, every);
    if (!data) return null;
    const text = digestText(data);
    return { ...text, sent: push ? await push.notify(userId, text) : 0 };
  }

  let running = false;
  /** Una pasada: envía el resumen a quien lo tenga activado y aún no lo haya recibido este periodo. */
  async function run() {
    if (running || !push || new Date(now()).getUTCHours() < hour) return 0;
    running = true;
    let n = 0;
    try {
      for (const u of await db.getDigestUsers()) {
        const key = periodKey(u.every, now());
        if (u.sent >= key) continue;
        if (!(await db.getPushSubs(u.userId)).length) continue; // sin dispositivos: se intentará cuando haya uno
        try {
          const r = await send(u.userId, u.every);
          await db.setUserSetting(u.userId, '_digest_sent', key);
          if (r?.sent) n++;
        } catch (err) { log.error('Resumen:', err.message); }
      }
    } finally {
      running = false;
    }
    return n;
  }

  return {
    build, send, run,
    /** Comprueba cada `minutes` minutos si toca enviar. Devuelve la función que lo detiene. */
    start(minutes = 60) {
      const id = setInterval(() => run().catch((err) => log.error('Resumen:', err.message)), minutes * 60_000);
      id.unref();
      return () => clearInterval(id);
    },
  };
}
