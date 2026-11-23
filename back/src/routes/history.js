// Histórico diario de la cartera, previsión de dividendos, mini-gráficas e histórico de un valor.
import crypto from 'node:crypto';
import { isDate } from '../lib/validate.js';
import { riskReport } from '../../../shared/risk.ts';

const HISTORY_TTL = 10 * 60_000;
// Sube al cambiar la forma del histórico (p. ej. series por tipo de activo): invalida lo guardado.
const HISTORY_FORMAT = 3;

/** Devuelve { forget(userId) } para soltar lo que se guarda en memoria de una cuenta borrada. */
export default function historyRoutes(api, { db, history, pf, historyWaitMs, log = console }) {
  const { built } = pf;
  const historyCache = new Map(); // usuario → { key, at, value }
  const historyJobs = new Map(); // usuario → { key, progress, promise }: reconstrucción en marcha

  // Valor diario de la cartera, índice de rentabilidad e índices de referencia.
  // La serie calculada se guarda en la base de datos. Si hay que reconstruirla y tarda (la
  // primera vez descarga el histórico de cada valor), se responde enseguida con la última
  // guardada y { pending, progress }; el cliente vuelve a preguntar hasta tenerla.
  api.get('/history', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const userId = req.userId;
    const [rows, prices, valuations] = await Promise.all([db.getRows(userId), db.getPrices(userId), db.getValuations(userId)]);
    const b = await built(userId, rows);
    // Depende de las operaciones y splits (huella de los eventos), del día, de los precios a
    // mano y de las valoraciones. Las cotizaciones del día cambian el último punto: por eso
    // además caduca a los pocos minutos.
    const manual = Object.entries(prices).filter(([, p]) => p.source === 'manual').map(([isin, p]) => [isin, p.price]);
    const key = crypto.createHash('sha1')
      .update(JSON.stringify([HISTORY_FORMAT, new Date().toISOString().slice(0, 10), b.etag, manual, valuations])).digest('base64url');

    let saved = historyCache.get(userId);
    if (!saved) {
      saved = await db.getHistoryCache(userId);
      if (saved) historyCache.set(userId, saved);
    }
    if (saved?.key === key && Date.now() - saved.at < HISTORY_TTL) return res.json({ history: saved.value });

    let job = historyJobs.get(userId);
    if (job?.key !== key) {
      const progress = { done: 0, total: 0 };
      const promise = history.build({
        positions: b.positions, prices, valuations, progress,
        rebuild: async () => (await built(userId, await db.getRows(userId))).positions,
      }).then(async (value) => {
        const entry = { key, at: Date.now(), value };
        historyCache.set(userId, entry);
        if (historyCache.size > 500) historyCache.delete(historyCache.keys().next().value);
        await db.saveHistoryCache(userId, key, value).catch((err) => log.error('Histórico:', err.message));
        return entry;
      }).finally(() => { if (historyJobs.get(userId)?.promise === promise) historyJobs.delete(userId); });
      promise.catch(() => {}); // si nadie la espera, que no quede como rechazo sin tratar
      job = { key, progress, promise };
      historyJobs.set(userId, job);
    }
    const waited = await Promise.race([job.promise, new Promise((r) => { setTimeout(r, historyWaitMs).unref?.(); })]);
    if (waited) return res.json({ history: waited.value });
    res.json({ history: saved?.value ?? null, pending: true, progress: { ...job.progress } });
  });

  // Previsión de dividendos de los próximos 12 meses.
  api.get('/dividends/forecast', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const rows = await db.getRows(req.userId);
    res.json({ forecast: await history.dividends((await built(req.userId, rows)).positions) });
  });

  // Últimos 30 días de cada posición abierta, para las mini-gráficas de las tarjetas.
  api.get('/sparks', async (req, res) => {
    if (!history) return res.json({ sparks: {} });
    const b = await built(req.userId, await db.getRows(req.userId));
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ sparks: await history.sparks(b.positions.filter((p) => p.open).map((p) => p.isin)) });
  });

  // Riesgo y diversificación de las posiciones abiertas con el último año de cierres guardados:
  // volatilidad, correlaciones y qué parte del riesgo aporta cada valor (shared/risk.ts).
  // { risk: null } si aún no hay histórico suficiente de al menos dos valores.
  api.get('/risk', async (req, res) => {
    if (!history) return res.json({ risk: null });
    const [rows, prices] = await Promise.all([db.getRows(req.userId), db.getPrices(req.userId)]);
    const open = (await built(req.userId, rows)).positions.filter((p) => p.open && prices[p.isin]?.price > 0);
    const closes = await history.closes(open.map((p) => p.isin));
    const risk = riskReport(open.map((p) => ({ key: p.isin, v: p.sh * prices[p.isin].price, rows: closes[p.isin] ?? [] })));
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ risk });
  });

  // Cierres en euros de un valor desde una fecha, para la ficha.
  api.get('/assets/:isin/history', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const from = isDate(req.query.from) ? req.query.from : '2000-01-01';
    // ?bench=world añade el índice en euros desde la misma fecha, para comparar.
    const [asset, bench] = await Promise.all([
      history.asset(req.params.isin, from),
      req.query.bench ? history.benchmark(String(req.query.bench), from).catch(() => null) : null,
    ]);
    res.json({ asset, bench });
  });

  return { forget: (userId) => { historyCache.delete(userId); historyJobs.delete(userId); } };
}
