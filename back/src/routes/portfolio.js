// Cartera: posiciones, eventos, subida del CSV, precios, valoraciones, cotización y logotipos.
import crypto from 'node:crypto';
import multer from 'multer';
import { parseCsv } from '../engine.js';
import { parsePrice, assetMap, check } from '../lib/validate.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export default function portfolioRoutes(api, { db, quotes, logos, stream, pf }) {
  const { portfolio, built, quoteUsers } = pf;

  api.get('/stream', (req, res) => {
    if (!stream) return res.status(503).json({ error: 'Las cotizaciones en vivo están desactivadas.' });
    return stream.connect(req, res, req.userId);
  });

  api.get('/portfolio', async (req, res) => res.json(await portfolio(req.userId)));

  // Eventos (compras, ventas, dividendos, splits) y lotes de cada posición: { evs: { ISIN: […] }, lots: { ISIN: […] } }.
  // El navegador los revalida con If-None-Match y casi siempre recibe un 304 vacío.
  api.get('/events', async (req, res) => {
    const b = await built(req.userId, await db.getRows(req.userId));
    res.set({ ETag: b.etag, 'Cache-Control': 'private, no-cache' });
    if (req.fresh) return res.status(304).end();
    res.type('json').send(b.events);
  });

  // Sube un CSV de Trade Republic. Por defecto se fusiona por transaction_id
  // (subir dos veces el mismo archivo no duplica nada); ?replace=1 sustituye todo.
  api.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo.' });
    const { rows, total, invest, unknown } = parseCsv(req.file.buffer.toString('utf8'));
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    // ?preview=1: cuenta qué cambiaría, sin guardar nada.
    if (req.query.preview === '1') {
      const dates = rows.map((r) => r.date).filter(Boolean).sort();
      return res.json({
        preview: { name, total, relevant: invest, unknown, from: dates[0] ?? null, to: dates.at(-1) ?? null, ...(await db.previewUpload(req.userId, rows)) },
      });
    }
    const info = await db.saveUpload(req.userId, {
      name, total, rows, relevant: invest, replace: req.query.replace === '1',
      sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
    });
    res.json({ upload: { ...info, unknown }, ...(await portfolio(req.userId)) });
  });

  // Fija (o borra, con price vacío) el precio actual de una posición.
  api.put('/prices/:isin', async (req, res) => {
    const price = parsePrice(req.body?.price);
    const at = await db.setPrices(req.userId, { [req.params.isin]: price });
    if (price) await db.setValuation(req.userId, req.params.isin, at.slice(0, 10), price);
    res.json({ isin: req.params.isin, price, at: price ? at : null, source: price ? 'manual' : null });
  });

  // Actualiza con cotización en vivo las posiciones abiertas que no tienen un precio fijado
  // a mano. Los fondos no cotizados (Private Markets) reciben su último valor liquidativo.
  api.post('/quotes/refresh', async (req, res) => {
    if (!quotes) return res.status(503).json({ error: 'Las cotizaciones en vivo están desactivadas.' });
    const r = (await quoteUsers([req.userId])).get(req.userId);
    // Símbolos nuevos traen sector e industria: entonces sí se vuelve a leer la cartera.
    if (r.resolved) return res.json({ ...(await portfolio(req.userId)), fired: r.fired, refresh: { at: r.at, updated: r.updated, failed: r.failed, paused: r.paused } });
    // La cartera ya leída, con los precios recién cotizados y las alertas que han saltado:
    // no hace falta volver a la base de datos.
    const fired = new Set(r.fired.map((al) => al.id));
    const positions = r.pf.positions.map((p) => (r.prices[p.isin]
      ? { ...p, price: r.prices[p.isin].price, priceAt: r.at, priceSource: 'live', priceInfo: r.prices[p.isin].info }
      : p));
    const alerts = r.pf.alerts.map((al) => (fired.has(al.id) ? { ...al, triggered_at: r.at } : al));
    res.json({ ...r.pf, positions, alerts, fired: r.fired, refresh: { at: r.at, updated: r.updated, failed: r.failed, paused: r.paused } });
  });

  // Valoraciones con fecha de lo que no cotiza.
  api.get('/valuations', async (req, res) => res.json({ valuations: await db.getValuations(req.userId) }));
  api.put('/valuations/:isin/:d', async (req, res) => {
    const price = parsePrice(req.body?.price);
    check(price, 'Precio no válido.');
    await db.setValuation(req.userId, req.params.isin, req.params.d, price);
    res.json({ valuations: await db.getValuations(req.userId) });
  });
  api.delete('/valuations/:isin/:d', async (req, res) => {
    await db.deleteValuation(req.userId, req.params.isin, req.params.d);
    res.json({ valuations: await db.getValuations(req.userId) });
  });

  // Varios precios a la vez: { prices: { ISIN: precio, … } }
  api.put('/prices', async (req, res) => {
    const valid = Object.fromEntries(
      assetMap(req.body?.prices, 1000, 'precios').map(([k, v]) => [k, parsePrice(v)]).filter(([, v]) => v),
    );
    await db.setPrices(req.userId, valid);
    res.json({ updated: Object.keys(valid).length });
  });

  // Logotipo de un valor. 404 si no hay: el front enseña las iniciales.
  api.get('/logos/:isin', async (req, res) => {
    const logo = logos ? await logos.get(req.params.isin.toUpperCase()).catch(() => null) : null;
    // Sin servicio de logotipos (LOGOS=0) el 404 no se guarda: al activarlo deben aparecer enseguida.
    if (!logo) return res.status(404).set('Cache-Control', logos ? 'private, max-age=86400' : 'no-store').end();
    res.set({ 'Content-Type': logo.type, 'Cache-Control': 'private, max-age=604800' }).send(logo.data);
  });
}
