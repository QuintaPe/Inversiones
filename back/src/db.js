// Acceso a Turso (libSQL). Sin TURSO_DATABASE_URL usa un fichero SQLite local,
// para poder desarrollar sin tocar la base de datos remota.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Columnas de cada operación: las del CSV de Trade Republic que describen una inversión,
// más la cuenta y la divisa. Lo que identifica pagos personales (comercio, IBAN, concepto,
// categoría de tarjeta) no se guarda nunca.
export const ROW_COLS = [
  'transaction_id', 'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description',
  'original_amount', 'original_currency', 'fx_rate', 'account_type', 'currency',
];
const V1_COLS = ROW_COLS.slice(0, 17);

export const HISTORY_V = 2; // 2 = incluye los splits
const SYMBOL_V = 3; // 2 = incluye sector e industria; 3 = segunda fuente para los ISIN que Yahoo no encuentra
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

export async function openDb({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  if (!url) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    url = `file:${path.join(dir, 'local.db')}`;
  }
  const client = createClient({ url, authToken });
  await migrate(client);
  return makeRepo(client, url);
}

function makeRepo(client, url) {
  const now = () => new Date().toISOString();
  return {
    url,
    close: () => client.close(),

    async upsertUser({ id, email, name, picture }) {
      const t = now();
      await client.execute({
        sql: `INSERT INTO users (id, email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
                picture = excluded.picture, last_login = excluded.last_login`,
        args: [id, email, name ?? null, picture ?? null, t, t],
      });
    },

    async getUser(id) {
      const r = await client.execute({ sql: 'SELECT id, email, name, picture FROM users WHERE id = ?', args: [id] });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },

    async getRows(userId) {
      const r = await client.execute({
        sql: `SELECT ${ROW_COLS.join(', ')} FROM transactions WHERE user_id = ? AND deleted_at IS NULL`,
        args: [userId],
      });
      return r.rows.map((x) => ({ ...x }));
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
    },
    /** Quita una operación. Las del CSV se conservan marcadas para no reaparecer al resubirlo. */
    async removeRow(userId, row, remember) {
      await client.execute(remember
        ? { sql: 'UPDATE transactions SET deleted_at = ? WHERE user_id = ? AND transaction_id = ?', args: [now(), userId, row.transaction_id] }
        : { sql: 'DELETE FROM transactions WHERE user_id = ? AND transaction_id = ?', args: [userId, row.transaction_id] });
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
      const r = await client.execute({ sql: 'SELECT isin, symbol, exchange, sector, industry, resolved_at FROM symbols WHERE v >= ?', args: [SYMBOL_V] });
      const out = {};
      for (const x of r.rows) {
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
      const [transactions, prices, valuations, alerts, targets, imports] = await Promise.all([
        q(`SELECT ${ROW_COLS.join(', ')}, source, deleted_at FROM transactions WHERE user_id = ? ORDER BY datetime`),
        q('SELECT isin, price, updated_at FROM prices WHERE user_id = ?'),
        q('SELECT isin, d, price FROM valuations WHERE user_id = ? ORDER BY isin, d'),
        q('SELECT isin, dir, price, created_at, triggered_at FROM alerts WHERE user_id = ?'),
        q('SELECT isin, weight FROM targets WHERE user_id = ?'),
        q('SELECT name, uploaded_at, total, relevant, added, sha256 FROM imports WHERE user_id = ? ORDER BY id'),
      ]);
      return { transactions, prices, valuations, alerts, targets, imports };
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
      const stmts = [
        ...rows.map(([d, c]) => ({ sql: 'INSERT OR REPLACE INTO price_history (symbol, d, c) VALUES (?, ?, ?)', args: [symbol, d, c] })),
        ...divs.map(([d, a]) => ({ sql: 'INSERT OR REPLACE INTO symbol_divs (symbol, d, amount) VALUES (?, ?, ?)', args: [symbol, d, a] })),
        ...splits.map(([d, r]) => ({ sql: 'INSERT OR REPLACE INTO symbol_splits (symbol, d, ratio) VALUES (?, ?, ?)', args: [symbol, d, r] })),
      ];
      for (let i = 0; i < stmts.length; i += 400) await client.batch(stmts.slice(i, i + 400), 'write');
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

    /** Todos los splits conocidos: { símbolo: [[fecha, ratio], …] } ordenado por fecha. */
    async getSplits() {
      const r = await client.execute('SELECT symbol, d, ratio FROM symbol_splits ORDER BY symbol, d');
      const out = {};
      for (const x of r.rows) (out[x.symbol] ??= []).push([x.d, x.ratio]);
      return out;
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

    async clearUserData(userId) {
      await client.batch(
        ['transactions', 'prices', 'imports', 'valuations', 'alerts', 'targets'].map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] })),
        'write',
      );
    },
  };
}
