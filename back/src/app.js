import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CsvError } from './engine.js';
import { BackupError } from './backup.js';
import { createAlertWatcher } from './alerts.js';
import { sessions, AuthError } from './auth.js';
import { createHistory } from './history.js';
import { timing, instrument } from './timing.js';
import { createStream } from './stream.js';
import { Invalid, isAssetId, isDate } from './lib/validate.js';
import { createPortfolio } from './services/portfolio.js';
import { createDigest } from './digest.js';
import sessionRoutes from './routes/session.js';
import portfolioRoutes from './routes/portfolio.js';
import transactionRoutes from './routes/transactions.js';
import historyRoutes from './routes/history.js';
import accountRoutes from './routes/account.js';

// Política de contenido: solo código propio y lo que necesita el botón de acceso de Google.
const CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
    frameSrc: ['https://accounts.google.com/gsi/'],
    connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
    fontSrc: ["'self'", 'data:'],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
};

/**
 * Monta la aplicación: seguridad, sesión y las rutas de cada dominio (routes/).
 * @param db            repositorio de db.js
 * @param verifyGoogle  (credential) => perfil; null si no hay GOOGLE_CLIENT_ID
 * @param quotes        servicio de quotes.js (o null para desactivar las cotizaciones en vivo)
 * @param push   servicio de push.js (o null: sin avisos con la app cerrada)
 * @param csp    false desactiva la política de contenido (CSP=0)
 * @param log    registro (log.js); por defecto la consola
 * @param rateLimits false quita los límites de peticiones por IP (RATE_LIMIT=0, solo para pruebas)
 */
export function createApp({ db: rawDb, verifyGoogle, googleClientId, sessionSecret, quotes: rawQuotes = null, logos = null, push = null, trustProxy = false, csp = true, slowMs = 1000, historyWaitMs = 1500, demo = true, rateLimits = true, log = console }) {
  const app = express();
  // Todo acceso a la base de datos y a los proveedores de precios se mide (Server-Timing).
  const db = instrument(rawDb, 'db');
  const quotes = instrument(rawQuotes, 'ext', ['quoteIsins', 'resolveIsins', 'history', 'nameOf']);
  const session = sessions(sessionSecret);
  const history = quotes?.history ? createHistory({ db, quotes }) : null;
  const watcher = createAlertWatcher({ db, quotes, push, log });
  app.locals.watcher = watcher;
  if (trustProxy) app.set('trust proxy', 1);
  // Cabeceras de seguridad, con la política de ventanas que necesita la ventana emergente de Google.
  // Cada petición lleva un identificador: sale en la respuesta y en el registro de los errores.
  app.use((req, res, next) => { req.id = crypto.randomUUID().slice(0, 8); res.set('X-Request-Id', req.id); next(); });
  app.use(timing({ slowMs, log }));
  app.use(helmet({ contentSecurityPolicy: csp ? CSP : false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
  // Sin comprimir el canal de cotizaciones: el compresor retendría los eventos.
  app.use(compression({ filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res) }));
  // rateLimits=false (RATE_LIMIT=0) solo para pruebas de carga o de extremo a extremo.
  const limit = (windowMs, max) => (!rateLimits ? (_req, _res, next) => next() : rateLimit({
    windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.' },
  }));
  app.use('/api', limit(60_000, 600));
  app.use('/api/auth', limit(15 * 60_000, 30));
  app.use('/api/upload', limit(60 * 60_000, 40));
  app.use('/api/import', limit(60 * 60_000, 20));
  // Salud: responde 503 si la base de datos no contesta o si el servidor se está apagando
  // (app.locals.closing), para que el proxy deje de enviarle peticiones.
  app.get('/api/health', async (_req, res) => {
    if (app.locals.closing) return res.status(503).json({ ok: false, closing: true });
    const ok = await Promise.race([
      rawDb.ping().then(() => true, () => false),
      new Promise((r) => { setTimeout(r, 3000, false).unref?.(); }),
    ]);
    res.status(ok ? 200 : 503).json({ ok });
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const pf = createPortfolio({ db, quotes, history, watcher });
  const { quoteUsers } = pf;

  // Canal de cotizaciones: el servidor cotiza para todos los conectados y envía a cada uno lo suyo.
  const stream = quotes ? createStream({
    log,
    refresh: async (ids) => {
      const out = new Map();
      for (const [id, r] of await quoteUsers(ids)) {
        const alerts = r.fired.length ? (await db.getAlerts(id)) : undefined;
        out.set(id, { at: r.at, prices: r.prices, updated: r.updated, failed: r.failed, fired: r.fired, alerts });
      }
      return out;
    },
  }) : null;
  app.locals.stream = stream;

  // ---------- todo lo demás requiere sesión ----------
  const api = express.Router();
  api.use(async (req, res, next) => {
    const user = await session.user(req, db);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    req.userId = user.id;
    // Tras cualquier cambio en sus operaciones, las demás pestañas del usuario se enteran.
    if (stream && req.method !== 'GET') {
      const v = db.rowsVersion?.(user.id);
      res.on('finish', () => {
        const now = db.rowsVersion?.(user.id);
        if (res.statusCode < 400 && now !== v) stream.changed(user.id, { v: now });
      });
    }
    next();
  });

  // Parámetros de ruta: se comprueban una vez para todas las rutas que los usan.
  api.param('isin', (req, res, next, v) => (isAssetId(v) ? next() : res.status(400).json({ error: 'Activo no válido.' })));
  api.param('d', (req, res, next, v) => (isDate(v) ? next() : res.status(400).json({ error: 'Fecha no válida.' })));
  api.param('tid', (req, res, next, v) => (v.length <= 200 ? next() : res.status(400).json({ error: 'Operación no válida.' })));

  // Resumen semanal o mensual por aviso push (index.js lo pone en marcha).
  const digest = createDigest({ db, quotes, history, push, pf, log });
  app.locals.digest = digest;
  const ctx = { db, quotes, history, logos, push, stream, pf, historyWaitMs, log, digest };
  portfolioRoutes(api, ctx);
  transactionRoutes(api, ctx);
  const hist = historyRoutes(api, ctx);
  accountRoutes(api, ctx);

  // Las rutas de sesión van antes que el router: no exigen estar dentro.
  const forget = (userId) => { pf.forget(userId); hist.forget(userId); };
  app.locals.cleanDemo = sessionRoutes(app, { db, session, verifyGoogle, googleClientId, push, demo, forget, stream }).cleanDemo;

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // En producción sirve el front compilado (front/dist).
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'front', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    if (err instanceof CsvError || err instanceof BackupError || err instanceof Invalid) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Archivo no válido: ${err.message}` });
    log.error('Error sin tratar', { id: req.id, method: req.method, path: req.originalUrl.split('?')[0], user: req.userId ?? null }, err);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Error interno del servidor.', id: req.id });
  });

  return app;
}
