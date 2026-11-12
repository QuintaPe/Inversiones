import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, buildPortfolio, CsvError } from './engine.js';
import { sessions, AuthError } from './auth.js';
import { createHistory } from './history.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const parsePrice = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param db            repositorio de db.js
 * @param verifyGoogle  (credential) => perfil; null si no hay GOOGLE_CLIENT_ID
 * @param quotes        servicio de quotes.js (o null para desactivar las cotizaciones en vivo)
 */
export function createApp({ db, verifyGoogle, googleClientId, sessionSecret, quotes = null, trustProxy = false }) {
  const app = express();
  const session = sessions(sessionSecret);
  const history = quotes?.history ? createHistory({ db, quotes }) : null;
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  if (trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  async function portfolio(userId) {
    const [rows, prices, lastUpload, symbols] = await Promise.all([
      db.getRows(userId), db.getPrices(userId), db.lastUpload(userId), db.getSymbols(),
    ]);
    const { positions, lastDate, firstDate } = buildPortfolio(rows);
    for (const p of positions) {
      const px = prices[p.isin];
      p.price = px?.price ?? null;
      p.priceAt = px?.at ?? null;
      p.priceSource = px?.source ?? null; // 'manual' | 'live'
      p.priceInfo = px?.info ?? null; // símbolo, bolsa, divisa y cambio de la cotización en vivo
      p.sector = symbols[p.isin]?.sector ?? null;
      p.industry = symbols[p.isin]?.industry ?? null;
    }
    return { positions, meta: { lastDate, firstDate, rows: rows.length, lastUpload, liveQuotes: !!quotes, history: !!history } };
  }

  // ---------- sesión ----------
  app.get('/api/config', (_req, res) => res.json({ googleClientId: googleClientId ?? null }));

  app.post('/api/auth/google', async (req, res) => {
    if (!verifyGoogle) throw new AuthError('El servidor no tiene configurado GOOGLE_CLIENT_ID.');
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential) throw new AuthError('Falta la credencial de Google.');
    const profile = await verifyGoogle(credential);
    await db.upsertUser(profile);
    session.issue(res, req, profile.id);
    res.json({ user: profile });
  });

  app.post('/api/auth/logout', (_req, res) => {
    session.clear(res);
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    const id = session.read(req);
    res.json({ user: id ? await db.getUser(id) : null });
  });

  // ---------- todo lo demás requiere sesión ----------
  const api = express.Router();
  api.use(async (req, res, next) => {
    const id = session.read(req);
    const user = id && (await db.getUser(id));
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    req.userId = user.id;
    next();
  });

  api.get('/portfolio', async (req, res) => res.json(await portfolio(req.userId)));

  // Sube un CSV de Trade Republic. Por defecto se fusiona por transaction_id
  // (subir dos veces el mismo archivo no duplica nada); ?replace=1 sustituye todo.
  api.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo.' });
    const { rows, total } = parseCsv(req.file.buffer.toString('utf8'));
    const info = await db.saveUpload(req.userId, {
      name: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      total, rows, replace: req.query.replace === '1',
    });
    res.json({ upload: info, ...(await portfolio(req.userId)) });
  });

  // Fija (o borra, con price vacío) el precio actual de una posición.
  api.put('/prices/:isin', async (req, res) => {
    const price = parsePrice(req.body?.price);
    const at = await db.setPrices(req.userId, { [req.params.isin]: price });
    if (price) await db.setValuation(req.userId, req.params.isin, at.slice(0, 10), price);
    res.json({ isin: req.params.isin, price, at: price ? at : null, source: price ? 'manual' : null });
  });

  // Actualiza con cotización en vivo las posiciones abiertas que cotizan (no Private
  // Markets) y que no tienen un precio fijado a mano.
  api.post('/quotes/refresh', async (req, res) => {
    if (!quotes) return res.status(503).json({ error: 'Las cotizaciones en vivo están desactivadas.' });
    const before = await portfolio(req.userId);
    const targets = before.positions.filter((p) => p.open && p.grp === 'ac' && p.priceSource !== 'manual');
    const { quotes: found, resolved, failed } = await quotes.quoteIsins(targets.map((p) => p.isin), await db.getSymbols());
    await db.saveSymbols(resolved);
    const at = await db.setLivePrices(req.userId, found);
    const names = Object.fromEntries(targets.map((p) => [p.isin, p.name]));
    res.json({
      ...(await portfolio(req.userId)),
      refresh: {
        at, updated: Object.keys(found).length,
        // Solo cuentan como fallo los que tienen ISIN cotizable (no cripto, etc.).
        failed: failed.map((isin) => names[isin]),
      },
    });
  });

  // Valor diario de la cartera, índice de rentabilidad e índices de referencia.
  // La primera vez descarga el histórico de cada valor y puede tardar medio minuto.
  api.get('/history', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const [rows, prices, valuations] = await Promise.all([db.getRows(req.userId), db.getPrices(req.userId), db.getValuations(req.userId)]);
    res.json({ history: await history.build({ positions: buildPortfolio(rows).positions, prices, valuations }) });
  });

  // Previsión de dividendos de los próximos 12 meses.
  api.get('/dividends/forecast', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const rows = await db.getRows(req.userId);
    res.json({ forecast: await history.dividends(buildPortfolio(rows).positions) });
  });

  // Cierres en euros de un valor desde una fecha, para la ficha.
  api.get('/assets/:isin/history', async (req, res) => {
    if (!history) return res.status(503).json({ error: 'El histórico está desactivado.' });
    const from = isDate(req.query.from) ? req.query.from : '2000-01-01';
    res.json({ asset: await history.asset(req.params.isin, from) });
  });

  // Valoraciones con fecha de lo que no cotiza.
  api.get('/valuations', async (req, res) => res.json({ valuations: await db.getValuations(req.userId) }));
  api.put('/valuations/:isin/:d', async (req, res) => {
    const price = parsePrice(req.body?.price);
    if (!isDate(req.params.d) || !price) return res.status(400).json({ error: 'Fecha o precio no válidos.' });
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
      Object.entries(req.body?.prices ?? {}).map(([k, v]) => [k, parsePrice(v)]).filter(([, v]) => v),
    );
    await db.setPrices(req.userId, valid);
    res.json({ updated: Object.keys(valid).length });
  });

  api.delete('/data', async (req, res) => {
    await db.clearUserData(req.userId);
    res.json(await portfolio(req.userId));
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // En producción sirve el front compilado (front/dist).
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'front', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    if (err instanceof CsvError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Archivo no válido: ${err.message}` });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
