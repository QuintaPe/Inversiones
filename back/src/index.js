import crypto from 'node:crypto';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { googleVerifier } from './auth.js';
import { createQuotes } from './quotes.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const { GOOGLE_CLIENT_ID, NODE_ENV } = process.env;

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (NODE_ENV === 'production') {
    console.error('Falta SESSION_SECRET. Genera uno con: openssl rand -hex 32');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('Aviso: SESSION_SECRET no definido; las sesiones se pierden al reiniciar el servidor.');
}
if (!GOOGLE_CLIENT_ID) console.warn('Aviso: GOOGLE_CLIENT_ID no definido; no se podrá iniciar sesión (ver back/.env.example).');

const db = await openDb();
console.log(`Base de datos: ${db.url.startsWith('file:') ? `${db.url} (local; define TURSO_DATABASE_URL para usar Turso)` : db.url}`);

createApp({
  db,
  googleClientId: GOOGLE_CLIENT_ID,
  verifyGoogle: GOOGLE_CLIENT_ID ? googleVerifier(GOOGLE_CLIENT_ID) : null,
  sessionSecret,
  quotes: process.env.LIVE_QUOTES === '0' ? null : createQuotes(),
  trustProxy: process.env.TRUST_PROXY === '1',
}).listen(PORT, HOST, () => console.log(`API en http://${HOST}:${PORT}`));
