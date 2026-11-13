import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CsvError } from './engine.js';
import { createAlertWatcher } from './alerts.js';
import { sessions, AuthError } from './auth.js';
import { createHistory } from './history.js';
import { timing, instrument } from './timing.js';
import { createStream } from './stream.js';
import { createPortfolio } from './services/portfolio.js';
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
 * @param rateLimits false quita los límites de peticiones por IP (RATE_LIMIT=0, solo para pruebas)
 */
export function createApp({ db: rawDb, verifyGoogle, googleClientId, sessionSecret, quotes: rawQuotes = null, logos = null, push = null, trustProxy = false, csp = true, slowMs = 1000, historyWaitMs = 1500, demo = true, rateLimits = true }) {
  const app = express();
  // Todo acceso a la base de datos y a los proveedores de precios se mide (Server-Timing).
  const db = instrument(rawDb, 'db');
  const quotes = instrument(rawQuotes, 'ext', ['quoteIsins', 'resolveIsins', 'history']);
  const session = sessions(sessionSecret);
  const history = quotes?.history ? createHistory({ db, quotes }) : null;
  const watcher = createAlertWatcher({ db, quotes, push });
  app.locals.watcher = watcher;
  if (trustProxy) app.set('trust proxy', 1);
  // Cabeceras de seguridad, con la política de ventanas que necesita la ventana emergente de Google.
  app.use(timing({ slowMs }));
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
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const pf = createPortfolio({ db, quotes, history, watcher });
  const { quoteUsers } = pf;

  // Canal de cotizaciones: el servidor cotiza para todos los conectados y envía a cada uno lo suyo.
  const stream = quotes ? createStream({
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
    const id = session.read(req);
    const user = id && (await db.getUser(id));
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

  const ctx = { db, quotes, history, logos, push, stream, pf, historyWaitMs };
  portfolioRoutes(api, ctx);
  transactionRoutes(api, ctx);
  const hist = historyRoutes(api, ctx);
  accountRoutes(api, ctx);

  // Las rutas de sesión van antes que el router: no exigen estar dentro.
  const forget = (userId) => { pf.forget(userId); hist.forget(userId); };
  app.locals.cleanDemo = sessionRoutes(app, { db, session, verifyGoogle, googleClientId, push, demo, forget }).cleanDemo;

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
