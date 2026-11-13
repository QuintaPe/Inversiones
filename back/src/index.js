import crypto from 'node:crypto';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { googleVerifier } from './auth.js';
import { createQuotes } from './quotes.js';
import { createLogos } from './logos.js';
import { createPush } from './push.js';
import { createLog } from './log.js';

const log = createLog();

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const { GOOGLE_CLIENT_ID, NODE_ENV } = process.env;

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (NODE_ENV === 'production') {
    log.error('Falta SESSION_SECRET. Genera uno con: openssl rand -hex 32');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  log.warn('Aviso: SESSION_SECRET no definido; las sesiones se pierden al reiniciar el servidor.');
}
if (!GOOGLE_CLIENT_ID) log.warn('Aviso: GOOGLE_CLIENT_ID no definido; no se podrá iniciar sesión (ver back/.env.example).');

const db = await openDb();
log.info(`Base de datos: ${db.url.startsWith('file:') ? `${db.url} (local; define TURSO_DATABASE_URL para usar Turso)` : db.url}`);

const quotes = process.env.LIVE_QUOTES === '0' ? null : createQuotes();
const push = process.env.PUSH === '0' ? null : await createPush({ db }).catch((err) => { log.warn(`Aviso: sin avisos push (${err.message}).`); return null; });

const app = createApp({
  db,
  googleClientId: GOOGLE_CLIENT_ID,
  verifyGoogle: GOOGLE_CLIENT_ID ? googleVerifier(GOOGLE_CLIENT_ID) : null,
  sessionSecret,
  quotes,
  push,
  csp: process.env.CSP !== '0',
  logos: process.env.LOGOS === '0' ? null : createLogos({ db }),
  trustProxy: process.env.TRUST_PROXY === '1',
  slowMs: Number(process.env.SLOW_MS ?? 1000),
  demo: process.env.DEMO !== '0',
  rateLimits: process.env.RATE_LIMIT !== '0',
  log,
});
const server = app.listen(PORT, HOST, () => log.info(`API en http://${HOST}:${PORT}`));

// Vigilante de alertas: cotiza los valores con alertas pendientes aunque nadie tenga la app abierta.
const sweepMin = Number(process.env.ALERT_SWEEP_MIN ?? 5);
const stops = [];
if (quotes && sweepMin > 0) stops.push(app.locals.watcher.start(sweepMin));

// Cotizaciones para las pestañas abiertas: una sola consulta por valor para todos los usuarios.
const streamSec = Number(process.env.QUOTE_STREAM_SEC ?? 60);
if (app.locals.stream && streamSec > 0) stops.push(app.locals.stream.start(streamSec));

// Las cuentas de la cartera de ejemplo se borran solas pasada una semana.
const cleanDemo = () => app.locals.cleanDemo().then((n) => n && log.info(`Borradas ${n} carteras de ejemplo.`)).catch((err) => log.error('Ejemplo:', err.message));
cleanDemo();
const demoTimer = setInterval(cleanDemo, 6 * 3600_000);
demoTimer.unref();

// Apagado ordenado (despliegues, Ctrl+C): se deja de aceptar tráfico, se cierran los canales de
// cotizaciones para que las pestañas reconecten con el servidor nuevo, se espera a las
// peticiones en curso y se cierra la base de datos. Si algo se queda colgado, se sale igual.
const SHUTDOWN_MS = Number(process.env.SHUTDOWN_MS ?? 10_000);
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.locals.closing = true; // /api/health pasa a 503
  log.info(`${signal}: apagando…`);
  const force = setTimeout(() => { log.warn('Apagado forzado: quedaban peticiones en curso.'); process.exit(1); }, SHUTDOWN_MS);
  force.unref();
  for (const stop of stops) stop();
  clearInterval(demoTimer);
  app.locals.stream?.close();
  await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections?.(); });
  try { await db.close(); } catch (err) { log.warn('Al cerrar la base de datos:', err); }
  log.info('Apagado.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Un fallo fuera de una petición no debe pasar en silencio ni dejar el proceso a medias.
process.on('unhandledRejection', (err) => log.error('Promesa rechazada sin tratar', err instanceof Error ? err : new Error(String(err))));
process.on('uncaughtException', (err) => { log.error('Excepción sin tratar', err); shutdown('uncaughtException').finally(() => process.exit(1)); });
