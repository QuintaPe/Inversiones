import crypto from 'node:crypto';
// Acceso a Turso (libSQL). Sin TURSO_DATABASE_URL usa un fichero SQLite local,
// para poder desarrollar sin tocar la base de datos remota.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Columnas de cada operación: las del CSV de Trade Republic que describen una inversión,
// más la cuenta, la divisa y, en los pagos, el comercio o la otra parte (name) y la categoría
// del comercio (mcc_code). El IBAN y la referencia de las transferencias no se guardan nunca.
export const ROW_COLS = [
  'transaction_id', 'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description',
  'original_amount', 'original_currency', 'fx_rate', 'account_type', 'currency', 'mcc_code',
];
const V1_COLS = ROW_COLS.slice(0, 17);

export const HISTORY_V = 2; // 2 = incluye los splits
const SYMBOL_V = 4; // 4 = valor liquidativo de los fondos no cotizados // 2 = incluye sector e industria; 3 = segunda fuente para los ISIN que Yahoo no encuentra
const RETRY_UNKNOWN_MS = 7 * 86400000; // un ISIN sin símbolo se reintenta a la semana

// ---------------------------------------------------------------------------------
// Migraciones numeradas. Cada una se aplica una sola vez y queda anotada en
// schema_migrations; nunca se edita una ya publicada: se añade otra detrás.
// ---------------------------------------------------------------------------------
const addColumn = async (c, sql) => {
  try { await c.execute(sql); } catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
};
const hasTable = async (c, name) =>
  (await c.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] })).rows.length > 0;

const MIGRATIONS = [
  {
    v: 1,
    name: 'esquema inicial',
    // Idempotente: también adopta las bases de datos creadas antes de numerar las migraciones.
    async up(c) {
      await c.batch([
        `CREATE TABLE IF NOT EXISTS users (
           id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT,
           created_at TEXT NOT NULL, last_login TEXT NOT NULL)`,
        // Los importes se guardan tal cual vienen en el CSV (texto decimal exacto): las acciones
        // traen diez decimales y pasarlas a número de coma flotante perdería precisión.
        `CREATE TABLE IF NOT EXISTS transactions (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           ${V1_COLS.map((x) => `${x} TEXT NOT NULL DEFAULT ''`).join(', ')},
           PRIMARY KEY (user_id, transaction_id))`,
        `CREATE TABLE IF NOT EXISTS prices (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, price REAL NOT NULL, updated_at TEXT NOT NULL,
           PRIMARY KEY (user_id, isin))`,
        // Caché global ISIN → símbolo de cotización (symbol NULL = no encontrado).
        `CREATE TABLE IF NOT EXISTS symbols (
           isin TEXT PRIMARY KEY, symbol TEXT, exchange TEXT, resolved_at TEXT NOT NULL)`,
        // Histórico diario de cierres (global, por símbolo y en su divisa) y su estado.
        `CREATE TABLE IF NOT EXISTS price_history (
           symbol TEXT NOT NULL, d TEXT NOT NULL, c REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
        `CREATE TABLE IF NOT EXISTS history_meta (
           symbol TEXT PRIMARY KEY, currency TEXT NOT NULL, from_d TEXT NOT NULL, last_d TEXT, fetched_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS symbol_divs (
           symbol TEXT NOT NULL, d TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
        // Splits por símbolo: ratio = acciones nuevas por cada acción antigua.
        `CREATE TABLE IF NOT EXISTS symbol_splits (
           symbol TEXT NOT NULL, d TEXT NOT NULL, ratio REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
        // Valoraciones con fecha que anota el usuario para lo que no cotiza (Private Markets…).
        `CREATE TABLE IF NOT EXISTS valuations (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, d TEXT NOT NULL, price REAL NOT NULL, PRIMARY KEY (user_id, isin, d))`,
        `CREATE TABLE IF NOT EXISTS alerts (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, dir TEXT NOT NULL, price REAL NOT NULL, created_at TEXT NOT NULL, triggered_at TEXT)`,
        `CREATE TABLE IF NOT EXISTS targets (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY (user_id, isin))`,
        // Logotipos por ISIN (data NULL = no hay; se reintenta pasado un mes).
        'CREATE TABLE IF NOT EXISTS logos (isin TEXT PRIMARY KEY, type TEXT, data BLOB, fetched_at TEXT NOT NULL)',
        `CREATE TABLE IF NOT EXISTS removed (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           transaction_id TEXT NOT NULL, row TEXT NOT NULL, removed_at TEXT NOT NULL,
           PRIMARY KEY (user_id, transaction_id))`,
      ], 'write');
      if (!(await hasTable(c, 'imports'))) {
        await c.execute(`CREATE TABLE IF NOT EXISTS uploads (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name TEXT NOT NULL, uploaded_at TEXT NOT NULL,
           total INTEGER NOT NULL, relevant INTEGER NOT NULL, added INTEGER NOT NULL)`);
      }
      await addColumn(c, "ALTER TABLE prices ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
      await addColumn(c, 'ALTER TABLE prices ADD COLUMN info TEXT');
      await addColumn(c, 'ALTER TABLE symbols ADD COLUMN sector TEXT');
      await addColumn(c, 'ALTER TABLE symbols ADD COLUMN industry TEXT');
      await addColumn(c, 'ALTER TABLE symbols ADD COLUMN v INTEGER NOT NULL DEFAULT 1');
      await addColumn(c, 'ALTER TABLE history_meta ADD COLUMN v INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    v: 2,
    name: 'operaciones completas, borrado lógico, importaciones, cotizaciones globales y avisos',
    async up(c) {
      // Operaciones: cuenta y divisa del CSV, origen, importación de la que salen y borrado lógico.
      await addColumn(c, "ALTER TABLE transactions ADD COLUMN account_type TEXT NOT NULL DEFAULT ''");
      await addColumn(c, "ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT ''");
      await addColumn(c, "ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'csv'");
      await addColumn(c, 'ALTER TABLE transactions ADD COLUMN import_id INTEGER');
      await addColumn(c, 'ALTER TABLE transactions ADD COLUMN deleted_at TEXT');
      await c.execute("UPDATE transactions SET source = 'manual' WHERE transaction_id LIKE 'manual-%'");

      // Las operaciones quitadas vivían en otra tabla como JSON: vuelven a la suya, marcadas.
      if (await hasTable(c, 'removed')) {
        const gone = (await c.execute('SELECT user_id, row, removed_at FROM removed')).rows;
        const stmts = gone.map((g) => {
          const row = JSON.parse(g.row);
          return {
            sql: `INSERT OR REPLACE INTO transactions (user_id, ${V1_COLS.join(', ')}, source, deleted_at)
                  VALUES (?, ${V1_COLS.map(() => '?').join(', ')}, 'csv', ?)`,
            args: [g.user_id, ...V1_COLS.map((k) => row[k] ?? ''), g.removed_at],
          };
        });
        await c.batch([...stmts, 'DROP TABLE removed'], 'write');
      }

      // Importaciones: cada archivo subido, con su huella.
      if (await hasTable(c, 'uploads')) await c.execute('ALTER TABLE uploads RENAME TO imports');
      await addColumn(c, 'ALTER TABLE imports ADD COLUMN sha256 TEXT');

      // Cotizaciones en vivo: una por valor para todos los usuarios. En `prices` solo
      // quedan los precios que cada usuario fija a mano.
      await c.batch([
        `CREATE TABLE IF NOT EXISTS quotes (
           isin TEXT PRIMARY KEY, price REAL NOT NULL, info TEXT, updated_at TEXT NOT NULL)`,
        `INSERT OR REPLACE INTO quotes (isin, price, info, updated_at)
           SELECT isin, price, info, max(updated_at) FROM prices WHERE source = 'live' GROUP BY isin`,
        "DELETE FROM prices WHERE source = 'live'",
        // Avisos al móvil o al navegador (Web Push) y ajustes del servidor (claves VAPID…).
        `CREATE TABLE IF NOT EXISTS push_subscriptions (
           endpoint TEXT PRIMARY KEY,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)`,
        'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        'CREATE INDEX IF NOT EXISTS alerts_pending ON alerts (user_id) WHERE triggered_at IS NULL',
        'CREATE INDEX IF NOT EXISTS imports_user ON imports (user_id, id)',
      ], 'write');
    },
  },
  {
    v: 3,
    name: 'histórico calculado de cada usuario',
    async up(c) {
      // Serie diaria ya reconstruida: sobrevive a los reinicios y se enseña al instante
      // mientras se calcula la nueva. k = huella de todo lo que la determina.
      await c.execute(`CREATE TABLE IF NOT EXISTS history_cache (
         user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         k TEXT NOT NULL, value TEXT NOT NULL, built_at TEXT NOT NULL)`);
    },
  },
  {
    v: 4,
    name: 'comercio y categoría de los pagos',
    async up(c) {
      // Código de categoría del comercio (MCC) de cada pago con tarjeta, y la categoría que el
      // usuario elige para un comercio (se aplica a todos sus pagos, pasados y futuros).
      await addColumn(c, "ALTER TABLE transactions ADD COLUMN mcc_code TEXT NOT NULL DEFAULT ''");
      await c.execute(`CREATE TABLE IF NOT EXISTS merchant_categories (
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         merchant TEXT NOT NULL, category TEXT NOT NULL,
         PRIMARY KEY (user_id, merchant))`);
    },
  },
  {
    v: 5,
    name: 'versión de sesión de cada usuario',
    async up(c) {
      // Las cookies de sesión llevan este número: al subirlo dejan de valer todas las anteriores
      // («cerrar sesión en los demás dispositivos»).
      await addColumn(c, 'ALTER TABLE users ADD COLUMN session_v INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    v: 6,
    name: 'topes de gasto al mes',
    async up(c) {
      // Tope mensual por categoría de gasto ('total' = todo el gasto del mes).
      await c.execute(`CREATE TABLE IF NOT EXISTS budgets (
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         category TEXT NOT NULL, amount REAL NOT NULL,
         PRIMARY KEY (user_id, category))`);
    },
  },
  {
    v: 7,
    name: 'valores en seguimiento y notas de cada activo',
    async up(c) {
      await c.batch([
        // Valores que el usuario sigue sin tenerlos en cartera.
        `CREATE TABLE IF NOT EXISTS watchlist (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, name TEXT NOT NULL, added_at TEXT NOT NULL,
           PRIMARY KEY (user_id, isin))`,
        // Nota libre por activo (por qué lo compré, qué vigilar).
        `CREATE TABLE IF NOT EXISTS asset_notes (
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           isin TEXT NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL,
           PRIMARY KEY (user_id, isin))`,
      ], 'write');
    },
  },
  {
    v: 8,
    name: 'patrimonio: otras cuentas, bienes y deudas con sus saldos fechados',
    async up(c) {
      await c.batch([
        // Lo que el usuario tiene (o debe) fuera de la cartera: kind = cash | deposit | property | other | debt.
        `CREATE TABLE IF NOT EXISTS accounts (
           id TEXT PRIMARY KEY,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL)`,
        'CREATE INDEX IF NOT EXISTS accounts_user ON accounts (user_id)',
        // Saldo anotado a mano en una fecha; siempre positivo (en una deuda, lo que se debe).
        `CREATE TABLE IF NOT EXISTS account_balances (
           account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
           user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           d TEXT NOT NULL, amount REAL NOT NULL,
           PRIMARY KEY (account_id, d))`,
        'CREATE INDEX IF NOT EXISTS account_balances_user ON account_balances (user_id)',
      ], 'write');
    },
  },
  {
    v: 9,
    name: 'ajustes del usuario (plan de la proyección…)',
    async up(c) {
      // Un valor JSON por clave; qué claves hay y qué forma tienen lo decide lib/settings.js.
      await c.execute(`CREATE TABLE IF NOT EXISTS user_settings (
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
         PRIMARY KEY (user_id, key))`);
    },
  },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1).v;

async function migrate(client) {
  await client.execute('CREATE TABLE IF NOT EXISTS schema_migrations (v INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set((await client.execute('SELECT v FROM schema_migrations')).rows.map((r) => Number(r.v)));
  for (const m of MIGRATIONS) {
    if (done.has(m.v)) continue;
    await m.up(client);
    await client.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (v, name, applied_at) VALUES (?, ?, ?)', args: [m.v, m.name, new Date().toISOString()] });
  }
}

/**
 * @param replica  ruta de un fichero local para usar Turso como réplica embebida: las
 *                 lecturas se hacen en local (sin viaje de red) y las escrituras van a
 *                 Turso, que devuelve los cambios a la réplica.
 * @param cache    cachés en memoria (usuarios, operaciones, símbolos y splits). Suponen
 *                 un solo proceso escribiendo; DB_CACHE=0 las desactiva.
 * @param wrap     (cliente) => cliente; para los benchmarks (simular la latencia de red)
 */
export async function openDb({
  url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN,
  replica = process.env.TURSO_REPLICA, syncSeconds = Number(process.env.TURSO_SYNC_SEC ?? 60),
  cache = process.env.DB_CACHE !== '0', wrap = (c) => c,
} = {}) {
  const dataDir = () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  let client, label = url;
  if (!url) {
    label = url = `file:${path.join(dataDir(), 'local.db')}`;
    client = createClient({ url });
  } else if (replica && !url.startsWith('file:') && url !== ':memory:') {
    const file = path.isAbsolute(replica) ? replica : path.join(dataDir(), replica);
    client = readsOneByOne(createClient({ url: `file:${file}`, syncUrl: url, authToken, syncInterval: syncSeconds > 0 ? syncSeconds : undefined }));
    await client.sync();
    label = `${url} (réplica local en ${file})`;
  } else {
    client = createClient({ url, authToken });
  }
  client = wrap(client);
  await migrate(client);
  return makeRepo(client, label, { cache });
}

/**
 * En una réplica embebida, un lote abre una transacción que se resuelve contra Turso (~1,3 s
 * medidos), mientras que cada consulta suelta se lee del fichero local (~1 ms). Los lotes de
 * lectura se hacen, pues, consulta a consulta; los de escritura siguen siendo un lote (atómicos,
 * y van a Turso igualmente).
 */
export function readsOneByOne(client) {
  const batch = client.batch.bind(client);
  client.batch = async (stmts, mode) => {
    if (mode !== 'read') return batch(stmts, mode);
    const out = [];
    for (const st of stmts) out.push(await client.execute(st));
    return out;
  };
  return client;
}

/** Caché con caducidad y tamaño máximo (los más antiguos salen primero). */
function ttlCache(ttlMs, max = 500) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (Date.now() - e.at > ttlMs) { m.delete(k); return undefined; }
      return e.v;
    },
    set(k, v) {
      m.delete(k);
      m.set(k, { v, at: Date.now() });
      if (m.size > max) m.delete(m.keys().next().value);
      return v;
    },
    delete: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function makeRepo(client, url, { cache = true } = {}) {
  const now = () => new Date().toISOString();
  // Cachés en memoria. Las de usuario se invalidan en cada escritura de ese usuario; las
  // globales (símbolos, splits) también caducan solas por si escribe otro proceso.
  const off = !cache;
  const users = ttlCache(off ? -1 : 60_000, 1000);
  const rowsCache = ttlCache(off ? -1 : 30 * 60_000, 200);
  const globals = ttlCache(off ? -1 : 5 * 60_000, 10);
  // Versión de las operaciones de cada usuario y de los splits: sirven de clave de caché
  // para lo que se calcula a partir de ellas (posiciones, histórico).
  let seq = 0;
  const rowsVer = new Map();
  let splitsVer = 0;
  /** { clave: valor } con los ajustes guardados del usuario. */
  async function getUserSettings(userId) {
    const r = await client.execute({ sql: 'SELECT key, value FROM user_settings WHERE user_id = ?', args: [userId] });
    const out = {};
    for (const x of r.rows) {
      if (x.key.startsWith('_')) continue; // estado interno del servidor (p. ej. último resumen enviado)
      try { out[x.key] = JSON.parse(x.value); } catch { /* valor ilegible: como si no estuviera */ }
    }
    return out;
  }
  const touchRows = (userId) => { rowsCache.delete(userId); rowsVer.set(userId, ++seq); };
  return {
    url,
    cached: cache,
    close: () => client.close(),
    /** Comprueba que la base de datos responde. */
    ping: () => client.execute('SELECT 1'),
    /** Número que cambia cada vez que cambian las operaciones del usuario. */
    rowsVersion: (userId) => rowsVer.get(userId) ?? 0,
    /** Número que cambia cada vez que se descubren splits nuevos. */
    splitsVersion: () => splitsVer,

    async upsertUser({ id, email, name, picture }) {
      const t = now();
      await client.execute({
        sql: `INSERT INTO users (id, email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
                picture = excluded.picture, last_login = excluded.last_login`,
        args: [id, email, name ?? null, picture ?? null, t, t],
      });
      users.delete(id);
    },

    async getUser(id) {
      const hit = users.get(id);
      if (hit !== undefined) return hit && { ...hit };
      const r = await client.execute({ sql: 'SELECT id, email, name, picture, session_v FROM users WHERE id = ?', args: [id] });
      const user = r.rows[0] ? { ...r.rows[0] } : null;
      if (user) users.set(id, user);
      return user && { ...user };
    },

    /** Invalida todas las sesiones abiertas del usuario. Devuelve la versión nueva. */
    async bumpSession(id) {
      const r = await client.execute({ sql: 'UPDATE users SET session_v = session_v + 1 WHERE id = ? RETURNING session_v', args: [id] });
      users.delete(id);
      return r.rows[0]?.session_v ?? 0;
    },

    /** Operaciones vigentes. La lista se comparte entre llamadas: no se debe modificar. */
    async getRows(userId) {
      const hit = rowsCache.get(userId);
      if (hit) return hit;
      const ver = rowsVer.get(userId);
      const r = await client.execute({
        sql: `SELECT ${ROW_COLS.join(', ')} FROM transactions WHERE user_id = ? AND deleted_at IS NULL`,
        args: [userId],
      });
      const rows = Object.freeze(r.rows.map((x) => Object.freeze({ ...x })));
      // Si alguien escribió mientras se leía, esta lectura puede ser vieja: no se guarda.
      if (rowsVer.get(userId) === ver) rowsCache.set(userId, rows);
      return rows;
    },

    /** Qué pasaría al subir estas filas, sin guardar nada: { added, known, removed }. */
    async previewUpload(userId, rows) {
      const r = await client.execute({ sql: 'SELECT transaction_id, deleted_at FROM transactions WHERE user_id = ?', args: [userId] });
      const state = new Map(r.rows.map((x) => [x.transaction_id, x.deleted_at ? 'removed' : 'known']));
      const out = { added: 0, known: 0, removed: 0 };
      for (const row of rows) out[state.get(row.transaction_id) ?? 'added']++;
      return out;
    },

    /**
     * Inserta/actualiza filas del CSV en una sola transacción. Las que el usuario quitó
     * siguen quitadas. Devuelve cuántas eran nuevas.
     */
    async saveUpload(userId, { name, total, rows, replace, relevant, sha256 = null }) {
      const { added } = replace
        ? { added: rows.length - (await this.previewUpload(userId, rows)).removed }
        : await this.previewUpload(userId, rows);
      const info = { name, at: now(), total, relevant: relevant ?? rows.length, added };
      const ins = await client.execute({
        sql: 'INSERT INTO imports (user_id, name, uploaded_at, total, relevant, added, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [userId, info.name, info.at, total, info.relevant, added, sha256],
      });
      const importId = Number(ins.lastInsertRowid);
      const sql = `INSERT INTO transactions (user_id, ${ROW_COLS.join(', ')}, source, import_id)
                   VALUES (?, ${ROW_COLS.map(() => '?').join(', ')}, 'csv', ?)
                   ON CONFLICT(user_id, transaction_id) DO UPDATE SET
                     ${ROW_COLS.slice(1).map((k) => `${k} = excluded.${k}`).join(', ')}`;
      const stmts = [
        ...(replace ? [{ sql: 'DELETE FROM transactions WHERE user_id = ? AND deleted_at IS NULL', args: [userId] }] : []),
        ...rows.map((r) => ({ sql, args: [userId, ...ROW_COLS.map((k) => r[k] ?? ''), importId] })),
      ];
      try {
        await client.batch(stmts, 'write');
      } catch (err) {
        await client.execute({ sql: 'DELETE FROM imports WHERE id = ?', args: [importId] }).catch(() => {});
        throw err;
      } finally {
        touchRows(userId);
      }
      return info;
    },

    async getRow(userId, tid) {
      const r = await client.execute({ sql: `SELECT ${ROW_COLS.join(', ')} FROM transactions WHERE user_id = ? AND transaction_id = ? AND deleted_at IS NULL`, args: [userId, tid] });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },
    /** Guarda una operación introducida a mano. */
    async putRow(userId, row) {
      await client.execute({
        sql: `INSERT OR REPLACE INTO transactions (user_id, ${ROW_COLS.join(', ')}, source) VALUES (?, ${ROW_COLS.map(() => '?').join(', ')}, 'manual')`,
        args: [userId, ...ROW_COLS.map((k) => row[k] ?? '')],
      });
      touchRows(userId);
    },
    /** Quita una operación. Las del CSV se conservan marcadas para no reaparecer al resubirlo. */
    async removeRow(userId, row, remember) {
      await client.execute(remember
        ? { sql: 'UPDATE transactions SET deleted_at = ? WHERE user_id = ? AND transaction_id = ?', args: [now(), userId, row.transaction_id] }
        : { sql: 'DELETE FROM transactions WHERE user_id = ? AND transaction_id = ?', args: [userId, row.transaction_id] });
      touchRows(userId);
    },
    async getRemoved(userId) {
      const r = await client.execute({
        sql: `SELECT ${ROW_COLS.join(', ')}, deleted_at AS removed_at FROM transactions WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        args: [userId],
      });
      return r.rows.map((x) => ({ ...x }));
    },
    async restoreRow(userId, tid) {
      const r = await client.execute({
        sql: 'UPDATE transactions SET deleted_at = NULL WHERE user_id = ? AND transaction_id = ? AND deleted_at IS NOT NULL',
        args: [userId, tid],
      });
      touchRows(userId);
      return r.rowsAffected > 0;
    },

    async lastUpload(userId) {
      const r = await client.execute({
        sql: 'SELECT name, uploaded_at AS at, total, relevant, added FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        args: [userId],
      });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },
    async getImports(userId, limit = 20) {
      const r = await client.execute({
        sql: 'SELECT id, name, uploaded_at AS at, total, relevant, added FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT ?',
        args: [userId, limit],
      });
      return r.rows.map((x) => ({ ...x, id: Number(x.id) }));
    },

    /**
     * Precio de cada valor del usuario: el que fijó a mano o, si no, la cotización en vivo
     * (compartida entre usuarios). { ISIN: { price, at, source, info } }
     */
    async getPrices(userId) {
      const [live, manual] = await client.batch([
        {
          sql: `SELECT isin, price, updated_at, info FROM quotes
                WHERE isin IN (SELECT DISTINCT symbol FROM transactions WHERE user_id = ? AND deleted_at IS NULL)`,
          args: [userId],
        },
        { sql: 'SELECT isin, price, updated_at FROM prices WHERE user_id = ?', args: [userId] },
      ], 'read');
      const out = {};
      for (const x of live.rows) out[x.isin] = { price: x.price, at: x.updated_at, source: 'live', info: x.info ? JSON.parse(x.info) : null };
      for (const x of manual.rows) out[x.isin] = { price: x.price, at: x.updated_at, source: 'manual', info: null };
      return out;
    },
    /**
     * Todo lo que acompaña a las posiciones, en una sola ida y vuelta a la base de datos:
     * { prices, lastUpload, alerts, targets }.
     */
    async getUserState(userId) {
      const [live, manual, last, alerts, targets] = await client.batch([
        {
          sql: `SELECT isin, price, updated_at, info FROM quotes
                WHERE isin IN (SELECT DISTINCT symbol FROM transactions WHERE user_id = ? AND deleted_at IS NULL)`,
          args: [userId],
        },
        { sql: 'SELECT isin, price, updated_at FROM prices WHERE user_id = ?', args: [userId] },
        { sql: 'SELECT name, uploaded_at AS at, total, relevant, added FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT 1', args: [userId] },
        { sql: 'SELECT id, isin, dir, price, created_at, triggered_at FROM alerts WHERE user_id = ? ORDER BY id DESC', args: [userId] },
        { sql: 'SELECT isin, weight FROM targets WHERE user_id = ?', args: [userId] },
      ], 'read');
      const prices = {};
      for (const x of live.rows) prices[x.isin] = { price: x.price, at: x.updated_at, source: 'live', info: x.info ? JSON.parse(x.info) : null };
      for (const x of manual.rows) prices[x.isin] = { price: x.price, at: x.updated_at, source: 'manual', info: null };
      return {
        prices,
        lastUpload: last.rows[0] ? { ...last.rows[0] } : null,
        alerts: alerts.rows.map((x) => ({ ...x, id: Number(x.id) })),
        targets: Object.fromEntries(targets.rows.map((x) => [x.isin, x.weight])),
      };
    },
    async getManualPrices(userId) {
      const r = await client.execute({ sql: 'SELECT isin, price, updated_at FROM prices WHERE user_id = ?', args: [userId] });
      return r.rows.map((x) => ({ ...x }));
    },

    /** Precios escritos a mano. prices: { ISIN: número | null }; null borra el precio. */
    async setPrices(userId, prices) {
      const at = now();
      const stmts = Object.entries(prices).map(([isin, price]) =>
        price
          ? {
              sql: `INSERT INTO prices (user_id, isin, price, updated_at, source, info) VALUES (?, ?, ?, ?, 'manual', NULL)
                    ON CONFLICT(user_id, isin) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`,
              args: [userId, isin, price, at],
            }
          : { sql: 'DELETE FROM prices WHERE user_id = ? AND isin = ?', args: [userId, isin] },
      );
      if (stmts.length) await client.batch(stmts, 'write');
      return at;
    },

    /** Cotizaciones en vivo: { ISIN: { price, info } }. Son de todos; nunca tocan un precio manual. */
    async setLivePrices(quotes) {
      const at = now();
      const stmts = Object.entries(quotes).map(([isin, q]) => ({
        sql: `INSERT INTO quotes (isin, price, info, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(isin) DO UPDATE SET price = excluded.price, info = excluded.info, updated_at = excluded.updated_at`,
        args: [isin, q.price, JSON.stringify(q.info ?? null), at],
      }));
      if (stmts.length) await client.batch(stmts, 'write');
      return at;
    },
    /** Antigüedad de las cotizaciones guardadas: { ISIN: fecha ISO }. */
    async getQuoteTimes(isins) {
      const out = {};
      for (let i = 0; i < isins.length; i += 200) {
        const part = isins.slice(i, i + 200);
        const r = await client.execute({ sql: `SELECT isin, updated_at FROM quotes WHERE isin IN (${part.map(() => '?').join(',')})`, args: part });
        for (const x of r.rows) out[x.isin] = x.updated_at;
      }
      return out;
    },

    /** Símbolos ya resueltos: { ISIN: { symbol, exchange, sector, industry } | null }. Los ausentes hay que buscarlos. */
    async getSymbols() {
      const rows = globals.get('symbols')
        ?? globals.set('symbols', (await client.execute({ sql: 'SELECT isin, symbol, exchange, sector, industry, resolved_at FROM symbols WHERE v >= ?', args: [SYMBOL_V] })).rows);
      const out = {};
      for (const x of rows) {
        if (x.symbol) out[x.isin] = { symbol: x.symbol, exchange: x.exchange ?? '', sector: x.sector, industry: x.industry };
        else if (Date.now() - Date.parse(x.resolved_at) < RETRY_UNKNOWN_MS) out[x.isin] = null;
      }
      return out;
    },

    async saveSymbols(resolved) {
      const at = now();
      const stmts = Object.entries(resolved).map(([isin, s]) => ({
        sql: `INSERT INTO symbols (isin, symbol, exchange, sector, industry, resolved_at, v) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(isin) DO UPDATE SET symbol = excluded.symbol, exchange = excluded.exchange, sector = excluded.sector,
                industry = excluded.industry, resolved_at = excluded.resolved_at, v = excluded.v`,
        args: [isin, s?.symbol ?? null, s?.exchange ?? null, s?.sector ?? null, s?.industry ?? null, at, SYMBOL_V],
      }));
      if (stmts.length) await client.batch(stmts, 'write');
      globals.delete('symbols');
    },

    // ---------- alertas y objetivos ----------
    async getAlerts(userId) {
      const r = await client.execute({ sql: 'SELECT id, isin, dir, price, created_at, triggered_at FROM alerts WHERE user_id = ? ORDER BY id DESC', args: [userId] });
      return r.rows.map((x) => ({ ...x, id: Number(x.id) }));
    },
    async addAlert(userId, { isin, dir, price }) {
      await client.execute({ sql: 'INSERT INTO alerts (user_id, isin, dir, price, created_at) VALUES (?, ?, ?, ?, ?)', args: [userId, isin, dir, price, now()] });
    },
    async deleteAlert(userId, id) {
      await client.execute({ sql: 'DELETE FROM alerts WHERE user_id = ? AND id = ?', args: [userId, id] });
    },
    async triggerAlerts(userId, ids) {
      if (!ids.length) return;
      const at = now();
      await client.batch(ids.map((id) => ({ sql: 'UPDATE alerts SET triggered_at = ? WHERE user_id = ? AND id = ?', args: [at, userId, id] })), 'write');
    },
    /** Alertas sin saltar de todos los usuarios, para el vigilante del servidor. */
    async getPendingAlerts() {
      const r = await client.execute('SELECT id, user_id, isin, dir, price FROM alerts WHERE triggered_at IS NULL');
      return r.rows.map((x) => ({ ...x, id: Number(x.id) }));
    },
    /** Nombre con el que cada usuario conoce un valor: { ISIN: nombre }. */
    async getNames(isins) {
      const out = {};
      for (let i = 0; i < isins.length; i += 200) {
        const part = isins.slice(i, i + 200);
        const r = await client.execute({ sql: `SELECT symbol, max(name) AS name FROM transactions WHERE symbol IN (${part.map(() => '?').join(',')}) GROUP BY symbol`, args: part });
        for (const x of r.rows) out[x.symbol] = x.name;
      }
      return out;
    },

    // ---------- avisos (Web Push) y ajustes ----------
    async getSetting(key) {
      const r = await client.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
      return r.rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await client.execute({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, value] });
    },
    async addPushSub(userId, { endpoint, p256dh, auth }) {
      await client.execute({
        sql: `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
        args: [endpoint, userId, p256dh, auth, now()],
      });
    },
    async deletePushSub(endpoint, userId = null) {
      await client.execute(userId
        ? { sql: 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', args: [endpoint, userId] }
        : { sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [endpoint] });
    },
    async getPushSubs(userId) {
      const r = await client.execute({ sql: 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', args: [userId] });
      return r.rows.map((x) => ({ ...x }));
    },

    /** Copia completa de lo que el usuario ha subido o anotado. */
    async exportUser(userId) {
      const q = (sql) => client.execute({ sql, args: [userId] }).then((r) => r.rows.map((x) => ({ ...x })));
      const [transactions, prices, valuations, alerts, targets, imports, merchant_categories, budgets, watchlist, asset_notes] = await Promise.all([
        q(`SELECT ${ROW_COLS.join(', ')}, source, deleted_at FROM transactions WHERE user_id = ? ORDER BY datetime`),
        q('SELECT isin, price, updated_at FROM prices WHERE user_id = ?'),
        q('SELECT isin, d, price FROM valuations WHERE user_id = ? ORDER BY isin, d'),
        q('SELECT isin, dir, price, created_at, triggered_at FROM alerts WHERE user_id = ?'),
        q('SELECT isin, weight FROM targets WHERE user_id = ?'),
        q('SELECT name, uploaded_at, total, relevant, added, sha256 FROM imports WHERE user_id = ? ORDER BY id'),
        q('SELECT merchant, category FROM merchant_categories WHERE user_id = ? ORDER BY merchant'),
        q('SELECT category, amount FROM budgets WHERE user_id = ? ORDER BY category'),
        q('SELECT isin, name, added_at FROM watchlist WHERE user_id = ? ORDER BY isin'),
        q('SELECT isin, note FROM asset_notes WHERE user_id = ? ORDER BY isin'),
      ]);
      // Cada cuenta del patrimonio con sus saldos; el identificador no viaja (al restaurar se crea otro).
      const [acc, bal] = await Promise.all([
        q('SELECT id, name, kind, created_at FROM accounts WHERE user_id = ? ORDER BY created_at, id'),
        q('SELECT account_id, d, amount FROM account_balances WHERE user_id = ? ORDER BY d'),
      ]);
      const accounts = acc.map(({ id, ...a }) => ({ ...a, balances: bal.filter((b) => b.account_id === id).map((b) => ({ d: b.d, amount: b.amount })) }));
      const settings = Object.entries(await getUserSettings(userId)).map(([key, value]) => ({ key, value }));
      return { transactions, prices, valuations, alerts, targets, imports, merchant_categories, budgets, watchlist, asset_notes, accounts, settings };
    },

    // ---------- seguimiento y notas ----------
    /** Valores en seguimiento con su última cotización guardada (si la hay). */
    async getWatch(userId) {
      const r = await client.execute({
        sql: `SELECT w.isin, w.name, w.added_at, q.price, q.info, q.updated_at
              FROM watchlist w LEFT JOIN quotes q ON q.isin = w.isin WHERE w.user_id = ? ORDER BY w.name COLLATE NOCASE`,
        args: [userId],
      });
      return r.rows.map((x) => ({ isin: x.isin, name: x.name, added_at: x.added_at, price: x.price ?? null, priceAt: x.updated_at ?? null, info: x.info ? JSON.parse(x.info) : null }));
    },
    /** ISIN en seguimiento de varios usuarios, sin repetir. */
    async getWatchIsins(userIds) {
      if (!userIds.length) return [];
      const r = await client.execute({ sql: `SELECT DISTINCT isin FROM watchlist WHERE user_id IN (${userIds.map(() => '?').join(',')})`, args: userIds });
      return r.rows.map((x) => x.isin);
    },
    async addWatch(userId, { isin, name }) {
      await client.execute({ sql: 'INSERT INTO watchlist (user_id, isin, name, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, isin) DO UPDATE SET name = excluded.name', args: [userId, isin, name, now()] });
    },
    async deleteWatch(userId, isin) {
      await client.execute({ sql: 'DELETE FROM watchlist WHERE user_id = ? AND isin = ?', args: [userId, isin] });
    },
    /** { ISIN: nota }. */
    async getNotes(userId) {
      const r = await client.execute({ sql: 'SELECT isin, note FROM asset_notes WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.isin, x.note]));
    },
    /** Nota vacía la borra. */
    async setNote(userId, isin, note) {
      await client.execute(note
        ? { sql: 'INSERT INTO asset_notes (user_id, isin, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, isin) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at', args: [userId, isin, note, now()] }
        : { sql: 'DELETE FROM asset_notes WHERE user_id = ? AND isin = ?', args: [userId, isin] });
    },

    // ---------- topes de gasto al mes ----------
    /** { categoría: euros al mes }; 'total' es el tope de todo el gasto. */
    async getBudgets(userId) {
      const r = await client.execute({ sql: 'SELECT category, amount FROM budgets WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.category, x.amount]));
    },
    /** amount null quita el tope. */
    async setBudget(userId, category, amount) {
      await client.execute(amount
        ? { sql: 'INSERT INTO budgets (user_id, category, amount) VALUES (?, ?, ?) ON CONFLICT(user_id, category) DO UPDATE SET amount = excluded.amount', args: [userId, category, amount] }
        : { sql: 'DELETE FROM budgets WHERE user_id = ? AND category = ?', args: [userId, category] });
    },

    // ---------- categoría de cada comercio, elegida por el usuario ----------
    async getMerchantCategories(userId) {
      const r = await client.execute({ sql: 'SELECT merchant, category FROM merchant_categories WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.merchant, x.category]));
    },
    /** category null vuelve a la automática. */
    async setMerchantCategory(userId, merchant, category) {
      await client.execute(category
        ? { sql: 'INSERT INTO merchant_categories (user_id, merchant, category) VALUES (?, ?, ?) ON CONFLICT(user_id, merchant) DO UPDATE SET category = excluded.category', args: [userId, merchant, category] }
        : { sql: 'DELETE FROM merchant_categories WHERE user_id = ? AND merchant = ?', args: [userId, merchant] });
    },

    async getTargets(userId) {
      const r = await client.execute({ sql: 'SELECT isin, weight FROM targets WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.isin, x.weight]));
    },
    /** targets: { ISIN: peso % | null }; null lo quita. */
    async setTargets(userId, targets) {
      const stmts = Object.entries(targets).map(([isin, w]) => (w > 0
        ? { sql: 'INSERT INTO targets (user_id, isin, weight) VALUES (?, ?, ?) ON CONFLICT(user_id, isin) DO UPDATE SET weight = excluded.weight', args: [userId, isin, w] }
        : { sql: 'DELETE FROM targets WHERE user_id = ? AND isin = ?', args: [userId, isin] }));
      if (stmts.length) await client.batch(stmts, 'write');
    },

    // ---------- logotipos ----------
    /** undefined = nunca buscado; null = no existe; { type, data } = guardado. */
    async getLogo(isin) {
      const r = await client.execute({ sql: 'SELECT type, data, fetched_at FROM logos WHERE isin = ?', args: [isin] });
      const x = r.rows[0];
      if (!x) return undefined;
      if (!x.data) return Date.now() - Date.parse(x.fetched_at) < 30 * 86400000 ? null : undefined;
      return { type: x.type, data: Buffer.from(x.data) };
    },
    async saveLogo(isin, logo) {
      await client.execute({
        sql: 'INSERT OR REPLACE INTO logos (isin, type, data, fetched_at) VALUES (?, ?, ?, ?)',
        args: [isin, logo?.type ?? null, logo?.data ?? null, now()],
      });
    },

    // ---------- histórico ----------
    async getHistoryMeta() {
      const r = await client.execute('SELECT symbol, currency, from_d, last_d, fetched_at, v FROM history_meta');
      return Object.fromEntries(r.rows.map((x) => [x.symbol, { ...x }]));
    },

    /** Guarda cierres, dividendos y splits de un símbolo (por lotes) y actualiza su estado. */
    async saveHistory(symbol, { currency, from, rows, divs = [], splits = [] }) {
      // Varias filas por sentencia: un histórico de años son miles de cierres.
      const multi = (table, cols, list) => {
        const out = [];
        for (let i = 0; i < list.length; i += 200) {
          const part = list.slice(i, i + 200);
          out.push({
            sql: `INSERT OR REPLACE INTO ${table} (symbol, ${cols}) VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`,
            args: part.flatMap(([d, v]) => [symbol, d, v]),
          });
        }
        return out;
      };
      const known = splits.length
        ? new Set((await client.execute({ sql: 'SELECT d, ratio FROM symbol_splits WHERE symbol = ?', args: [symbol] })).rows.map((x) => `${x.d}|${x.ratio}`))
        : null;
      const stmts = [...multi('price_history', 'd, c', rows), ...multi('symbol_divs', 'd, amount', divs), ...multi('symbol_splits', 'd, ratio', splits)];
      for (let i = 0; i < stmts.length; i += 50) await client.batch(stmts.slice(i, i + 50), 'write');
      if (known && splits.some(([d, r]) => !known.has(`${d}|${r}`))) {
        globals.delete('splits');
        splitsVer++;
      }
      await client.execute({
        sql: `INSERT INTO history_meta (symbol, currency, from_d, last_d, fetched_at, v) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(symbol) DO UPDATE SET currency = excluded.currency, from_d = min(history_meta.from_d, excluded.from_d),
                last_d = max(coalesce(history_meta.last_d, ''), coalesce(excluded.last_d, '')), fetched_at = excluded.fetched_at, v = excluded.v`,
        args: [symbol, currency, from, rows.at(-1)?.[0] ?? null, now(), HISTORY_V],
      });
    },

    /** { símbolo: [[fecha, cierre], …] } ordenado por fecha. */
    async getHistory(symbols) {
      const out = Object.fromEntries(symbols.map((s) => [s, []]));
      for (let i = 0; i < symbols.length; i += 40) {
        const part = symbols.slice(i, i + 40);
        const r = await client.execute({
          sql: `SELECT symbol, d, c FROM price_history WHERE symbol IN (${part.map(() => '?').join(',')}) ORDER BY symbol, d`,
          args: part,
        });
        for (const x of r.rows) out[x.symbol].push([x.d, x.c]);
      }
      return out;
    },

    /** Cierres desde una fecha: { símbolo: [[fecha, cierre], …] } (para las mini-gráficas). */
    async getHistorySince(symbols, from) {
      const out = Object.fromEntries(symbols.map((x) => [x, []]));
      for (let i = 0; i < symbols.length; i += 40) {
        const part = symbols.slice(i, i + 40);
        const r = await client.execute({
          sql: `SELECT symbol, d, c FROM price_history WHERE d >= ? AND symbol IN (${part.map(() => '?').join(',')}) ORDER BY symbol, d`,
          args: [from, ...part],
        });
        for (const x of r.rows) out[x.symbol].push([x.d, x.c]);
      }
      return out;
    },

    /** Cierre más alto de cada símbolo desde una fecha: { símbolo: máximo }. */
    async getHighs(symbols, from) {
      const out = {};
      for (let i = 0; i < symbols.length; i += 40) {
        const part = symbols.slice(i, i + 40);
        const r = await client.execute({
          sql: `SELECT symbol, MAX(c) AS high FROM price_history WHERE d >= ? AND symbol IN (${part.map(() => '?').join(',')}) GROUP BY symbol`,
          args: [from, ...part],
        });
        for (const x of r.rows) out[x.symbol] = x.high;
      }
      return out;
    },

    /** Todos los splits conocidos: { símbolo: [[fecha, ratio], …] } ordenado por fecha. */
    async getSplits() {
      const hit = globals.get('splits');
      if (hit) return hit;
      const r = await client.execute('SELECT symbol, d, ratio FROM symbol_splits ORDER BY symbol, d');
      const out = {};
      for (const x of r.rows) (out[x.symbol] ??= []).push([x.d, x.ratio]);
      return globals.set('splits', out);
    },

    async getSymbolDivs(symbols) {
      if (!symbols.length) return {};
      const r = await client.execute({
        sql: `SELECT symbol, d, amount FROM symbol_divs WHERE symbol IN (${symbols.map(() => '?').join(',')}) ORDER BY symbol, d`,
        args: symbols,
      });
      const out = {};
      for (const x of r.rows) (out[x.symbol] ??= []).push([x.d, x.amount]);
      return out;
    },

    // ---------- histórico calculado de cada usuario ----------
    async getHistoryCache(userId) {
      const r = await client.execute({ sql: 'SELECT k, value, built_at FROM history_cache WHERE user_id = ?', args: [userId] });
      const x = r.rows[0];
      return x ? { key: x.k, value: JSON.parse(x.value), at: Date.parse(x.built_at) } : null;
    },
    async saveHistoryCache(userId, key, value) {
      await client.execute({
        sql: `INSERT INTO history_cache (user_id, k, value, built_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET k = excluded.k, value = excluded.value, built_at = excluded.built_at`,
        args: [userId, key, JSON.stringify(value), now()],
      });
    },

    // ---------- valoraciones manuales con fecha ----------
    async getValuations(userId) {
      const r = await client.execute({ sql: 'SELECT isin, d, price FROM valuations WHERE user_id = ? ORDER BY isin, d', args: [userId] });
      const out = {};
      for (const x of r.rows) (out[x.isin] ??= []).push({ d: x.d, price: x.price });
      return out;
    },
    async setValuation(userId, isin, d, price) {
      await client.execute({
        sql: `INSERT INTO valuations (user_id, isin, d, price) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, isin, d) DO UPDATE SET price = excluded.price`,
        args: [userId, isin, d, price],
      });
    },
    async deleteValuation(userId, isin, d) {
      await client.execute({ sql: 'DELETE FROM valuations WHERE user_id = ? AND isin = ? AND d = ?', args: [userId, isin, d] });
    },

    // ---------- ajustes del usuario ----------
    getUserSettings,
    /** Guarda un ajuste ya validado (lib/settings.js); con null lo quita. */
    async setUserSetting(userId, key, value) {
      await client.execute(value == null
        ? { sql: 'DELETE FROM user_settings WHERE user_id = ? AND key = ?', args: [userId, key] }
        : {
          sql: `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          args: [userId, key, JSON.stringify(value), now()],
        });
    },

    /** Quién tiene activado el resumen periódico: [{ userId, every, sent }] (sent = periodo del último enviado, o ''). */
    async getDigestUsers() {
      const r = await client.execute(`SELECT s.user_id, s.value,
        (SELECT x.value FROM user_settings x WHERE x.user_id = s.user_id AND x.key = '_digest_sent') AS sent
        FROM user_settings s WHERE s.key = 'digest'`);
      const read = (v) => { try { return JSON.parse(v); } catch { return null; } };
      return r.rows.map((x) => ({ userId: x.user_id, every: read(x.value)?.every, sent: read(x.sent) ?? '' })).filter((x) => x.every);
    },

    // ---------- patrimonio: otras cuentas, bienes y deudas ----------
    /** [{ id, name, kind, created_at, balances: [{ d, amount }] }], con los saldos por fecha. */
    async getAccounts(userId) {
      const [acc, bal] = await Promise.all([
        client.execute({ sql: 'SELECT id, name, kind, created_at FROM accounts WHERE user_id = ? ORDER BY created_at, id', args: [userId] }),
        client.execute({ sql: 'SELECT account_id, d, amount FROM account_balances WHERE user_id = ? ORDER BY d', args: [userId] }),
      ]);
      const by = Map.groupBy(bal.rows, (r) => r.account_id);
      return acc.rows.map((a) => ({ ...a, balances: (by.get(a.id) ?? []).map((r) => ({ d: r.d, amount: r.amount })) }));
    },
    async addAccount(userId, { name, kind }) {
      const id = crypto.randomUUID();
      await client.execute({ sql: 'INSERT INTO accounts (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)', args: [id, userId, name, kind, now()] });
      return id;
    },
    /** false si la cuenta no es del usuario. */
    async updateAccount(userId, id, { name, kind }) {
      const r = await client.execute({ sql: 'UPDATE accounts SET name = ?, kind = ? WHERE id = ? AND user_id = ?', args: [name, kind, id, userId] });
      return r.rowsAffected > 0;
    },
    async deleteAccount(userId, id) {
      await client.batch([
        { sql: 'DELETE FROM account_balances WHERE account_id = ? AND user_id = ?', args: [id, userId] },
        { sql: 'DELETE FROM accounts WHERE id = ? AND user_id = ?', args: [id, userId] },
      ], 'write');
    },
    /** Anota (o corrige) el saldo de una cuenta en una fecha. false si la cuenta no es del usuario. */
    async setAccountBalance(userId, id, d, amount) {
      const r = await client.execute({
        sql: `INSERT INTO account_balances (account_id, user_id, d, amount)
              SELECT id, user_id, ?, ? FROM accounts WHERE id = ? AND user_id = ?
              ON CONFLICT(account_id, d) DO UPDATE SET amount = excluded.amount`,
        args: [d, amount, id, userId],
      });
      return r.rowsAffected > 0;
    },
    async deleteAccountBalance(userId, id, d) {
      await client.execute({ sql: 'DELETE FROM account_balances WHERE account_id = ? AND user_id = ? AND d = ?', args: [id, userId, d] });
    },

    /** Cuentas cuyo id empieza por `prefix` creadas antes de `before` (ISO). */
    async staleUsers(prefix, before) {
      const r = await client.execute({ sql: 'SELECT id FROM users WHERE id LIKE ? AND created_at < ?', args: [`${prefix}%`, before] });
      return r.rows.map((x) => x.id);
    },
    /** Identificadores de todas las cuentas. */
    async listUserIds() {
      const r = await client.execute('SELECT id FROM users ORDER BY id');
      return r.rows.map((x) => x.id);
    },
    /** Borra cuentas enteras, con todos sus datos. */
    async deleteUsers(ids) {
      if (!ids.length) return;
      const tables = ['transactions', 'prices', 'imports', 'valuations', 'alerts', 'targets', 'history_cache', 'push_subscriptions', 'merchant_categories', 'budgets', 'watchlist', 'asset_notes', 'account_balances', 'accounts', 'user_settings'];
      await client.batch(ids.flatMap((id) => [
        ...tables.map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [id] })),
        { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
      ]), 'write');
      for (const id of ids) { users.delete(id); touchRows(id); }
    },

    /**
     * Sustituye todos los datos del usuario por los de una copia ya validada (backup.js), en una
     * sola transacción: o entra entera o no cambia nada.
     */
    async restoreUser(userId, b) {
      const del = ['transactions', 'prices', 'imports', 'valuations', 'alerts', 'targets', 'history_cache', 'merchant_categories', 'budgets', 'watchlist', 'asset_notes', 'account_balances', 'accounts', 'user_settings']
        .map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] }));
      const txSql = `INSERT INTO transactions (user_id, ${ROW_COLS.join(', ')}, source, deleted_at) VALUES (?, ${ROW_COLS.map(() => '?').join(', ')}, ?, ?)`;
      try {
        await client.batch([
          ...del,
          ...b.transactions.map((t) => ({ sql: txSql, args: [userId, ...ROW_COLS.map((k) => t[k] ?? ''), t.source, t.deleted_at] })),
          ...b.prices.map((x) => ({ sql: "INSERT INTO prices (user_id, isin, price, updated_at, source, info) VALUES (?, ?, ?, ?, 'manual', NULL)", args: [userId, x.isin, x.price, x.updated_at] })),
          ...b.valuations.map((x) => ({ sql: 'INSERT INTO valuations (user_id, isin, d, price) VALUES (?, ?, ?, ?)', args: [userId, x.isin, x.d, x.price] })),
          ...b.alerts.map((x) => ({ sql: 'INSERT INTO alerts (user_id, isin, dir, price, created_at, triggered_at) VALUES (?, ?, ?, ?, ?, ?)', args: [userId, x.isin, x.dir, x.price, x.created_at, x.triggered_at] })),
          ...b.targets.map((x) => ({ sql: 'INSERT INTO targets (user_id, isin, weight) VALUES (?, ?, ?)', args: [userId, x.isin, x.weight] })),
          ...b.imports.map((x) => ({ sql: 'INSERT INTO imports (user_id, name, uploaded_at, total, relevant, added, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [userId, x.name, x.uploaded_at, x.total, x.relevant, x.added, x.sha256] })),
          ...b.merchant_categories.map((x) => ({ sql: 'INSERT INTO merchant_categories (user_id, merchant, category) VALUES (?, ?, ?)', args: [userId, x.merchant, x.category] })),
          ...b.watchlist.map((x) => ({ sql: 'INSERT INTO watchlist (user_id, isin, name, added_at) VALUES (?, ?, ?, ?)', args: [userId, x.isin, x.name, x.added_at] })),
          ...b.asset_notes.map((x) => ({ sql: 'INSERT INTO asset_notes (user_id, isin, note, updated_at) VALUES (?, ?, ?, ?)', args: [userId, x.isin, x.note, now()] })),
          ...b.budgets.map((x) => ({ sql: 'INSERT INTO budgets (user_id, category, amount) VALUES (?, ?, ?)', args: [userId, x.category, x.amount] })),
          ...(b.settings ?? []).map((x) => ({ sql: 'INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)', args: [userId, x.key, JSON.stringify(x.value), now()] })),
          // Las cuentas reciben un identificador nuevo: el de la copia podría ser de otra cuenta de usuario.
          ...(b.accounts ?? []).flatMap((x) => {
            const id = crypto.randomUUID();
            return [
              { sql: 'INSERT INTO accounts (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)', args: [id, userId, x.name, x.kind, x.created_at] },
              ...x.balances.map((y) => ({ sql: 'INSERT INTO account_balances (account_id, user_id, d, amount) VALUES (?, ?, ?, ?)', args: [id, userId, y.d, y.amount] })),
            ];
          }),
        ], 'write');
      } finally {
        touchRows(userId);
      }
    },

    async clearUserData(userId) {
      await client.batch(
        ['transactions', 'prices', 'imports', 'valuations', 'alerts', 'targets', 'history_cache', 'merchant_categories', 'budgets', 'watchlist', 'asset_notes', 'account_balances', 'accounts', 'user_settings'].map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] })),
        'write',
      );
      touchRows(userId);
    },
  };
}
